/**
 * Grok Zephyr - Satellite GPU Buffer Manager (Optimized for Pascal)
 *
 * Manages GPU buffers for 1M+ satellites with tight packing
 * Total storage: ~80 MB (under Pascal 128 MB limit)
 *
 * Optimizations:
 * - Tight buffer packing (rgba8unorm for colors)
 * - Double-buffered staging uploads (zero CPU stall)
 * - Safety guards to prevent 8GB allocation crash
 */

import type { WebGPUContext } from './WebGPUContext.js';
import { CONSTANTS, BUFFER_SIZES } from '@/types/constants.js';
import type { TLEData } from '@/types/index.js';
import { OrbitalElements } from './OrbitalElements.js';
import {
  EXTENDED_FLOATS_PER_SATELLITE,
  TlePropagator,
  propagateKeplerian,
  readKeplerianExtended,
  writeKeplerianExtended,
  writeShellExtended,
} from '@/physics/index.js';
import { getSimWorkerClient } from '@/workers/SimWorkerClient.js';
import {
  buildGroupParamsUniform,
  createDefaultVisibility,
  type GroupVisibilityState,
  GROUP_PARAMS_UNIFORM_SIZE,
} from '@/data/ConstellationGroups.js';

/** Re-anchor SGP4 elements every N simulation seconds. */
const REANCHOR_INTERVAL_SIM_SEC = 180;
/** Satellites re-anchored per frame to avoid main-thread spikes. */
const REANCHOR_CHUNK_SIZE = 512;

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

/** Pascal GPU safe limit (conservative) */
const MAX_SAFE_BUFFER_SIZE = 128 * 1024 * 1024; // 128 MB

/** Warning threshold - log warning if buffer size exceeds this (for safety margin) */
const WARNING_BUFFER_THRESHOLD = 120 * 1024 * 1024; // 120 MB

/** GPU buffer set for satellite data */
export interface SatelliteBufferSet {
  /** Orbital elements (read-only storage) */
  orbitalElements: GPUBuffer;
  /** Extended orbital elements for J2 propagation (32 bytes/sat: 8 floats, compact) */
  extendedElements: GPUBuffer;
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
  /** Pattern params uniform for animation patterns (time, mode, seed, pad) */
  patternParams: GPUBuffer;
  /** Per-satellite RGBA color (packed rgba8unorm u32, 4 MB for 1M sats) */
  colors: GPUBuffer;
  /** Sky Strips: Per-satellite pattern data (16 bytes per sat: brightness, patternId, phase, speed) */
  patterns: GPUBuffer;
  /** Sky Strips: Uniform buffer for pattern compute shader */
  skyStripUniforms: GPUBuffer;
  /** Smile V2: Uniform buffer for animation state (96 bytes) */
  smileV2Uniforms: GPUBuffer;
  /** Smile V2: Trail buffer for phase 6 trails (2 frames × 16 bytes) */
  trailBuffer: GPUBuffer;
  /** Per-satellite constellation group id (u32, 4 MB for 1M sats) */
  groupIds: GPUBuffer;
  /** Per-group render parameters (colors, size, visibility) */
  groupParams: GPUBuffer;
}

/**
 * Double-buffered staging for async uploads
 * Prevents CPU stall on MAP_WRITE buffers
 */
export class StagingBuffer {
  private buffers: GPUBuffer[] = [];
  private index = 0;

  constructor(
    private device: GPUDevice,
    private size: number,
  ) {
    this.buffers = [this.createStagingBuffer(size, 0), this.createStagingBuffer(size, 1)];
  }

  private createStagingBuffer(size: number, idx: number): GPUBuffer {
    return this.device.createBuffer({
      label: `Staging Buffer ${idx} (${(size / 1024 / 1024).toFixed(1)} MB)`,
      size,
      usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC,
    });
  }

  async upload(data: ArrayBufferLike, targetBuffer: GPUBuffer, commandEncoder: GPUCommandEncoder) {
    const buf = this.buffers[this.index];
    await buf.mapAsync(GPUMapMode.WRITE);
    new Uint8Array(buf.getMappedRange()).set(new Uint8Array(data));
    buf.unmap();

    commandEncoder.copyBufferToBuffer(
      buf,
      0,
      targetBuffer,
      0,
      Math.min(this.size, data.byteLength),
    );
    this.index = 1 - this.index;
  }
}

