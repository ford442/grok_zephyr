/**
 * Grok Zephyr - Satellite GPU Buffer Manager
 * 
 * Manages GPU buffers for 1M+ satellites with double-buffering
 * for efficient compute/graphics interop.
 */

import type WebGPUContext from './WebGPUContext.js';
import { CONSTANTS, BUFFER_SIZES, INCLINATION_SHELLS } from '@/types/constants.js';

/** Buffer pair for double-buffering */
export interface BufferPair {
  read: GPUBuffer;
  write: GPUBuffer;
  current: 'read' | 'write';
}

/** Satellite buffer configuration */
export interface SatelliteBufferConfig {
  /** Enable double-buffering for ping-pong rendering */
  doubleBuffer: boolean;
  /** Enable CPU readback (for debug/visualization) */
  enableReadback: boolean;
  /** Buffer usage flags */
  usage: GPUBufferUsageFlags;
}

/** Maximum number of laser beams */
export const MAX_BEAMS = 65536;

/** GPU buffer set for satellite data */
export interface SatelliteBufferSet {
  /** Orbital elements (read-only storage) */
  orbitalElements: GPUBuffer;
  /** Satellite positions (read-write storage) */
  positions: GPUBuffer | BufferPair;
  /** Uniform buffer for frame data */
  uniforms: GPUBuffer;
  /** Bloom uniform buffers (H and V passes) */
  bloomUniforms: {
    horizontal: GPUBuffer;
    vertical: GPUBuffer;
  };
  /** Beam data storage (start + end vec4 per beam) */
  beams: GPUBuffer;
  /** Beam params uniform (time, patternMode, density, padding) */
  beamParams: GPUBuffer;
}

/**
 * Satellite GPU Buffer Manager
 * 
 * Efficiently manages GPU memory for massive satellite constellations:
 * - Separate orbital elements buffer (read-only)
 * - Position buffer with optional double-buffering
 * - Uniform buffer for frame data
 * - Optimized memory layout for 1M+ satellites
 */
export class SatelliteGPUBuffer {
  private context: WebGPUContext;
  private config: SatelliteBufferConfig;
  
  // Buffer storage
  private buffers: SatelliteBufferSet | null = null;
  private orbitalElementData: Float32Array;
  
  // Cached sizes
  private readonly numSatellites: number;
  private readonly positionBufferSize: number;
  private readonly elementBufferSize: number;

  constructor(
    context: WebGPUContext,
    config: Partial<SatelliteBufferConfig> = {}
  ) {
    this.context = context;
    this.config = {
      doubleBuffer: false,
      enableReadback: false,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      ...config,
    };
    
    this.numSatellites = CONSTANTS.NUM_SATELLITES;
    this.positionBufferSize = this.numSatellites * BUFFER_SIZES.SATELLITE_DATA;
    this.elementBufferSize = this.numSatellites * BUFFER_SIZES.ORBITAL_ELEMENT;
    
    // Pre-allocate orbital element data on CPU
    this.orbitalElementData = new Float32Array(this.numSatellites * 4);
  }

