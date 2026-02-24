/**
 * Constellation Loader
 * 
 * Handles loading and generation of satellite constellation data.
 * Supports:
 * - Real TLE data parsing from file/network
 * - Procedural Walker constellation generation
 * - Starlink-specific shell configurations
 */

import {
  TLE,
  SatelliteState,
  KeplerianElements,
  STARLINK_SHELLS,
  PHYSICAL_CONSTANTS,
  SGP4Propagator,
  J2Perturbation,
  defaultPropagator,
} from '../physics/Propagator';

// Simulation constants
const NUM_SAT = 1048576;  // 2^20 satellites
const NUM_PLANES = 1024;
const SAT_PER_PLANE = 1024;

/**
 * Orbital shell configuration
 */
export interface OrbitalShell {
  id: number;
  name: string;
  altitude: number;      // km
  inclination: number;   // degrees
  numPlanes: number;
  satsPerPlane: number;
  raanSpread: number;    // degrees (360 for full Walker)
  totalSats: number;
  meanAnomalyOffset: number; // degrees between planes
}

/**
 * Constellation configuration
 */
export interface ConstellationConfig {
  name: string;
  totalSatellites: number;
  shells: OrbitalShell[];
  seed?: number;
}

/**
 * Predefined constellation configurations
 */
export const CONSTELLATIONS = {
  STARLINK: {
    name: 'Starlink',
    totalSatellites: NUM_SAT,
    shells: [
      {
        id: 1,
        name: 'Shell 1',
        altitude: 550,
        inclination: 53.0,
        numPlanes: 350,      // ~350 planes for 550km shell
        satsPerPlane: 1024,
        raanSpread: 360,
        totalSats: 358400,
        meanAnomalyOffset: 360 / 350,
      },
      {
        id: 2,
        name: 'Shell 2',
        altitude: 540,
        inclination: 53.2,
        numPlanes: 350,
        satsPerPlane: 1024,
        raanSpread: 360,
        totalSats: 358400,
        meanAnomalyOffset: 360 / 350,
      },
      {
        id: 3,
        name: 'Shell 3',
        altitude: 570,
        inclination: 70.0,
        numPlanes: 324,
        satsPerPlane: 1024,
        raanSpread: 360,
        totalSats: 331776,
        meanAnomalyOffset: 360 / 324,
      },
    ],
  } as ConstellationConfig,

  // Simplified single-shell for testing
  SINGLE_SHELL: {
    name: 'Single Shell Test',
    totalSatellites: NUM_SAT,
    shells: [
      {
        id: 0,
        name: 'Single Shell',
        altitude: 550,
        inclination: 53.0,
        numPlanes: NUM_PLANES,
        satsPerPlane: SAT_PER_PLANE,
        raanSpread: 360,
        totalSats: NUM_SAT,
        meanAnomalyOffset: 360 / NUM_PLANES,
      },
    ],
  } as ConstellationConfig,

  // Walker 1024/1024/1 configuration (full simulation)
  WALKER_1024: {
    name: 'Walker 1024x1024',
    totalSatellites: NUM_SAT,
    shells: [
      {
        id: 0,
        name: 'Walker Shell',
        altitude: 550,
        inclination: 53.0,
        numPlanes: NUM_PLANES,
        satsPerPlane: SAT_PER_PLANE,
        raanSpread: 360,
        totalSats: NUM_SAT,
        meanAnomalyOffset: 360 / NUM_PLANES,
      },
    ],
  } as ConstellationConfig,
};

/**
 * Satellite data format for GPU buffer
 * Each satellite: 16 bytes (4 floats)
 * - x: RAAN (right ascension of ascending node)
 * - y: inclination
 * - z: mean anomaly at epoch
 * - w: color data (packed)
 */
export type GPUSatelliteData = Float32Array;

/**
 * Extended satellite data with full orbital elements
 * Each satellite: 64 bytes (16 floats)
 * - [0-5]: Keplerian elements (a, e, i, Ω, ω, M)
 * - [6-7]: reserved
 * - [8-10]: position (x, y, z)
 * - [11]: reserved
 * - [12-14]: velocity (vx, vy, vz)
 * - [15]: epoch time
 */
export type ExtendedSatelliteData = Float32Array;

/**
 * TLE Loader
 */
export class TLELoader {
  private sgp4: SGP4Propagator;

