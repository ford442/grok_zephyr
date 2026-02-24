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

    this.buffers = {
      orbitalElements,
      positions,
      uniforms,
      bloomUniforms,
    };

    return this.buffers;
  }

  /**
   * Generate Walker constellation orbital elements
   * 
   * Creates a evenly distributed constellation across multiple
   * inclination shells similar to Starlink.
   */
  generateOrbitalElements(): Float32Array {
    const { NUM_PLANES, SATELLITES_PER_PLANE } = CONSTANTS;
    const shells = INCLINATION_SHELLS;
    
    console.log(`[SatelliteGPUBuffer] Generating orbital elements...`);
    const startTime = performance.now();

    for (let plane = 0; plane < NUM_PLANES; plane++) {
      const raan = (plane / NUM_PLANES) * Math.PI * 2;
      const shellIndex = Math.floor(plane / (NUM_PLANES / shells.length));
      const inclination = shells[shellIndex] + (Math.random() - 0.5) * 0.008;

      for (let sat = 0; sat < SATELLITES_PER_PLANE; sat++) {
        const idx = (plane * SATELLITES_PER_PLANE + sat) * 4;
        const meanAnomaly = (sat / SATELLITES_PER_PLANE) * Math.PI * 2;

        // Store as vec4f: [raan, inclination, meanAnomaly, colorIndex]
        this.orbitalElementData[idx + 0] = raan;
        this.orbitalElementData[idx + 1] = inclination;
        this.orbitalElementData[idx + 2] = meanAnomaly;
        // Color index: rainbow by plane (0-6)
        this.orbitalElementData[idx + 3] = Math.floor((plane * 7) / NUM_PLANES);
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
   */
  calculateSatellitePosition(index: number, time: number): [number, number, number] {
    const i = index * 4;
    const raan = this.orbitalElementData[i];
    const inclination = this.orbitalElementData[i + 1];
    const meanAnomaly0 = this.orbitalElementData[i + 2];
    
    const meanAnomaly = meanAnomaly0 + CONSTANTS.MEAN_MOTION * time;
    
    const cM = Math.cos(meanAnomaly);
    const sM = Math.sin(meanAnomaly);
    const cR = Math.cos(raan);
    const sR = Math.sin(raan);
    const cI = Math.cos(inclination);
    const sI = Math.sin(inclination);

    return [
      CONSTANTS.ORBIT_RADIUS_KM * (cR * cM - sR * sM * cI),
      CONSTANTS.ORBIT_RADIUS_KM * (sR * cM + cR * sM * cI),
      CONSTANTS.ORBIT_RADIUS_KM * sM * sI,
    ];
  }

  /**
   * Calculate satellite velocity on CPU
   */
  calculateSatelliteVelocity(index: number, time: number): [number, number, number] {
    const i = index * 4;
    const raan = this.orbitalElementData[i];
    const inclination = this.orbitalElementData[i + 1];
    const meanAnomaly0 = this.orbitalElementData[i + 2];
    
    const meanAnomaly = meanAnomaly0 + CONSTANTS.MEAN_MOTION * time;
    
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
