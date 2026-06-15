/**
 * Grok Zephyr - Shared Orbital Element Data (GPU-agnostic)
 *
 * Pure-CPU orbital element generation, TLE loading, and Keplerian
 * position/velocity math. This module is shared between the WebGPU path
 * (via SatelliteGPUBuffer, which uploads `data` into a storage buffer and
 * propagates on the GPU compute shader) and the WebGL2 fallback path
 * (which uploads `data` as instanced attributes and propagates in the
 * vertex shader). Keeping the math here guarantees both backends agree on
 * orbit geometry.
 *
 * Per-satellite layout in `data` (4 floats / 16 bytes):
 *   [0] raan          (rad)
 *   [1] inclination   (rad)
 *   [2] meanAnomaly0  (rad, at epoch)
 *   [3] shellData     (packed: (shellIndex << 8) | colorIndex)
 */

import { CONSTANTS, INCLINATION_SHELLS } from '@/types/constants.js';
import type { TLEData } from '@/types/index.js';

/** Orbit radius (km) per inclination shell — matches orbital_compute.wgsl simple mode. */
export const SHELL_RADII_KM = [6711.0, 6921.0, 7521.0];

/** Mean motion (rad/s) per shell — matches orbital_compute.wgsl simple mode. */
export const SHELL_MEAN_MOTIONS = [0.001153, 0.001097, 0.000946];

/** Color index per shell (used by the satellite shader's shell color table). */
export const SHELL_COLORS = [2.0, 6.0, 3.0];

/** Probability mass for assigning satellites to each shell (340km / 550km / 1150km). */
const SHELL_DISTRIBUTION = [0.3, 0.5, 0.2];

const DEG_TO_RAD = Math.PI / 180;

/**
 * Owns the per-satellite orbital element array and the pure math that both
 * renderer backends rely on. No GPU device required.
 */
export class OrbitalElements {
  /** Packed `[raan, inclination, meanAnomaly0, shellData]` per satellite. */
  readonly data: Float32Array;

  constructor(public readonly numSatellites: number = CONSTANTS.NUM_SATELLITES) {
    this.data = new Float32Array(numSatellites * 4);
  }

  /**
   * Generate procedural multi-shell Walker-style orbital elements.
   * Extracted verbatim from SatelliteGPUBuffer.generateOrbitalElements().
   */
  generate(): Float32Array {
    const { NUM_PLANES, SATELLITES_PER_PLANE } = CONSTANTS;
    const shells = INCLINATION_SHELLS;
    const data = this.data;

    for (let plane = 0; plane < NUM_PLANES; plane++) {
      const raan = (plane / NUM_PLANES) * Math.PI * 2;
      const inclinationShellIdx = Math.floor(plane / (NUM_PLANES / shells.length));
      const inclination = shells[inclinationShellIdx] + (Math.random() - 0.5) * 0.008;

      for (let sat = 0; sat < SATELLITES_PER_PLANE; sat++) {
        const idx = (plane * SATELLITES_PER_PLANE + sat) * 4;
        const meanAnomaly = (sat / SATELLITES_PER_PLANE) * Math.PI * 2;

        const rand = Math.random();
        let shellIndex = 0;
        let cumulative = 0;
        for (let s = 0; s < SHELL_DISTRIBUTION.length; s++) {
          cumulative += SHELL_DISTRIBUTION[s];
          if (rand < cumulative) {
            shellIndex = s;
            break;
          }
        }

        const colorIndex = SHELL_COLORS[shellIndex];
        const shellData = (shellIndex << 8) | (colorIndex & 0xFF);

        data[idx + 0] = raan;
        data[idx + 1] = inclination;
        data[idx + 2] = meanAnomaly;
        data[idx + 3] = shellData;
      }
    }

    return data;
  }