/**
 * Satellite GPU Buffer Manager
 *
 * Efficiently manages GPU memory for massive satellite constellations:
 * - Tight buffer packing to stay under Pascal limits
 * - Separate orbital elements buffer (read-only)
 * - Position buffer with optional double-buffering
 * - Double-buffered staging for zero-stall uploads
 */
export class SatelliteGPUBuffer {
  private context: WebGPUContext;
  private config: SatelliteBufferConfig;

  // Buffer storage
  private buffers: SatelliteBufferSet | null = null;
  /** Shared, GPU-agnostic orbital element store (also used by the WebGL2 backend). */
  private orbital: OrbitalElements;
  private staging: StagingBuffer | null = null;
  private readonly extendedElementData: Float32Array;
  private tlePropagator: TlePropagator | null = null;
  private tleRealCount = 0;
  private realismEnabled = false;
  private simEpochMs = Date.now();
  private lastReanchorCycleSimTime = 0;
  private reanchorCursor = 0;
  private loadedTles: TLEData[] = [];
  private readonly groupIdData: Uint32Array;
  private groupVisibility: GroupVisibilityState = createDefaultVisibility();

  /** Backing CPU array for orbital elements, owned by `this.orbital`. */
  private get orbitalElementData(): Float32Array {
    return this.orbital.data;
  }

  // Cached sizes
  private readonly numSatellites: number;
  private readonly positionBufferSize: number;
  private readonly elementBufferSize: number;
  private readonly extendedElementBufferSize: number;

  constructor(context: WebGPUContext, config: Partial<SatelliteBufferConfig> = {}) {
    this.context = context;
    this.config = {
      doubleBuffer: false,
      enableReadback: false,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      ...config,
    };

    this.numSatellites = CONSTANTS.NUM_SATELLITES;
    this.positionBufferSize = this.numSatellites * 16; // vec4f
    this.elementBufferSize = this.numSatellites * 16; // vec4f
    this.extendedElementBufferSize = this.numSatellites * 32; // 8 floats for J2 propagation (compact)

    // Pre-allocate orbital element data on CPU (shared with the WebGL2 backend)
    this.orbital = new OrbitalElements(this.numSatellites);
    this.extendedElementData = new Float32Array(this.numSatellites * EXTENDED_FLOATS_PER_SATELLITE);
    this.groupIdData = new Uint32Array(this.numSatellites);
  }

  /**
   * Calculate total buffer size for safety check
   *
   * Buffer breakdown for 1M satellites:
   * - Position: 16 MB (vec4<f32>)
   * - Elements: 16 MB (vec4<f32>)
   * - Extended: 32 MB (8 floats × 4 bytes, compact)
   * - Colors: 4 MB (rgba8unorm packed)
   * - Patterns: 16 MB (Sky Strips pattern data)
   * - Beams: 2 MB (64k beams × 32 bytes)
   * - Trails: 32 MB (2 frames × vec4f, reduced from 4)
   * - Uniforms: ~1 KB (various uniform buffers)
   * Total: ~118 MB (under 128 MB Pascal limit)
   */
  private calculateTotalBufferSize(): number {
    const numSats = this.numSatellites;

    // Tight, realistic sizes
    const POSITION_SIZE = numSats * 16; // vec4<f32> (pos + flare)
    const ELEMENT_SIZE = numSats * 16; // vec4<f32> (elements)
    const EXT_ELEM_SIZE = numSats * 32; // 8 floats × 4 bytes (COMPACT)
    const COLOR_SIZE = numSats * 4; // rgba8unorm packed
    const PATTERN_SIZE = numSats * 16; // Sky Strips pattern data
    const BEAM_SIZE = 65536 * 32; // 64k beams
    const TRAIL_SIZE = numSats * 16 * 2; // 2 frames × vec4f (REDUCED from 4)
    const UNIFORM_SIZE = 256 + 32 + 16 + 16 + 64 + 32; // Various uniform buffers (includes skyStripUniforms)

    const total =
      POSITION_SIZE +
      ELEMENT_SIZE +
      EXT_ELEM_SIZE +
      COLOR_SIZE +
      PATTERN_SIZE +
      BEAM_SIZE +
      TRAIL_SIZE +
      UNIFORM_SIZE;

    // Detailed buffer size breakdown for debugging
    console.log(`[Buffer Size Debug] Breakdown for ${numSats.toLocaleString()} satellites:`);
    console.log(
      `  Position:   ${(POSITION_SIZE / 1024 / 1024).toFixed(2)} MB (${numSats} × 16 bytes)`,
    );
    console.log(
      `  Elements:   ${(ELEMENT_SIZE / 1024 / 1024).toFixed(2)} MB (${numSats} × 16 bytes)`,
    );
    console.log(
      `  Extended:   ${(EXT_ELEM_SIZE / 1024 / 1024).toFixed(2)} MB (${numSats} × 32 bytes, COMPACT)`,
    );
    console.log(`  Colors:     ${(COLOR_SIZE / 1024 / 1024).toFixed(2)} MB (${numSats} × 4 bytes)`);
    console.log(
      `  Patterns:   ${(PATTERN_SIZE / 1024 / 1024).toFixed(2)} MB (${numSats} × 16 bytes)`,
    );
    console.log(`  Beams:      ${(BEAM_SIZE / 1024 / 1024).toFixed(2)} MB (65536 × 32 bytes)`);
    console.log(
      `  Trails:     ${(TRAIL_SIZE / 1024 / 1024).toFixed(2)} MB (${numSats} × 16 × 2 frames, REDUCED)`,
    );
    console.log(`  Uniforms:   ${(UNIFORM_SIZE / 1024).toFixed(2)} KB`);
    console.log(`  TOTAL:      ${(total / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  LIMIT:      128.00 MB (Pascal safe limit)`);
    console.log(`  MARGIN:      ${((MAX_SAFE_BUFFER_SIZE - total) / 1024 / 1024).toFixed(2)} MB`);

    return total;
  }