  constructor() {
    this.sgp4 = new SGP4Propagator();
  }

  /**
   * Load TLE data from a string
   */
  parseTLEData(data: string): TLE[] {
    const lines = data.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const tles: TLE[] = [];

    for (let i = 0; i < lines.length; i += 3) {
      if (i + 2 >= lines.length) break;

      const name = lines[i].startsWith('1 ') || lines[i].startsWith('2 ')
        ? undefined
        : lines[i];
      const line1 = name ? lines[i + 1] : lines[i];
      const line2 = name ? lines[i + 2] : lines[i + 1];

      try {
        const tle = this.sgp4.parseTLE(name, line1, line2);
        tles.push(tle);
      } catch (e) {
        console.warn('Failed to parse TLE:', name || line1, e);
      }
    }

    return tles;
  }

  /**
   * Load TLE data from URL
   */
  async loadFromURL(url: string): Promise<TLE[]> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch TLE data: ${response.statusText}`);
    }
    const data = await response.text();
    return this.parseTLEData(data);
  }

  /**
   * Load TLE data from file (Node.js environment)
   */
  async loadFromFile(filePath: string): Promise<TLE[]> {
    // In browser environment, this would use File API
    // For now, assume the file content is provided as string
    throw new Error('File loading not implemented in browser environment');
  }

  /**
   * Generate TLE-like data from orbital elements
   * For creating synthetic constellations
   */
  generateSyntheticTLE(
    satnum: number,
    elements: KeplerianElements,
    epoch: Date = new Date(),
    name: string = `SAT${satnum.toString().padStart(6, '0')}`
  ): TLE {
    const { a, e, i, Ω, ω, M, n } = elements;
    
    // Convert to TLE units
    const n_revs_per_day = (n || Math.sqrt(PHYSICAL_CONSTANTS.MU / (a * a * a))) 
                           * 86400 / (2 * Math.PI);
    
    // Format TLE lines (simplified - full implementation would need proper formatting)
    const epochYear = epoch.getUTCFullYear() % 100;
    const startOfYear = new Date(Date.UTC(epoch.getUTCFullYear(), 0, 1));
    const epochDay = 1 + (epoch.getTime() - startOfYear.getTime()) / 86400000;

    const line1 = `1 ${satnum.toString().padStart(5, '0')}U 00000    ${epochYear.toString().padStart(2, '0')}${epochDay.toFixed(8).padStart(12, '0')}  .00000000  00000-0  00000-0 0  0010`;
    
    const line2 = `2 ${satnum.toString().padStart(5, '0')} ${(i * PHYSICAL_CONSTANTS.RAD_TO_DEG).toFixed(4).padStart(8, ' ')} ${(Ω * PHYSICAL_CONSTANTS.RAD_TO_DEG).toFixed(4).padStart(8, ' ')} ${e.toFixed(7).substring(2).padStart(7, '0')} ${(ω * PHYSICAL_CONSTANTS.RAD_TO_DEG).toFixed(4).padStart(8, ' ')} ${(M * PHYSICAL_CONSTANTS.RAD_TO_DEG).toFixed(4).padStart(8, ' ')} ${n_revs_per_day.toFixed(8).padStart(11, ' ')}    10`;

    return {
      name,
      line1,
      line2,
      satnum,
      epoch,
      a,
      e,
      i,
      Ω,
      ω,
      M,
      n: n || Math.sqrt(PHYSICAL_CONSTANTS.MU / (a * a * a)),
      bstar: 0,
    };
  }
}

/**
 * Walker Constellation Generator
 * 
 * Generates evenly distributed satellite constellations using
 * Walker Delta or Walker Star patterns.
 * 
 * Walker Delta: planes evenly spaced in RAAN, satellites evenly spaced
 *               in mean anomaly, with phase difference between planes
 */
export class WalkerConstellationGenerator {
  private j2: J2Perturbation;

  constructor() {
    this.j2 = new J2Perturbation();
  }

  /**
   * Generate Walker Delta constellation
   * 
   * @param t - total number of satellites
   * @param p - number of planes
   * @param f - phasing parameter (0 to p-1)
   * @param a - semi-major axis (km)
   * @param i - inclination (rad)
   * @param e - eccentricity
   * @returns Array of orbital elements
   */
  generateWalkerDelta(
    t: number,
    p: number,
    f: number,
    a: number,
    i: number,
    e: number = 0
  ): KeplerianElements[] {
    const s = t / p;  // satellites per plane
    const elements: KeplerianElements[] = [];

    const n = Math.sqrt(PHYSICAL_CONSTANTS.MU / (a * a * a));

    for (let plane = 0; plane < p; plane++) {
      const Ω = (plane / p) * 2 * Math.PI;  // RAAN

      for (let sat = 0; sat < s; sat++) {
        const M = ((sat / s) + (f / t) * plane) * 2 * Math.PI;  // Mean anomaly

        elements.push({
          a,
          e,
          i,
          Ω,
          ω: 0,  // Argument of perigee (irrelevant for circular orbits)
          M: ((M % (2 * Math.PI)) + (2 * Math.PI)) % (2 * Math.PI),
          n,
          period: 2 * Math.PI / n,
        });
      }
    }

    return elements;
  }

  /**
   * Generate Starlink-like shell
   */
  generateStarlinkShell(shell: OrbitalShell): KeplerianElements[] {
    const a = PHYSICAL_CONSTANTS.EARTH_R + shell.altitude;
    const i = shell.inclination * PHYSICAL_CONSTANTS.DEG_TO_RAD;
    const e = 0.0001;  // Nearly circular

    // Use Walker Delta pattern
    // f = 1 gives optimal phasing for continuous coverage
    return this.generateWalkerDelta(
      shell.totalSats,
      shell.numPlanes,
      1,  // phasing parameter
      a,
      i,
      e
    );
  }

  /**
   * Generate full constellation with multiple shells
   */
  generateConstellation(config: ConstellationConfig): KeplerianElements[] {
    const allElements: KeplerianElements[] = [];
    let satOffset = 0;

    for (const shell of config.shells) {
      const shellElements = this.generateStarlinkShell(shell);
      
      // Add shell ID to each element for coloring
      for (let i = 0; i < shellElements.length; i++) {
        // Store shell ID in the elements array metadata
        // In a real implementation, you'd attach metadata separately
      }

      allElements.push(...shellElements);
      satOffset += shell.totalSats;
    }

    // If we don't have enough satellites, fill remaining with single shell
    while (allElements.length < config.totalSatellites) {
      const remaining = config.totalSatellites - allElements.length;
      const firstShell = config.shells[0];
      
      const a = PHYSICAL_CONSTANTS.EARTH_R + firstShell.altitude;
      const i = firstShell.inclination * PHYSICAL_CONSTANTS.DEG_TO_RAD;
      
      const extra = this.generateWalkerDelta(
        Math.min(remaining, firstShell.satsPerPlane * 10),
        10,
        1,
        a,
        i,
        0.0001
      );
      
      allElements.push(...extra);
    }

    // Trim to exact count
    return allElements.slice(0, config.totalSatellites);
  }
}

/**
 * Main Constellation Loader
 */
export class ConstellationLoader {
  private tleLoader: TLELoader;
  private walkerGen: WalkerConstellationGenerator;
  private config: ConstellationConfig;

  constructor(config: ConstellationConfig = CONSTELLATIONS.STARLINK) {
    this.tleLoader = new TLELoader();
    this.walkerGen = new WalkerConstellationGenerator();
    this.config = config;
  }

  /**
   * Load constellation data
   * Tries TLE first, falls back to procedural generation
   */
  async load(useTLE: boolean = false, tleUrl?: string): Promise<{
    gpuData: GPUSatelliteData;
    extendedData: ExtendedSatelliteData;
    satellites: SatelliteState[];
    shellDistribution: number[];
  }> {
    if (useTLE && tleUrl) {
      try {
        return await this.loadFromTLE(tleUrl);
      } catch (e) {
        console.warn('TLE load failed, falling back to procedural generation:', e);
      }
    }

    return this.loadProcedural();
  }

  /**
   * Load from TLE file
   */
  private async loadFromTLE(url: string): Promise<{
    gpuData: GPUSatelliteData;
    extendedData: ExtendedSatelliteData;
    satellites: SatelliteState[];
    shellDistribution: number[];
  }> {
    const tles = await this.tleLoader.loadFromURL(url);
    
    // Limit to NUM_SAT
    const limitedTLEs = tles.slice(0, NUM_SAT);
    
    const satellites: SatelliteState[] = [];
    const gpuData = new Float32Array(NUM_SAT * 4);
    const extendedData = new Float32Array(NUM_SAT * 16);

    for (let i = 0; i < limitedTLEs.length; i++) {
      const tle = limitedTLEs[i];
      const sat: SatelliteState = {
        id: i,
        keplerian: {
          a: tle.a,
          e: tle.e,
          i: tle.i,
          Ω: tle.Ω,
          ω: tle.ω,
          M: tle.M,
          n: tle.n,
        },
        cartesian: {
          position: new Float64Array(3),
          velocity: new Float64Array(3),
        },
        shellId: 0,
        planeId: Math.floor(i / SAT_PER_PLANE),
        satInPlaneId: i % SAT_PER_PLANE,
        bstar: tle.bstar,
        epoch: tle.epoch,
      };

      satellites.push(sat);

      // Pack GPU data
      const idx = i * 4;
      gpuData[idx + 0] = tle.Ω;
      gpuData[idx + 1] = tle.i;
      gpuData[idx + 2] = tle.M;
      gpuData[idx + 3] = Math.floor((i % 7)) + (tle.i * 10); // color + encoded inclination

      // Pack extended data
      const extIdx = i * 16;
      extendedData[extIdx + 0] = tle.a;
      extendedData[extIdx + 1] = tle.e;
      extendedData[extIdx + 2] = tle.i;
      extendedData[extIdx + 3] = tle.Ω;
      extendedData[extIdx + 4] = tle.ω;
      extendedData[extIdx + 5] = tle.M;
      extendedData[extIdx + 6] = tle.n || 0;
      // [7] reserved
      // [8-10] position - filled at runtime
      // [11] reserved
      // [12-14] velocity - filled at runtime
      // [15] epoch
    }

    // Fill remaining slots with generated data if needed
    if (satellites.length < NUM_SAT) {
      this.fillRemaining(satellites, gpuData, extendedData, satellites.length);
    }

    return {
      gpuData,
      extendedData,
      satellites,
      shellDistribution: [satellites.length],
    };
  }

  /**
   * Generate procedural constellation
   */
  loadProcedural(): {
    gpuData: GPUSatelliteData;
    extendedData: ExtendedSatelliteData;
    satellites: SatelliteState[];
    shellDistribution: number[];
  } {
    const elements = this.walkerGen.generateConstellation(this.config);
    const satellites: SatelliteState[] = [];
    const gpuData = new Float32Array(NUM_SAT * 4);
    const extendedData = new Float32Array(NUM_SAT * 16);
    
    const shellDistribution: number[] = this.config.shells.map(s => s.totalSats);

    // Calculate cumulative shell sizes
    let currentSat = 0;
    let currentShellIdx = 0;
    let satsInCurrentShell = 0;

    for (let i = 0; i < NUM_SAT; i++) {
      // Determine which shell this satellite belongs to
      while (currentShellIdx < this.config.shells.length && 
             satsInCurrentShell >= this.config.shells[currentShellIdx].totalSats) {
        satsInCurrentShell = 0;
        currentShellIdx++;
      }

      if (currentShellIdx >= this.config.shells.length) {
        // Wrap around to first shell if we run out
        currentShellIdx = 0;
        satsInCurrentShell = 0;
      }

      const shell = this.config.shells[currentShellIdx];
      const planeId = Math.floor(satsInCurrentShell / shell.satsPerPlane) % shell.numPlanes;
      const satInPlaneId = satsInCurrentShell % shell.satsPerPlane;

      // Generate elements for this satellite
      const a = PHYSICAL_CONSTANTS.EARTH_R + shell.altitude;
      const i = shell.inclination * PHYSICAL_CONSTANTS.DEG_TO_RAD;
      const Ω = (planeId / shell.numPlanes) * 2 * Math.PI;
      
      // Walker phasing
      const phaseOffset = (satsInCurrentShell / shell.totalSats) * 2 * Math.PI;
      const M = (satInPlaneId / shell.satsPerPlane) * 2 * Math.PI + phaseOffset;
      
      const elem: KeplerianElements = {
        a,
        e: 0.0001,
        i,
        Ω,
        ω: 0,
        M: ((M % (2 * Math.PI)) + (2 * Math.PI)) % (2 * Math.PI),
        n: Math.sqrt(PHYSICAL_CONSTANTS.MU / (a * a * a)),
      };

      const sat: SatelliteState = {
        id: i,
        keplerian: elem,
        cartesian: {
          position: new Float64Array(3),
          velocity: new Float64Array(3),
        },
        shellId: currentShellIdx,
        planeId,
        satInPlaneId,
      };

      satellites.push(sat);

      // Pack GPU data
      const idx = i * 4;
      gpuData[idx + 0] = elem.Ω;
      gpuData[idx + 1] = elem.i;
      gpuData[idx + 2] = elem.M;
      // Color based on shell, with some variation by plane
      gpuData[idx + 3] = currentShellIdx * 2 + (planeId % 7) * 0.1;

      // Pack extended data
      const extIdx = i * 16;
      extendedData[extIdx + 0] = elem.a;
      extendedData[extIdx + 1] = elem.e;
      extendedData[extIdx + 2] = elem.i;
      extendedData[extIdx + 3] = elem.Ω;
      extendedData[extIdx + 4] = elem.ω;
      extendedData[extIdx + 5] = elem.M;
      extendedData[extIdx + 6] = elem.n!;
      // [7] reserved
      // [8-10] position - filled at runtime
      // [11] reserved
      // [12-14] velocity - filled at runtime
      // [15] epoch

      satsInCurrentShell++;
      currentSat++;
    }

    return {
      gpuData,
      extendedData,
      satellites,
      shellDistribution,
    };
  }

  /**
   * Fill remaining satellite slots
   */
  private fillRemaining(
    satellites: SatelliteState[],
    gpuData: Float32Array,
    extendedData: Float32Array,
    startIdx: number
  ): void {
    const shell = this.config.shells[0];
    const a = PHYSICAL_CONSTANTS.EARTH_R + shell.altitude;
    const i = shell.inclination * PHYSICAL_CONSTANTS.DEG_TO_RAD;

    for (let idx = startIdx; idx < NUM_SAT; idx++) {
      const planeId = Math.floor(idx / SAT_PER_PLANE) % NUM_PLANES;
      const satInPlaneId = idx % SAT_PER_PLANE;

      const Ω = (planeId / NUM_PLANES) * 2 * Math.PI;
      const M = (satInPlaneId / SAT_PER_PLANE) * 2 * Math.PI;

      const elem: KeplerianElements = {
        a,
        e: 0.0001,
        i,
        Ω,
        ω: 0,
        M,
        n: Math.sqrt(PHYSICAL_CONSTANTS.MU / (a * a * a)),
      };

      const sat: SatelliteState = {
        id: idx,
        keplerian: elem,
        cartesian: {
          position: new Float64Array(3),
          velocity: new Float64Array(3),
        },
        shellId: 0,
        planeId,
        satInPlaneId,
      };

      satellites.push(sat);

      const gpuIdx = idx * 4;
      gpuData[gpuIdx + 0] = elem.Ω;
      gpuData[gpuIdx + 1] = elem.i;
      gpuData[gpuIdx + 2] = elem.M;
      gpuData[gpuIdx + 3] = planeId % 7;

      const extIdx = idx * 16;
      extendedData[extIdx + 0] = elem.a;
      extendedData[extIdx + 1] = elem.e;
      extendedData[extIdx + 2] = elem.i;
      extendedData[extIdx + 3] = elem.Ω;
      extendedData[extIdx + 4] = elem.ω;
      extendedData[extIdx + 5] = elem.M;
      extendedData[extIdx + 6] = elem.n!;
    }
  }

  /**
   * Get configuration
   */
  getConfig(): ConstellationConfig {
    return this.config;
  }

  /**
   * Set configuration
   */
  setConfig(config: ConstellationConfig): void {
    this.config = config;
  }
}

// Export singleton instance
export const defaultLoader = new ConstellationLoader();

// Utility functions for buffer management
export function createGPUBuffer(device: GPUDevice, data: Float32Array): GPUBuffer {
  const buffer = device.createBuffer({
    size: data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });

  new Float32Array(buffer.getMappedRange()).set(data);
  buffer.unmap();

  return buffer;
}

export function updateGPUBuffer(
  device: GPUDevice,
  buffer: GPUBuffer,
  data: Float32Array,
  offset: number = 0
): void {
  device.queue.writeBuffer(buffer, offset, data);
}
