/**
 * Skyline City
 *
 * Deterministic procedural night-city generator for the 'skyline' view mode.
 * Buildings live in a local East/North/Up (ENU) frame anchored at the
 * observer's surface point, kept in kilometers, so the sub-kilometer city
 * geometry retains float32 precision independent of the planetary-scale ECI
 * coordinates used everywhere else in the simulation.
 */

import type { Vec3 } from '@/types/index.js';
import { v3norm, v3cross, v3sub, v3scale, v3dot, mat4lookAt, mat4persp, mat4mul } from '@/utils/math.js';

/** Floats per Building instance (must match the 32-byte WGSL struct). */
const BUILDING_FLOATS = 8;

/** Bytes in the CityUni uniform (mat4x4f + vec4f + vec4f + vec4f = 112 bytes). */
const CITY_UNI_BYTES = 112;

export interface SkylineConfig {
  /** PRNG seed for deterministic, stable layout across frames. */
  seed: number;
  /** Number of instanced buildings. */
  buildingCount: number;
  /** Side length (km) of the square city footprint, centered on the observer. */
  citySpanKm: number;
  minHeightKm: number;
  maxHeightKm: number;
  minFootprintKm: number;
  maxFootprintKm: number;
  /** Radius (km) around the observer kept clear of buildings (the street below the window). */
  streetClearanceKm: number;
}

export const DEFAULT_SKYLINE: SkylineConfig = {
  seed: 0xc0ffee,
  buildingCount: 260,
  citySpanKm: 1.6,
  minHeightKm: 0.03,
  maxHeightKm: 0.32,
  minFootprintKm: 0.018,
  maxFootprintKm: 0.06,
  streetClearanceKm: 0.05,
};