  /**
   * Initialize all GPU buffers
   */
  initialize(): SatelliteBufferSet {
    console.log(`[SatelliteGPUBuffer] Initializing buffers for ${this.numSatellites.toLocaleString()} satellites`);
    console.log(`[SatelliteGPUBuffer] Position buffer: ${(this.positionBufferSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`[SatelliteGPUBuffer] Element buffer: ${(this.elementBufferSize / 1024 / 1024).toFixed(2)} MB`);

    // Create orbital elements buffer (read-only)
    const orbitalElements = this.context.createBuffer(
      this.elementBufferSize,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );

    // Create position buffer(s)
    let positions: GPUBuffer | BufferPair;
    if (this.config.doubleBuffer) {
      positions = {
        read: this.context.createStorageBuffer(this.positionBufferSize),
        write: this.context.createStorageBuffer(this.positionBufferSize),
        current: 'read',
      };
    } else {
      positions = this.context.createStorageBuffer(this.positionBufferSize);
    }

    // Create uniform buffer (256 bytes, aligned)
    const uniforms = this.context.createUniformBuffer(BUFFER_SIZES.UNIFORM);

    // Create bloom uniform buffers
    const bloomUniforms = {
      horizontal: this.context.createUniformBuffer(BUFFER_SIZES.BLOOM_UNIFORM),
      vertical: this.context.createUniformBuffer(BUFFER_SIZES.BLOOM_UNIFORM),
    };

    // Create beam storage buffer (2 vec4f per beam = 32 bytes per beam)
    const beamBufferSize = MAX_BEAMS * 32;
    console.log(`[SatelliteGPUBuffer] Beam buffer: ${(beamBufferSize / 1024).toFixed(2)} KB (${MAX_BEAMS} beams)`);
    const beams = this.context.createBuffer(
      beamBufferSize,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    
    // Create beam params uniform buffer (16 bytes: time, patternMode, density, pad)
    const beamParams = this.context.createUniformBuffer(16);
    // Initialize with default pattern mode 1 (GROK logo)
    const beamParamsData = new Float32Array(4);
    beamParamsData[0] = 0;      // time
    beamParamsData[1] = 1;      // patternMode (GROK logo default)
    beamParamsData[2] = MAX_BEAMS;  // density
    beamParamsData[3] = 0;      // padding
    this.context.writeBuffer(beamParams, beamParamsData);

    this.buffers = {
      orbitalElements,
      positions,
      uniforms,
      bloomUniforms,
      beams,
      beamParams,
    };

    return this.buffers;
  }

  /**
   * Generate Walker constellation orbital elements with multi-shell orbits
   * 
   * Creates Starlink-style constellation with 3 altitude shells:
   * - Shell 0: 340 km altitude (6711 km radius) - ~30% of satellites
   * - Shell 1: 550 km altitude (6921 km radius) - ~50% of satellites  
   * - Shell 2: 1150 km altitude (7521 km radius) - ~20% of satellites
   */
  generateOrbitalElements(): Float32Array {
    const { NUM_PLANES, SATELLITES_PER_PLANE } = CONSTANTS;
    const shells = INCLINATION_SHELLS;
    
    // Multi-shell configuration
    const SHELL_DISTRIBUTION = [0.3, 0.5, 0.2];  // 30%, 50%, 20%
    const SHELL_ALTITUDES_KM = [340.0, 550.0, 1150.0];
    const SHELL_RADII_KM = SHELL_ALTITUDES_KM.map(alt => 6371.0 + alt);
    
    console.log(`[SatelliteGPUBuffer] Generating multi-shell orbital elements...`);
    console.log(`[SatelliteGPUBuffer] Shells: 340km (${(SHELL_DISTRIBUTION[0]*100).toFixed(0)}%), 550km (${(SHELL_DISTRIBUTION[1]*100).toFixed(0)}%), 1150km (${(SHELL_DISTRIBUTION[2]*100).toFixed(0)}%)`);
    const startTime = performance.now();

    for (let plane = 0; plane < NUM_PLANES; plane++) {
      const raan = (plane / NUM_PLANES) * Math.PI * 2;
      const inclinationShellIdx = Math.floor(plane / (NUM_PLANES / shells.length));
      const inclination = shells[inclinationShellIdx] + (Math.random() - 0.5) * 0.008;

      for (let sat = 0; sat < SATELLITES_PER_PLANE; sat++) {
        const idx = (plane * SATELLITES_PER_PLANE + sat) * 4;
        const meanAnomaly = (sat / SATELLITES_PER_PLANE) * Math.PI * 2;
        
        // Determine altitude shell based on distribution
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
        
        // Color based on shell (0=blue, 1=white, 2=gold)
        const shellColors = [2.0, 6.0, 3.0];  // Blue, White, Gold
        const colorIndex = shellColors[shellIndex];

        // Store as vec4f: [raan, inclination, meanAnomaly, shellData]
        // shellData encodes: shellIndex in upper bits, colorIndex in lower bits
        const shellData = (shellIndex << 8) | (colorIndex & 0xFF);
        
        this.orbitalElementData[idx + 0] = raan;
        this.orbitalElementData[idx + 1] = inclination;
        this.orbitalElementData[idx + 2] = meanAnomaly;
        this.orbitalElementData[idx + 3] = shellData;
      }
    }

    const elapsed = performance.now() - startTime;
    console.log(`[SatelliteGPUBuffer] Generated elements in ${elapsed.toFixed(2)}ms`);

    return this.orbitalElementData;
  }

  /**
   * Upload orbital elements to GPU
   */
  uploadOrbitalElements(): void {
    if (!this.buffers) {
      throw new Error('Buffers not initialized. Call initialize() first.');
    }
    this.context.writeBuffer(this.buffers.orbitalElements, this.orbitalElementData);
  }

  /**
   * Update bloom uniforms for current resolution
   */
  updateBloomUniforms(width: number, height: number): void {
    if (!this.buffers) return;

    const createData = (horizontal: boolean): ArrayBuffer => {
      const buffer = new ArrayBuffer(32);
      const f32 = new Float32Array(buffer);
      const u32 = new Uint32Array(buffer);
      f32[0] = 1 / width;
      f32[1] = 1 / height;
      u32[2] = horizontal ? 1 : 0;
      u32[3] = 0;
      return buffer;
    };

    this.context.writeBuffer(
      this.buffers.bloomUniforms.horizontal,
      createData(true)
    );
    this.context.writeBuffer(
      this.buffers.bloomUniforms.vertical,
      createData(false)
    );
  }

  /**
   * Get the current position buffer (for rendering)
   */
  getPositionBufferForRender(): GPUBuffer {
    if (!this.buffers) {
      throw new Error('Buffers not initialized');
    }
    
    if (this.isBufferPair(this.buffers.positions)) {
      return this.buffers.positions.current === 'read'
        ? this.buffers.positions.read
        : this.buffers.positions.write;
    }
    
    return this.buffers.positions;
  }

  /**
   * Get the current position buffer (for compute)
   */
  getPositionBufferForCompute(): GPUBuffer {
    if (!this.buffers) {
      throw new Error('Buffers not initialized');
    }
    
    if (this.isBufferPair(this.buffers.positions)) {
      return this.buffers.positions.current === 'read'
        ? this.buffers.positions.write
        : this.buffers.positions.read;
    }
    
    return this.buffers.positions;
  }

  /**
   * Swap double buffers (ping-pong)
   */
  swapBuffers(): void {
    if (!this.buffers || !this.isBufferPair(this.buffers.positions)) {
      return;
    }
    
    this.buffers.positions.current =
      this.buffers.positions.current === 'read' ? 'write' : 'read';
  }

  /**
   * Get all buffers
   */
  getBuffers(): SatelliteBufferSet {
    if (!this.buffers) {
      throw new Error('Buffers not initialized. Call initialize() first.');
    }
    return this.buffers;
  }

  /**
   * Get orbital element data (for CPU-side calculations)
   */
  getOrbitalElementData(): Float32Array {
    return this.orbitalElementData;
  }

  /**
   * Calculate satellite position on CPU (for camera tracking)
   * Supports multi-shell orbits
   */
  calculateSatellitePosition(index: number, time: number): [number, number, number] {
    const i = index * 4;
    const raan = this.orbitalElementData[i];
    const inclination = this.orbitalElementData[i + 1];
    const meanAnomaly0 = this.orbitalElementData[i + 2];
    const shellData = this.orbitalElementData[i + 3];
    
    // Extract shell index
    const shellIndex = (shellData >> 8) & 0xFF;
    const SHELL_RADII_KM = [6711.0, 6921.0, 7521.0];
    const orbitR = SHELL_RADII_KM[shellIndex] || 6921.0;
    
    const meanMotions = [0.001153, 0.001097, 0.000946];
    const meanMotion = meanMotions[shellIndex] || 0.001097;
    
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
   * Calculate satellite velocity on CPU (multi-shell)
   */
  calculateSatelliteVelocity(index: number, time: number): [number, number, number] {
    const i = index * 4;
    const raan = this.orbitalElementData[i];
    const inclination = this.orbitalElementData[i + 1];
    const meanAnomaly0 = this.orbitalElementData[i + 2];
    const shellData = this.orbitalElementData[i + 3];
    
    const shellIndex = (shellData >> 8) & 0xFF;
    const meanMotions = [0.001153, 0.001097, 0.000946];
    const meanMotion = meanMotions[shellIndex] || 0.001097;
    
    const meanAnomaly = meanAnomaly0 + meanMotion * time;
    
    const cM = Math.cos(meanAnomaly);
    const sM = Math.sin(meanAnomaly);
    const cR = Math.cos(raan);
    const sR = Math.sin(raan);
    const cI = Math.cos(inclination);
    const sI = Math.sin(inclination);

    // dpos/dM (normalized velocity direction)
    const vx = -(cR * sM + sR * cM * cI);
    const vy = -(sR * sM - cR * cM * cI);
    const vz = cM * sI;
    
    const len = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
    return [vx / len, vy / len, vz / len];
  }

  /**
   * Read position data back from GPU (async)
   */
  async readbackPositions(): Promise<Float32Array | null> {
    if (!this.buffers || !this.config.enableReadback) {
      return null;
    }

    const device = this.context.getDevice();
    const positionBuffer = this.getPositionBufferForRender();
    
    // Create staging buffer for readback
    const stagingBuffer = device.createBuffer({
      size: this.positionBufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    // Encode copy command
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(
      positionBuffer,
      0,
      stagingBuffer,
      0,
      this.positionBufferSize
    );
    device.queue.submit([encoder.finish()]);

    // Map and read
    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(stagingBuffer.getMappedRange().slice(0));
    stagingBuffer.unmap();
    stagingBuffer.destroy();

    return data;
  }

  /**
   * Calculate total GPU memory usage in bytes
   */
  getMemoryUsage(): number {
    let total = this.elementBufferSize + BUFFER_SIZES.UNIFORM + BUFFER_SIZES.BLOOM_UNIFORM * 2;
    
    if (this.config.doubleBuffer && this.buffers && this.isBufferPair(this.buffers.positions)) {
      total += this.positionBufferSize * 2;
    } else {
      total += this.positionBufferSize;
    }
    
    return total;
  }

  /**
   * Destroy and cleanup all buffers
   */
  destroy(): void {
    if (this.buffers) {
      this.buffers.orbitalElements.destroy();
      this.buffers.uniforms.destroy();
      this.buffers.bloomUniforms.horizontal.destroy();
      this.buffers.bloomUniforms.vertical.destroy();
      this.buffers.beams.destroy();
      this.buffers.beamParams.destroy();
      
      if (this.isBufferPair(this.buffers.positions)) {
        this.buffers.positions.read.destroy();
        this.buffers.positions.write.destroy();
      } else {
        this.buffers.positions.destroy();
      }
      
      this.buffers = null;
    }
  }

  /**
   * Type guard for BufferPair
   */
  private isBufferPair(buffer: GPUBuffer | BufferPair): buffer is BufferPair {
    return 'read' in buffer && 'write' in buffer;
  }
}

export default SatelliteGPUBuffer;