  /**
   * Initialize all GPU buffers
   *
   * SAFETY: Total buffer size is capped to prevent exceeding Pascal GPU limits
   * (maxStorageBufferBindingSize = 134 MB, we use conservative 128 MB limit)
   */
  initialize(): SatelliteBufferSet {
    const numSats = CONSTANTS.NUM_SATELLITES;
    const totalBytes = this.calculateTotalBufferSize();

    console.log(
      `[SatelliteGPUBuffer] Initializing buffers for ${numSats.toLocaleString()} satellites`,
    );
    console.log(
      `[SatelliteGPUBuffer] Total storage requested: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`,
    );

    // ← SAFETY GUARD (prevents the 8GB crash)
    if (totalBytes > MAX_SAFE_BUFFER_SIZE) {
      const exceeded = ((totalBytes - MAX_SAFE_BUFFER_SIZE) / 1024 / 1024).toFixed(2);
      throw new Error(
        `Buffer total (${(totalBytes / 1024 / 1024).toFixed(1)} MB) exceeds Pascal safe limit of 128 MB ` +
          `(exceeded by ${exceeded} MB). Reduce NUM_SATELLITES or buffer sizes.`,
      );
    }

    // Warning if approaching the limit (safety margin)
    if (totalBytes > WARNING_BUFFER_THRESHOLD) {
      const margin = ((MAX_SAFE_BUFFER_SIZE - totalBytes) / 1024 / 1024).toFixed(2);
      console.warn(
        `[Buffer Safety] WARNING: Buffer size (${(totalBytes / 1024 / 1024).toFixed(2)} MB) is within ${margin} MB of the 128 MB limit`,
      );
    }

    console.log(
      `[Buffer Safety] Total allocated: ${(totalBytes / 1024 / 1024).toFixed(2)} MB — OK ✓`,
    );

    // Create orbital elements buffer (read-only)
    const orbitalElements = this.context.createBuffer(
      this.elementBufferSize,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );

    // Create extended orbital elements buffer for J2 propagation (32 bytes/satellite, compact)
    const extendedElements = this.context.createBuffer(
      this.extendedElementBufferSize,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );

    // Initialize extended orbital elements (SGP4 Keplerian or shell fallback per satellite)
    this.rebuildExtendedElements(0);
    const extData = this.extendedElementData;
    this.context.getDevice().queue.writeBuffer(
      extendedElements,
      0,
      extData.buffer,
      extData.byteOffset,
      extData.byteLength,
    );
    console.log(
      `[SatelliteGPUBuffer] Extended elements buffer: ${(this.extendedElementBufferSize / 1024 / 1024).toFixed(2)} MB (Keplerian / shell)`,
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
    const beams = this.context.createBuffer(
      beamBufferSize,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );

    // Create beam params uniform buffer (256 bytes for new volumetric beams)
    const beamParams = this.context.createUniformBuffer(256);
    const beamParamsData = new Float32Array(64);
    this.context.writeBuffer(beamParams, beamParamsData);

    // Create pattern params uniform buffer
    const patternParams = this.context.createUniformBuffer(16);
    const patternParamsData = new ArrayBuffer(16);
    const ppU32 = new Uint32Array(patternParamsData);
    const ppF32 = new Float32Array(patternParamsData);
    ppU32[0] = 0; // pattern_mode
    ppF32[1] = 0; // animation_time
    ppF32[2] = 0; // seed
    ppU32[3] = 0; // selected_satellite
    this.context.writeBuffer(patternParams, patternParamsData);

    // Create per-satellite RGBA color buffer (rgba8unorm packed as u32, 4 MB)
    const colorBufferSize = numSats * 4;
    const colors = this.context.createBuffer(
      colorBufferSize,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    const colorData = new Uint32Array(numSats);
    colorData.fill(0xffffffff);
    this.context.writeBuffer(colors, colorData);
    console.log(
      `[SatelliteGPUBuffer] Color buffer: ${(colorBufferSize / 1024 / 1024).toFixed(2)} MB (rgba8unorm)`,
    );

    // Create Sky Strips pattern data buffer (16 bytes per satellite: vec4f)
    const patternBufferSize = numSats * 16;
    const patterns = this.context.createBuffer(
      patternBufferSize,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    const patternData = new Float32Array(numSats * 4);
    for (let i = 0; i < numSats; i++) {
      const idx = i * 4;
      patternData[idx + 0] = 0.7 + Math.random() * 0.3;
      patternData[idx + 1] = 0; // patternId
      patternData[idx + 2] = (i % 1000) * 0.01;
      patternData[idx + 3] = 0.8 + Math.random() * 0.4;
    }
    this.context.writeBuffer(patterns, patternData);
    console.log(
      `[SatelliteGPUBuffer] Pattern buffer: ${(patternBufferSize / 1024 / 1024).toFixed(2)} MB (Sky Strips)`,
    );

    // Create Sky Strips uniform buffer (48 bytes to match WGSL struct)
    const skyStripUniforms = this.context.createUniformBuffer(48);
    const skyStripUniformsData = new Float32Array(12);
    skyStripUniformsData[0] = 0; // time
    skyStripUniformsData[1] = 0; // beatIntensity
    skyStripUniformsData[2] = 0; // beatPulse
    skyStripUniformsData[3] = 120; // bpm
    skyStripUniformsData[4] = 0.8; // globalBrightness
    skyStripUniformsData[5] = 1.0; // patternBlend
    skyStripUniformsData[6] = 15; // morseSpeed
    skyStripUniformsData[7] = 0.1; // sparkleDensity
    // [8..11] reserved vec4f (already zero)
    this.context.writeBuffer(skyStripUniforms, skyStripUniformsData);

    // Create Smile V2 uniform buffer (96 bytes to match WGSL SmileV2Params)
    const smileV2Uniforms = this.context.createUniformBuffer(96);
    const smileV2UniformsData = new Float32Array(24); // 96 bytes, all zero
    this.context.writeBuffer(smileV2Uniforms, smileV2UniformsData);

    // Create Smile V2 trail buffer (2 frames × vec4f per satellite)
    const TRAIL_HISTORY_FRAMES = 2;
    const trailBufferSize = numSats * 16 * TRAIL_HISTORY_FRAMES;
    const trailBuffer = this.context.createBuffer(
      trailBufferSize,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    const trailData = new Float32Array(numSats * 4 * TRAIL_HISTORY_FRAMES);
    this.context.writeBuffer(trailBuffer, trailData);
    console.log(
      `[SatelliteGPUBuffer] Trail buffer: ${(trailBufferSize / 1024 / 1024).toFixed(2)} MB (${TRAIL_HISTORY_FRAMES} frames)`,
    );

    const groupIdBufferSize = numSats * 4;
    const groupIds = this.context.createBuffer(
      groupIdBufferSize,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    const groupParams = this.context.createUniformBuffer(GROUP_PARAMS_UNIFORM_SIZE);
    this.groupIdData.fill(0);
    this.context.writeBuffer(groupIds, this.groupIdData);
    this.uploadGroupParams();
    console.log(
      `[SatelliteGPUBuffer] Group IDs buffer: ${(groupIdBufferSize / 1024 / 1024).toFixed(2)} MB`,
    );

    // Create staging buffer for async uploads
    this.staging = new StagingBuffer(
      this.context.getDevice(),
      Math.max(this.positionBufferSize, patternBufferSize),
    );

    this.buffers = {
      orbitalElements,
      extendedElements,
      positions,
      uniforms,
      bloomUniforms,
      beams,
      beamParams,
      patternParams,
      colors,
      patterns,
      skyStripUniforms,
      smileV2Uniforms,
      trailBuffer,
      groupIds,
      groupParams,
    };

    return this.buffers;
  }

  /**
   * Upload dynamic data using staging buffer (zero stall)
   */
  async uploadDynamicData(
    data: {
      position?: ArrayBufferLike;
      pattern?: ArrayBufferLike;
      color?: ArrayBufferLike;
    },
    commandEncoder: GPUCommandEncoder,
  ): Promise<void> {
    if (!this.staging || !this.buffers) {
      throw new Error('Buffers not initialized');
    }

    if (data.position) {
      const target = this.isBufferPair(this.buffers.positions)
        ? this.buffers.positions.write
        : this.buffers.positions;
      await this.staging.upload(data.position, target, commandEncoder);
    }
    if (data.pattern) {
      await this.staging.upload(data.pattern, this.buffers.patterns, commandEncoder);
    }
    if (data.color) {
      await this.staging.upload(data.color, this.buffers.colors, commandEncoder);
    }
  }

  /**
   * Generate Walker constellation orbital elements with multi-shell orbits.
   * Heavy CPU work runs in the simulation worker; results transfer as an ArrayBuffer.
   */
  async generateOrbitalElements(): Promise<Float32Array> {
    console.log(`[SatelliteGPUBuffer] Generating multi-shell orbital elements...`);
    const startTime = performance.now();

    this.tlePropagator = null;
    this.tleRealCount = 0;
    this.loadedTles = [];
    this.realismEnabled = false;

    const result = await getSimWorkerClient().generateOrbitalElements(this.numSatellites);
    this.orbital.adoptBuffer(result.orbitalBuffer);
    if (result.groupIdsBuffer) {
      this.adoptGroupIds(result.groupIdsBuffer);
    }
    this.rebuildExtendedElements(0);

    const elapsed = performance.now() - startTime;
    console.log(`[SatelliteGPUBuffer] Generated elements in ${elapsed.toFixed(2)}ms`);

    return this.orbital.data;
  }

  /**
   * Load merged multi-catalog TLE segments with group IDs from the worker.
   */
  async loadFromMergedCatalog(
    tles: TLEData[],
    segments: import('@/core/OrbitalElements.js').MergedCatalogSegment[],
    groupIdsBuffer: ArrayBuffer,
    anchorSimTime?: number,
  ): Promise<number> {
    const startTime = performance.now();

    console.log(
      `[SatelliteGPUBuffer] Loading merged catalog (${tles.length} TLE satellites across ${segments.length} groups)...`,
    );

    this.loadedTles = tles;
    this.tlePropagator = new TlePropagator();
    this.tleRealCount = this.tlePropagator.load(tles, this.numSatellites);
    void this.tlePropagator.initWasm();

    const result = await getSimWorkerClient().mergeCatalogElements(segments, this.numSatellites);
    this.orbital.adoptBuffer(result.orbitalBuffer);
    if (result.groupIdsBuffer) {
      this.adoptGroupIds(result.groupIdsBuffer);
    } else {
      this.adoptGroupIds(groupIdsBuffer);
    }

    if (anchorSimTime !== undefined) {
      this.simEpochMs = Date.now();
      this.realismEnabled = true;
      this.rebuildExtendedElements(anchorSimTime);
      this.lastReanchorCycleSimTime = anchorSimTime;
      this.reanchorCursor = this.tleRealCount;
    } else {
      this.realismEnabled = false;
      this.rebuildExtendedElements(0);
    }

    const elapsed = performance.now() - startTime;
    console.log(`[SatelliteGPUBuffer] Merged catalog load complete in ${elapsed.toFixed(2)}ms`);
    return result.realTleCount;
  }

  /**
   * Load orbital elements from parsed TLE data (shell-classified, art-directed layout).
   * Element derivation runs in the simulation worker.
   */
  async loadFromTLEData(tles: TLEData[]): Promise<number> {
    const startTime = performance.now();

    console.log(
      `[SatelliteGPUBuffer] Loading ${Math.min(tles.length, this.numSatellites)} TLE satellites...`,
    );

    this.loadedTles = tles;
    this.tlePropagator = new TlePropagator();
    this.tleRealCount = this.tlePropagator.load(tles, this.numSatellites);
    void this.tlePropagator.initWasm();

    const result = await getSimWorkerClient().deriveOrbitalElementsFromTLE(tles, this.numSatellites);
    this.orbital.adoptBuffer(result.orbitalBuffer);
    if (result.groupIdsBuffer) {
      this.adoptGroupIds(result.groupIdsBuffer);
    }
    this.rebuildExtendedElements(0);

    const elapsed = performance.now() - startTime;
    console.log(`[SatelliteGPUBuffer] TLE load complete in ${elapsed.toFixed(2)}ms`);
    return result.realTleCount;
  }

  /**
   * Load TLE catalog and anchor osculating Keplerian elements via SGP4 for realism mode.
   */
  async loadFromTLEDataWithSgp4(tles: TLEData[], anchorSimTime: number): Promise<number> {
    const count = await this.loadFromTLEData(tles);
    this.simEpochMs = Date.now();
    this.realismEnabled = true;
    this.rebuildExtendedElements(anchorSimTime);
    this.lastReanchorCycleSimTime = anchorSimTime;
    this.reanchorCursor = this.tleRealCount;
    return count;
  }

  setRealismEnabled(enabled: boolean, simTime: number): void {
    this.realismEnabled = enabled;
    if (enabled && this.tlePropagator && this.tleRealCount > 0) {
      this.rebuildExtendedElements(simTime);
      this.lastReanchorCycleSimTime = simTime;
      this.reanchorCursor = this.tleRealCount;
    }
    this.uploadExtendedElements();
  }

  isRealismEnabled(): boolean {
    return this.realismEnabled;
  }

  hasTleCatalog(): boolean {
    return this.tleRealCount > 0;
  }

  getTleRealCount(): number {
    return this.tleRealCount;
  }

  getTlePropagator(): TlePropagator | null {
    return this.tlePropagator;
  }

  getLoadedTles(): readonly TLEData[] {
    return this.loadedTles;
  }

  /** Chunked SGP4 re-anchor to bound Keplerian drift without jank. */
  tickSgp4Reanchor(simTime: number): void {
    if (!this.realismEnabled || !this.tlePropagator || this.tleRealCount === 0 || !this.buffers) {
      return;
    }

    if (this.reanchorCursor >= this.tleRealCount) {
      if (simTime - this.lastReanchorCycleSimTime < REANCHOR_INTERVAL_SIM_SEC) {
        return;
      }
      this.lastReanchorCycleSimTime = simTime;
      this.reanchorCursor = 0;
    }

    const start = this.reanchorCursor;
    const end = Math.min(this.tleRealCount, start + REANCHOR_CHUNK_SIZE);
    const dateMs = this.simEpochMs + simTime * 1000;

    this.tlePropagator.applyKeplerianBatch(dateMs, start, end - start, (index, state) => {
      writeKeplerianExtended(this.extendedElementData, index, state);
    });

    const floatOffset = start * EXTENDED_FLOATS_PER_SATELLITE;
    const chunk = this.extendedElementData.slice(floatOffset, end * EXTENDED_FLOATS_PER_SATELLITE);
    this.context.getDevice().queue.writeBuffer(
      this.buffers.extendedElements,
      floatOffset * 4,
      chunk.buffer,
      chunk.byteOffset,
      chunk.byteLength,
    );

    this.reanchorCursor = end;
  }

  /** Full SGP4 re-anchor after a large sim-time jump (scrub / NOW / URL sync). */
  forceSgp4Reanchor(simTime: number): void {
    if (!this.realismEnabled || !this.tlePropagator || this.tleRealCount === 0) {
      return;
    }
    this.rebuildExtendedElements(simTime);
    this.lastReanchorCycleSimTime = simTime;
    this.reanchorCursor = this.tleRealCount;
    this.uploadExtendedElements();
  }

  private rebuildExtendedElements(anchorSimTime: number): void {
    const dateMs = this.simEpochMs + anchorSimTime * 1000;

    if (this.realismEnabled && this.tlePropagator && this.tleRealCount > 0) {
      this.tlePropagator.applyKeplerianBatch(dateMs, 0, this.tleRealCount, (index, state) => {
        writeKeplerianExtended(this.extendedElementData, index, state);
      });
    }

    for (let i = this.realismEnabled ? this.tleRealCount : 0; i < this.numSatellites; i++) {
      const base = i * 4;
      const raan = this.orbitalElementData[base];
      const inc = this.orbitalElementData[base + 1];
      const meanAnomaly = this.orbitalElementData[base + 2];
      const shellIndex = (this.orbitalElementData[base + 3] >> 8) & 0xff;
      writeShellExtended(this.extendedElementData, i, raan, inc, meanAnomaly, shellIndex);
    }
  }

  uploadExtendedElements(): void {
    if (!this.buffers) throw new Error('Buffers not initialized');
    const data = this.extendedElementData;
    this.context.getDevice().queue.writeBuffer(
      this.buffers.extendedElements,
      0,
      data.buffer,
      data.byteOffset,
      data.byteLength,
    );
  }

  /**
   * Upload orbital elements to GPU
   */
  uploadOrbitalElements(): void {
    if (!this.buffers) throw new Error('Buffers not initialized');
    this.context.writeBuffer(this.buffers.orbitalElements, this.orbitalElementData);
    this.uploadExtendedElements();
    this.uploadGroupIds();
  }

  adoptGroupIds(buffer: ArrayBuffer): void {
    const expectedBytes = this.numSatellites * 4;
    if (buffer.byteLength !== expectedBytes) {
      throw new Error(
        `Group ID buffer size mismatch: expected ${expectedBytes} bytes, got ${buffer.byteLength}`,
      );
    }
    this.groupIdData.set(new Uint32Array(buffer));
  }

  uploadGroupIds(): void {
    if (!this.buffers) throw new Error('Buffers not initialized');
    this.context.writeBuffer(this.buffers.groupIds, this.groupIdData);
  }

  getGroupIdData(): Uint32Array {
    return this.groupIdData;
  }

  setGroupVisibilityState(state: GroupVisibilityState): void {
    this.groupVisibility = state;
    this.uploadGroupParams();
  }

  getGroupVisibilityState(): GroupVisibilityState {
    return this.groupVisibility;
  }

  setGroupVisibility(groupId: number, visible: boolean): void {
    if (groupId < 0 || groupId >= this.groupVisibility.visible.length) return;
    this.groupVisibility.visible[groupId] = visible;
    this.uploadGroupParams();
  }

  uploadGroupParams(): void {
    if (!this.buffers) throw new Error('Buffers not initialized');
    this.context.writeBuffer(
      this.buffers.groupParams,
      buildGroupParamsUniform(this.groupVisibility),
    );
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

    this.context.writeBuffer(this.buffers.bloomUniforms.horizontal, createData(true));
    this.context.writeBuffer(this.buffers.bloomUniforms.vertical, createData(false));
  }

  /**
   * Get the current position buffer (for rendering)
   */
  getPositionBufferForRender(): GPUBuffer {
    if (!this.buffers) throw new Error('Buffers not initialized');

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
    if (!this.buffers) throw new Error('Buffers not initialized');

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
    if (!this.buffers || !this.isBufferPair(this.buffers.positions)) return;

    this.buffers.positions.current = this.buffers.positions.current === 'read' ? 'write' : 'read';
  }

  /**
   * Get all buffers
   */
  getBuffers(): SatelliteBufferSet {
    if (!this.buffers) throw new Error('Buffers not initialized');
    return this.buffers;
  }

  /**
   * Get orbital element data (for CPU-side calculations)
   */
  getOrbitalElementData(): Float32Array {
    return this.orbitalElementData;
  }

  /** Shared orbital store (same data as WebGL2 backend). */
  getOrbitalElements(): OrbitalElements {
    return this.orbital;
  }

  /**
   * Calculate satellite position on CPU (multi-shell)
   */
  calculateSatellitePosition(index: number, time: number): [number, number, number] {
    if (this.realismEnabled) {
      const ext = readKeplerianExtended(this.extendedElementData, index);
      if (ext.realismFlag > 0.5) {
        return propagateKeplerian(ext, time);
      }
    }
    return this.orbital.calculatePosition(index, time);
  }

  /**
   * Calculate satellite velocity on CPU (multi-shell)
   */
  calculateSatelliteVelocity(index: number, time: number): [number, number, number] {
    return this.orbital.calculateVelocity(index, time);
  }

  /**
   * Read position data back from GPU (async)
   */
  async readbackPositions(): Promise<Float32Array | null> {
    if (!this.buffers || !this.config.enableReadback) return null;

    const device = this.context.getDevice();
    const positionBuffer = this.getPositionBufferForRender();

    const stagingBuffer = device.createBuffer({
      size: this.positionBufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(positionBuffer, 0, stagingBuffer, 0, this.positionBufferSize);
    device.queue.submit([encoder.finish()]);

    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(stagingBuffer.getMappedRange().slice(0));
    stagingBuffer.unmap();
    stagingBuffer.destroy();

    return data;
  }

  /**
   * Calculate total GPU memory usage in bytes
   *
   * Includes all allocated buffers:
   * - Orbital elements (16 MB)
   * - Extended elements (32 MB)
   * - Positions (16 MB, or 32 MB if double-buffered)
   * - Uniforms (~1 KB)
   * - Bloom uniforms (2 × small)
   * - Beams (2 MB)
   * - Beam params (16 bytes)
   * - Pattern params (16 bytes)
   * - Colors (4 MB)
   * - Patterns (16 MB)
   * - Sky strip uniforms (48 bytes)
   * - Smile V2 uniforms (96 bytes)
   * - Trail buffer (32 MB)
   */
  getMemoryUsage(): number {
    const numSats = this.numSatellites;

    // Core buffers (always allocated)
    let total =
      this.elementBufferSize + // orbitalElements (16 MB)
      this.extendedElementBufferSize + // extendedElements (32 MB)
      BUFFER_SIZES.UNIFORM + // uniforms (256 bytes)
      BUFFER_SIZES.BLOOM_UNIFORM * 2; // bloomUniforms H/V (2 × buffer)

    // Position buffer (single or double)
    if (this.config.doubleBuffer && this.buffers && this.isBufferPair(this.buffers.positions)) {
      total += this.positionBufferSize * 2;
    } else {
      total += this.positionBufferSize;
    }

    // Additional buffers (only if initialized)
    if (this.buffers) {
      total += 65536 * 32; // beams (2 MB)
      total += 16; // beamParams
      total += 16; // patternParams
      total += numSats * 4; // colors (4 MB)
      total += numSats * 16; // patterns (16 MB)
      total += 48; // skyStripUniforms
      total += 96; // smileV2Uniforms
      total += numSats * 16 * 2; // trailBuffer (32 MB, 2 frames)
      total += numSats * 4; // groupIds (4 MB)
      total += GROUP_PARAMS_UNIFORM_SIZE; // groupParams
    }

    return total;
  }

  /**
   * Destroy and cleanup all buffers
   */
  destroy(): void {
    if (this.buffers) {
      this.buffers.orbitalElements.destroy();
      this.buffers.extendedElements.destroy();
      this.buffers.uniforms.destroy();
      this.buffers.bloomUniforms.horizontal.destroy();
      this.buffers.bloomUniforms.vertical.destroy();
      this.buffers.beams.destroy();
      this.buffers.beamParams.destroy();
      this.buffers.patternParams.destroy();
      this.buffers.colors.destroy();
      this.buffers.patterns.destroy();
      this.buffers.skyStripUniforms.destroy();
      this.buffers.smileV2Uniforms.destroy();
      this.buffers.trailBuffer.destroy();
      this.buffers.groupIds.destroy();
      this.buffers.groupParams.destroy();

      if (this.isBufferPair(this.buffers.positions)) {
        this.buffers.positions.read.destroy();
        this.buffers.positions.write.destroy();
      } else {
        this.buffers.positions.destroy();
      }

      this.buffers = null;
    }

    this.staging = null;
  }

  /**
   * Type guard for BufferPair
   */
  private isBufferPair(buffer: GPUBuffer | BufferPair): buffer is BufferPair {
    return 'read' in buffer && 'write' in buffer;
  }
}