/** Deterministic 32-bit PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SkylineCity {
  readonly buildingCount: number;

  private config: SkylineConfig;
  private buildingData: Float32Array;

  private observerEci: Vec3 = [0, 0, 0];
  private east: Vec3 = [1, 0, 0];
  private north: Vec3 = [0, 1, 0];
  private up: Vec3 = [0, 0, 1];
  private observerSet = false;

  private instanceBuffer: GPUBuffer | null = null;
  private cityUniformBuffer: GPUBuffer | null = null;

  constructor(config: Partial<SkylineConfig> = {}) {
    this.config = { ...DEFAULT_SKYLINE, ...config };
    this.buildingCount = this.config.buildingCount;
    this.buildingData = new Float32Array(this.buildingCount * BUILDING_FLOATS);
    this.generate();
  }

  /** Lay out the deterministic city footprint in local ENU (km). Runs once at construction. */
  private generate(): void {
    const rng = mulberry32(this.config.seed);
    const half = this.config.citySpanKm / 2;

    for (let i = 0; i < this.buildingCount; i++) {
      const east = (rng() * 2 - 1) * half;
      const north = (rng() * 2 - 1) * half;
      const distFromObserver = Math.hypot(east, north);

      const width = this.config.minFootprintKm + rng() * (this.config.maxFootprintKm - this.config.minFootprintKm);
      const depth = this.config.minFootprintKm + rng() * (this.config.maxFootprintKm - this.config.minFootprintKm);
      // Keep the street directly below the observer's window clear, and bias
      // toward shorter buildings so the skyline reads as a real city, not a wall.
      const height = distFromObserver < this.config.streetClearanceKm
        ? 0
        : this.config.minHeightKm + Math.pow(rng(), 1.5) * (this.config.maxHeightKm - this.config.minHeightKm);

      const o = i * BUILDING_FLOATS;
      this.buildingData[o + 0] = east;
      this.buildingData[o + 1] = north;
      this.buildingData[o + 2] = width;
      this.buildingData[o + 3] = depth;
      this.buildingData[o + 4] = height;
      this.buildingData[o + 5] = rng();
      this.buildingData[o + 6] = rng();
      this.buildingData[o + 7] = 0;
    }

    // Mark tallest decile for rooftop equipment silhouettes.
    const heights: number[] = [];
    for (let i = 0; i < this.buildingCount; i++) {
      const h = this.buildingData[i * BUILDING_FLOATS + 4]!;
      if (h > 0) heights.push(h);
    }
    heights.sort((a, b) => a - b);
    const threshold = heights[Math.floor(heights.length * 0.9)] ?? this.config.maxHeightKm;
    for (let i = 0; i < this.buildingCount; i++) {
      const o = i * BUILDING_FLOATS;
      const h = this.buildingData[o + 4]!;
      if (h >= threshold && h > 0) {
        this.buildingData[o + 7] = 1;
      }
    }
  }

  /** Allocate the GPU storage/uniform buffers and upload the static instance data. */
  createBuffers(device: GPUDevice): void {
    this.instanceBuffer = device.createBuffer({
      size: this.buildingData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'Skyline Building Instances',
    });
    device.queue.writeBuffer(
      this.instanceBuffer,
      0,
      this.buildingData.buffer as ArrayBuffer,
      this.buildingData.byteOffset,
      this.buildingData.byteLength
    );

    this.cityUniformBuffer = device.createBuffer({
      size: CITY_UNI_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'Skyline City Uniform',
    });
  }

  getInstanceBuffer(): GPUBuffer {
    if (!this.instanceBuffer) throw new Error('SkylineCity.createBuffers() must be called first');
    return this.instanceBuffer;
  }

  getCityUniformBuffer(): GPUBuffer {
    if (!this.cityUniformBuffer) throw new Error('SkylineCity.createBuffers() must be called first');
    return this.cityUniformBuffer;
  }

  /**
   * Anchor the local ENU frame to the observer's current ECI position.
   * Safe to call every frame; the building layout itself never changes.
   */
  setObserver(eciPosition: Vec3): void {
    this.observerEci = eciPosition;
    this.up = v3norm(eciPosition);
    // The ground/skyline camera sits on the equatorial plane (z = 0), so
    // world +Z is never parallel to `up` and is a stable "north" reference.
    const worldZ: Vec3 = [0, 0, 1];
    this.north = v3norm(v3sub(worldZ, v3scale(this.up, v3dot(worldZ, this.up))));
    this.east = v3norm(v3cross(this.north, this.up));
    this.observerSet = true;
  }

  /** Project a world ECI point into local ENU km coordinates relative to the observer. */
  eciToEnu(point: Vec3): Vec3 {
    const rel = v3sub(point, this.observerEci);
    return [v3dot(rel, this.east), v3dot(rel, this.north), v3dot(rel, this.up)];
  }

  /**
   * Build a near-tuned view-projection for the city pass: same eye/look
   * direction as the main camera, but with a near/far range suited to
   * sub-kilometer geometry instead of the planetary frustum.
   */
  computeCityViewProj(
    cameraPosition: Vec3,
    cameraTarget: Vec3,
    cameraUp: Vec3,
    aspect: number,
    fov: number
  ): Float32Array {
    if (!this.observerSet) this.setObserver(cameraPosition);

    const eyeEnu = this.eciToEnu(cameraPosition);
    const targetEnu = this.eciToEnu(cameraTarget);
    const upEnu: Vec3 = [
      v3dot(cameraUp, this.east),
      v3dot(cameraUp, this.north),
      v3dot(cameraUp, this.up),
    ];

    const view = mat4lookAt(eyeEnu, targetEnu, v3norm(upEnu));
    const projection = mat4persp(fov, aspect, 0.005, 60);
    return mat4mul(projection, view);
  }

  /** Write the CityUni buffer for the upcoming skyline pass. */
  updateUniform(
    device: GPUDevice,
    cityViewProj: Float32Array,
    cameraEci: Vec3,
    sunDirEci: Vec3,
    nightFactor: number,
    time: number,
    emissiveBoost = 1.0,
  ): void {
    if (!this.cityUniformBuffer) return;

    if (!this.observerSet) this.setObserver(cameraEci);

    const sunEnu = v3norm([
      v3dot(sunDirEci, this.east),
      v3dot(sunDirEci, this.north),
      v3dot(sunDirEci, this.up),
    ]);
    const camEnu = this.eciToEnu(cameraEci);

    const data = new ArrayBuffer(CITY_UNI_BYTES);
    new Float32Array(data, 0, 16).set(cityViewProj);
    const tail = new Float32Array(data, 64, 12);
    tail[0] = sunEnu[0];
    tail[1] = sunEnu[1];
    tail[2] = sunEnu[2];
    tail[3] = 0;
    tail[4] = nightFactor;
    tail[5] = this.buildingCount;
    tail[6] = time;
    tail[7] = emissiveBoost;
    tail[8] = camEnu[0];
    tail[9] = camEnu[1];
    tail[10] = camEnu[2];
    tail[11] = 0;

    device.queue.writeBuffer(this.cityUniformBuffer, 0, data);
  }

  destroy(): void {
    this.instanceBuffer?.destroy();
    this.cityUniformBuffer?.destroy();
    this.instanceBuffer = null;
    this.cityUniformBuffer = null;
  }
}

export default SkylineCity;