  /**
   * Load orbital elements from parsed TLE data, padding the remainder with
   * deterministic procedural data. Returns the number of real TLEs loaded.
   * Extracted verbatim from SatelliteGPUBuffer.loadFromTLEData().
   */
  loadFromTLE(tles: TLEData[]): number {
    const data = this.data;
    const tleCount = Math.min(tles.length, this.numSatellites);

    for (let t = 0; t < tleCount; t++) {
      const { line2 } = tles[t];
      const incDeg = parseFloat(line2.substring(8, 16).trim());
      const raanDeg = parseFloat(line2.substring(17, 25).trim());
      const meanAnomalyDeg = parseFloat(line2.substring(43, 51).trim());
      const meanMotionRevPerDay = parseFloat(line2.substring(52, 63).trim());

      const raan = raanDeg * DEG_TO_RAD;
      const inc = incDeg * DEG_TO_RAD;
      const M = meanAnomalyDeg * DEG_TO_RAD;

      const nRadPerSec = (meanMotionRevPerDay * 2 * Math.PI) / 86400;
      const MU = 398600.4418;
      const a = Math.pow(MU / (nRadPerSec * nRadPerSec), 1 / 3);
      const altKm = a - 6371.0;

      let shellIndex: number;
      if (altKm < 450) shellIndex = 0;
      else if (altKm < 800) shellIndex = 1;
      else shellIndex = 2;

      const colorIndex = SHELL_COLORS[shellIndex];
      const shellData = (shellIndex << 8) | (colorIndex & 0xFF);

      const idx = t * 4;
      data[idx + 0] = raan;
      data[idx + 1] = inc;
      data[idx + 2] = M;
      data[idx + 3] = shellData;
    }

    // Fill remaining slots with deterministic procedural data
    if (tleCount < this.numSatellites) {
      const remaining = this.numSatellites - tleCount;
      const { NUM_PLANES, SATELLITES_PER_PLANE } = CONSTANTS;
      const shells = INCLINATION_SHELLS;

      for (let j = 0; j < remaining; j++) {
        const globalIdx = tleCount + j;
        const plane = globalIdx % NUM_PLANES;
        const sat = Math.floor(globalIdx / NUM_PLANES) % SATELLITES_PER_PLANE;

        const raan = (plane / NUM_PLANES) * Math.PI * 2;
        const shellIdx = Math.floor(plane / (NUM_PLANES / shells.length));
        const inclination = shells[shellIdx];
        const meanAnomaly = (sat / SATELLITES_PER_PLANE) * Math.PI * 2;

        const shellIndex = globalIdx % 3 === 0 ? 0 : globalIdx % 3 === 1 ? 1 : 2;
        const colorIndex = SHELL_COLORS[shellIndex];
        const shellData = (shellIndex << 8) | (colorIndex & 0xFF);

        const idx = globalIdx * 4;
        data[idx + 0] = raan;
        data[idx + 1] = inclination;
        data[idx + 2] = meanAnomaly;
        data[idx + 3] = shellData;
      }
    }

    return tleCount;
  }

  /**
   * Calculate satellite position on CPU (multi-shell, simple circular mode).
   * Mirrors the simple-mode propagation in orbital_compute.wgsl.
   */
  calculatePosition(index: number, time: number): [number, number, number] {
    const i = index * 4;
    const raan = this.data[i];
    const inclination = this.data[i + 1];
    const meanAnomaly0 = this.data[i + 2];
    const shellData = this.data[i + 3];

    const shellIndex = (shellData >> 8) & 0xFF;
    const orbitR = SHELL_RADII_KM[shellIndex] || 6921.0;
    const meanMotion = SHELL_MEAN_MOTIONS[shellIndex] || 0.001097;

    const meanAnomaly = meanAnomaly0 + meanMotion * time;

    const cM = Math.cos(meanAnomaly);
    const sM = Math.sin(meanAnomaly);
    const cR = Math.cos(raan);
    const sR = Math.sin(raan);
    const cI = Math.cos(inclination);
    const sI = Math.sin(inclination);

    return [
      orbitR * (cR * cM - sR * sM * cI),
      orbitR * (sR * cM + cR * sM * cI),
      orbitR * sM * sI,
    ];
  }

  /**
   * Calculate normalized satellite velocity direction on CPU (multi-shell).
   */
  calculateVelocity(index: number, time: number): [number, number, number] {
    const i = index * 4;
    const raan = this.data[i];
    const inclination = this.data[i + 1];
    const meanAnomaly0 = this.data[i + 2];
    const shellData = this.data[i + 3];

    const shellIndex = (shellData >> 8) & 0xFF;
    const meanMotion = SHELL_MEAN_MOTIONS[shellIndex] || 0.001097;

    const meanAnomaly = meanAnomaly0 + meanMotion * time;

    const cM = Math.cos(meanAnomaly);
    const sM = Math.sin(meanAnomaly);
    const cR = Math.cos(raan);
    const sR = Math.sin(raan);
    const cI = Math.cos(inclination);
    const sI = Math.sin(inclination);

    const vx = -(cR * sM + sR * cM * cI);
    const vy = -(sR * sM - cR * cM * cI);
    const vz = cM * sI;

    const len = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
    return [vx / len, vy / len, vz / len];
  }
}

export default OrbitalElements;
