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

import type WebGPUContext from './WebGPUContext.js';
import { CONSTANTS, BUFFER_SIZES, INCLINATION_SHELLS } from '@/types/constants.js';
import type { TLEData } from '@/types/index.js';

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
  /** Smile V2: Uniform buffer for animation state (64 bytes aligned) */
  smileV2Uniforms: GPUBuffer;
  /** Smile V2: Trail buffer for phase 6 trails (2 frames × 16 bytes) */
  trailBuffer: GPUBuffer;
}

/**
 * Double-buffered staging for async uploads
 * Prevents CPU stall on MAP_WRITE buffers
 */
export class StagingBuffer {
  private buffers: GPUBuffer[] = [];
  private index = 0;

  constructor(private device: GPUDevice, private size: number) {
    this.buffers = [
      this.createStagingBuffer(size, 0),
      this.createStagingBuffer(size, 1),
    ];
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

    commandEncoder.copyBufferToBuffer(buf, 0, targetBuffer, 0, Math.min(this.size, data.byteLength));
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
  private orbitalElementData: Float32Array;
  private staging: StagingBuffer | null = null;
  
  // Cached sizes
  private readonly numSatellites: number;
  private readonly positionBufferSize: number;
  private readonly elementBufferSize: number;
  private readonly extendedElementBufferSize: number;

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
    this.positionBufferSize = this.numSatellites * 16; // vec4f
    this.elementBufferSize = this.numSatellites * 16;  // vec4f
    this.extendedElementBufferSize = this.numSatellites * 32; // 8 floats for J2 propagation (compact)
    
    // Pre-allocate orbital element data on CPU
    this.orbitalElementData = new Float32Array(this.numSatellites * 4);
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
    const POSITION_SIZE = numSats * 16;      // vec4<f32> (pos + flare)
    const ELEMENT_SIZE = numSats * 16;       // vec4<f32> (elements)
    const EXT_ELEM_SIZE = numSats * 32;      // 8 floats × 4 bytes (COMPACT)
    const COLOR_SIZE = numSats * 4;          // rgba8unorm packed
    const PATTERN_SIZE = numSats * 16;       // Sky Strips pattern data
    const BEAM_SIZE = 65536 * 32;            // 64k beams
    const TRAIL_SIZE = numSats * 16 * 2;     // 2 frames × vec4f (REDUCED from 4)
    const UNIFORM_SIZE = 256 + 32 + 16 + 16 + 64 + 32; // Various uniform buffers (includes skyStripUniforms)
    
    const total = POSITION_SIZE + ELEMENT_SIZE + EXT_ELEM_SIZE + COLOR_SIZE + 
                  PATTERN_SIZE + BEAM_SIZE + TRAIL_SIZE + UNIFORM_SIZE;
    
    // Detailed buffer size breakdown for debugging
    console.log(`[Buffer Size Debug] Breakdown for ${numSats.toLocaleString()} satellites:`);
    console.log(`  Position:   ${(POSITION_SIZE / 1024 / 1024).toFixed(2)} MB (${numSats} × 16 bytes)`);
    console.log(`  Elements:   ${(ELEMENT_SIZE / 1024 / 1024).toFixed(2)} MB (${numSats} × 16 bytes)`);
    console.log(`  Extended:   ${(EXT_ELEM_SIZE / 1024 / 1024).toFixed(2)} MB (${numSats} × 32 bytes, COMPACT)`);
    console.log(`  Colors:     ${(COLOR_SIZE / 1024 / 1024).toFixed(2)} MB (${numSats} × 4 bytes)`);
    console.log(`  Patterns:   ${(PATTERN_SIZE / 1024 / 1024).toFixed(2)} MB (${numSats} × 16 bytes)`);
    console.log(`  Beams:      ${(BEAM_SIZE / 1024 / 1024).toFixed(2)} MB (65536 × 32 bytes)`);
    console.log(`  Trails:     ${(TRAIL_SIZE / 1024 / 1024).toFixed(2)} MB (${numSats} × 16 × 2 frames, REDUCED)`);
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

    console.log(`[SatelliteGPUBuffer] Initializing buffers for ${numSats.toLocaleString()} satellites`);
    console.log(`[SatelliteGPUBuffer] Total storage requested: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
    
    // ← SAFETY GUARD (prevents the 8GB crash)
    if (totalBytes > MAX_SAFE_BUFFER_SIZE) {
      const exceeded = ((totalBytes - MAX_SAFE_BUFFER_SIZE) / 1024 / 1024).toFixed(2);
      throw new Error(
        `Buffer total (${(totalBytes / 1024 / 1024).toFixed(1)} MB) exceeds Pascal safe limit of 128 MB ` +
        `(exceeded by ${exceeded} MB). Reduce NUM_SATELLITES or buffer sizes.`
      );
    }
    
    // Warning if approaching the limit (safety margin)
    if (totalBytes > WARNING_BUFFER_THRESHOLD) {
      const margin = ((MAX_SAFE_BUFFER_SIZE - totalBytes) / 1024 / 1024).toFixed(2);
      console.warn(`[Buffer Safety] WARNING: Buffer size (${(totalBytes / 1024 / 1024).toFixed(2)} MB) is within ${margin} MB of the 128 MB limit`);
    }
    
    console.log(`[Buffer Safety] Total allocated: ${(totalBytes / 1024 / 1024).toFixed(2)} MB — OK ✓`);

    // Create orbital elements buffer (read-only)
    const orbitalElements = this.context.createBuffer(
      this.elementBufferSize,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );

    // Create extended orbital elements buffer for J2 propagation (32 bytes/satellite, compact)
    const extendedElements = this.context.createBuffer(
      this.extendedElementBufferSize,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );

    // Initialize extended orbital elements for J2 precession (compact 32-byte format)
    // Layout: [semi_major_axis(f32), packed_angles(u32 as f32), mean_anomaly(f32), eccentricity(f32), 
    //          current_raan(f32), mean_motion(f32), position_xy(vec2f)]
    const extElemData = new ArrayBuffer(numSats * 32);
    const f32View = new Float32Array(extElemData);
    const u32View = new Uint32Array(extElemData);
    
    for (let i = 0; i < numSats; i++) {
      const floatIdx = i * 8;  // 8 floats per satellite
      const uintIdx = i * 8;   // Same index for uint32 view
      
      // Get shell from existing orbitalElementData
      const shellData = this.orbitalElementData[i * 4 + 3];
      const shellIndex = (shellData >> 8) & 0xFF;
      
      // Shell radii (340km, 550km, 1150km altitudes)
      const SHELL_RADII_KM = [6711.0, 6921.0, 7521.0];
      
      const a = SHELL_RADII_KM[shellIndex] || 6921.0;
      const inc = this.orbitalElementData[i * 4 + 1]; // inclination from elements
      const raan = this.orbitalElementData[i * 4 + 0]; // RAAN from elements
      const meanAnomaly = this.orbitalElementData[i * 4 + 2]; // M from elements
      
      // Calculate mean motion from semi-major axis
      const MU = 398600.4418; // km³/s²
      const n = Math.sqrt(MU / (a * a * a));
      
      // Pack angles into u32 (8 bits per angle): (inc_u8 << 16) | (raan_u8 << 8) | argPerigee_u8
      const packAngle = (rad: number): number => {
        return Math.floor(((rad % (2 * Math.PI)) / (2 * Math.PI)) * 255) & 0xFF;
      };
      const packedAngles = (packAngle(inc) << 16) | (packAngle(raan) << 8) | 0; // argPerigee = 0
      
      // Store data using views
      f32View[floatIdx + 0] = a;              // semi-major axis (km)
      u32View[uintIdx + 1] = packedAngles;     // packed angles (u32 stored at same offset)
      f32View[floatIdx + 2] = meanAnomaly;    // mean anomaly (rad)
      f32View[floatIdx + 3] = 0.001;          // eccentricity (nearly circular)
      f32View[floatIdx + 4] = raan;           // current_raan (updated by precession each frame)
      f32View[floatIdx + 5] = n;              // mean motion (rad/s)
      f32View[floatIdx + 6] = 0.0;            // position x (filled by compute)
      f32View[floatIdx + 7] = 0.0;            // position y (z computed or stored elsewhere)
    }
    this.context.writeBuffer(extendedElements, f32View);
    console.log(`[SatelliteGPUBuffer] Extended elements buffer: ${(this.extendedElementBufferSize / 1024 / 1024).toFixed(2)} MB (J2 propagation, compact 32-byte)`);

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
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    
    // Create beam params uniform buffer (16 bytes)
    const beamParams = this.context.createUniformBuffer(16);
    const beamParamsData = new Float32Array(4);
    beamParamsData[0] = 0;      // time
    beamParamsData[1] = 1;      // patternMode (GROK logo default)
    beamParamsData[2] = MAX_BEAMS;
    beamParamsData[3] = 0;
    this.context.writeBuffer(beamParams, beamParamsData);

    // Create pattern params uniform buffer
    const patternParams = this.context.createUniformBuffer(16);
    const patternParamsData = new Float32Array(4);
    patternParamsData[0] = 0;   // animation_time
    patternParamsData[1] = 0;   // pattern_mode
    patternParamsData[2] = 0;   // seed
    patternParamsData[3] = 0;
    this.context.writeBuffer(patternParams, patternParamsData);

    // Create per-satellite RGBA color buffer (rgba8unorm packed as u32, 4 MB)
    const colorBufferSize = numSats * 4;
    const colors = this.context.createBuffer(
      colorBufferSize,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    const colorData = new Uint32Array(numSats);
    colorData.fill(0xFFFFFFFF);
    this.context.writeBuffer(colors, colorData);
    console.log(`[SatelliteGPUBuffer] Color buffer: ${(colorBufferSize / 1024 / 1024).toFixed(2)} MB (rgba8unorm)`);

    // Create Sky Strips pattern data buffer (16 bytes per satellite: vec4f)
    const patternBufferSize = numSats * 16;
    const patterns = this.context.createBuffer(
      patternBufferSize,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    const patternData = new Float32Array(numSats * 4);
    for (let i = 0; i < numSats; i++) {
      const idx = i * 4;
      patternData[idx + 0] = 0.7 + Math.random() * 0.3;
      patternData[idx + 1] = 0;  // patternId
      patternData[idx + 2] = (i % 1000) * 0.01;
      patternData[idx + 3] = 0.8 + Math.random() * 0.4;
    }
    this.context.writeBuffer(patterns, patternData);
    console.log(`[SatelliteGPUBuffer] Pattern buffer: ${(patternBufferSize / 1024 / 1024).toFixed(2)} MB (Sky Strips)`);

    // Create Sky Strips uniform buffer (32 bytes)
    const skyStripUniforms = this.context.createUniformBuffer(32);
    const skyStripUniformsData = new Float32Array(8);
    skyStripUniformsData[0] = 0;    // time
    skyStripUniformsData[1] = 0;    // beatIntensity
    skyStripUniformsData[2] = 0;    // beatPulse
    skyStripUniformsData[3] = 120;  // bpm
    skyStripUniformsData[4] = 0.8;  // globalBrightness
    skyStripUniformsData[5] = 1.0;  // patternBlend
    skyStripUniformsData[6] = 15;   // morseSpeed
    skyStripUniformsData[7] = 0.1;  // sparkleDensity
    this.context.writeBuffer(skyStripUniforms, skyStripUniformsData);

    // Create Smile V2 uniform buffer (64 bytes aligned)
    const smileV2Uniforms = this.context.createUniformBuffer(64);
    const smileV2UniformsData = new Float32Array(16);
    smileV2UniformsData[0] = 0;   // global_time
    smileV2UniformsData[1] = 0;   // transition_alpha
    smileV2UniformsData[2] = 0;   // target_mode
    smileV2UniformsData[3] = 0;   // morph_progress
    this.context.writeBuffer(smileV2Uniforms, smileV2UniformsData);

    // Create Smile V2 trail buffer (2 frames × vec4f per satellite)
    const TRAIL_HISTORY_FRAMES = 2;
    const trailBufferSize = numSats * 16 * TRAIL_HISTORY_FRAMES;
    const trailBuffer = this.context.createBuffer(
      trailBufferSize,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    const trailData = new Float32Array(numSats * 4 * TRAIL_HISTORY_FRAMES);
    this.context.writeBuffer(trailBuffer, trailData);
    console.log(`[SatelliteGPUBuffer] Trail buffer: ${(trailBufferSize / 1024 / 1024).toFixed(2)} MB (${TRAIL_HISTORY_FRAMES} frames)`);

    // Create staging buffer for async uploads
    this.staging = new StagingBuffer(
      this.context.getDevice(),
      Math.max(this.positionBufferSize, patternBufferSize)
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
    };

    return this.buffers;
  }

  /**
   * Upload dynamic data using staging buffer (zero stall)
   */
  async uploadDynamicData(data: {
    position?: ArrayBufferLike;
    pattern?: ArrayBufferLike;
    color?: ArrayBufferLike;
  }, commandEncoder: GPUCommandEncoder): Promise<void> {
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
   * Generate Walker constellation orbital elements with multi-shell orbits
   */
  generateOrbitalElements(): Float32Array {
    const { NUM_PLANES, SATELLITES_PER_PLANE } = CONSTANTS;
    const shells = INCLINATION_SHELLS;
    
    const SHELL_DISTRIBUTION = [0.3, 0.5, 0.2];
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
        
        const shellColors = [2.0, 6.0, 3.0];
        const colorIndex = shellColors[shellIndex];
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
   * Load orbital elements from parsed TLE data
   */
  loadFromTLEData(tles: TLEData[]): number {
    const startTime = performance.now();
    const tleCount = Math.min(tles.length, this.numSatellites);

    console.log(`[SatelliteGPUBuffer] Loading ${tleCount} TLE satellites...`);

    for (let t = 0; t < tleCount; t++) {
      const { line2 } = tles[t];
      const incDeg = parseFloat(line2.substring(8, 16).trim());
      const raanDeg = parseFloat(line2.substring(17, 25).trim());
      const meanAnomalyDeg = parseFloat(line2.substring(43, 51).trim());
      const meanMotionRevPerDay = parseFloat(line2.substring(52, 63).trim());

      const DEG_TO_RAD = Math.PI / 180;
      const raan = raanDeg * DEG_TO_RAD;
      const inc = incDeg * DEG_TO_RAD;
      const M = meanAnomalyDeg * DEG_TO_RAD;

      const nRadPerSec = meanMotionRevPerDay * 2 * Math.PI / 86400;
      const MU = 398600.4418;
      const a = Math.pow(MU / (nRadPerSec * nRadPerSec), 1 / 3);
      const altKm = a - 6371.0;

      let shellIndex: number;
      if (altKm < 450) shellIndex = 0;
      else if (altKm < 800) shellIndex = 1;
      else shellIndex = 2;

      const shellColors = [2.0, 6.0, 3.0];
      const colorIndex = shellColors[shellIndex];
      const shellData = (shellIndex << 8) | (colorIndex & 0xFF);

      const idx = t * 4;
      this.orbitalElementData[idx + 0] = raan;
      this.orbitalElementData[idx + 1] = inc;
      this.orbitalElementData[idx + 2] = M;
      this.orbitalElementData[idx + 3] = shellData;
    }

    // Fill remaining slots with deterministic procedural data
    if (tleCount < this.numSatellites) {
      const remaining = this.numSatellites - tleCount;
      console.log(`[SatelliteGPUBuffer] Padding ${remaining.toLocaleString()} remaining slots with procedural data`);

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
        const shellColors = [2.0, 6.0, 3.0];
        const colorIndex = shellColors[shellIndex];
        const shellData = (shellIndex << 8) | (colorIndex & 0xFF);

        const idx = globalIdx * 4;
        this.orbitalElementData[idx + 0] = raan;
        this.orbitalElementData[idx + 1] = inclination;
        this.orbitalElementData[idx + 2] = meanAnomaly;
        this.orbitalElementData[idx + 3] = shellData;
      }
    }

    const elapsed = performance.now() - startTime;
    console.log(`[SatelliteGPUBuffer] TLE load complete in ${elapsed.toFixed(2)}ms`);
    return tleCount;
  }

  /**
   * Upload orbital elements to GPU
   */
  uploadOrbitalElements(): void {
    if (!this.buffers) throw new Error('Buffers not initialized');
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
    
    this.buffers.positions.current =
      this.buffers.positions.current === 'read' ? 'write' : 'read';
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

  /**
   * Calculate satellite position on CPU (multi-shell)
   */
  calculateSatellitePosition(index: number, time: number): [number, number, number] {
    const i = index * 4;
    const raan = this.orbitalElementData[i];
    const inclination = this.orbitalElementData[i + 1];
    const meanAnomaly0 = this.orbitalElementData[i + 2];
    const shellData = this.orbitalElementData[i + 3];
    
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
   * - Sky strip uniforms (32 bytes)
   * - Smile V2 uniforms (64 bytes)
   * - Trail buffer (32 MB)
   */
  getMemoryUsage(): number {
    const numSats = this.numSatellites;
    
    // Core buffers (always allocated)
    let total = this.elementBufferSize +       // orbitalElements (16 MB)
                this.extendedElementBufferSize + // extendedElements (32 MB)
                BUFFER_SIZES.UNIFORM +           // uniforms (256 bytes)
                BUFFER_SIZES.BLOOM_UNIFORM * 2;  // bloomUniforms H/V (2 × buffer)
    
    // Position buffer (single or double)
    if (this.config.doubleBuffer && this.buffers && this.isBufferPair(this.buffers.positions)) {
      total += this.positionBufferSize * 2;
    } else {
      total += this.positionBufferSize;
    }
    
    // Additional buffers (only if initialized)
    if (this.buffers) {
      total += 65536 * 32;           // beams (2 MB)
      total += 16;                    // beamParams
      total += 16;                    // patternParams
      total += numSats * 4;           // colors (4 MB)
      total += numSats * 16;          // patterns (16 MB)
      total += 32;                    // skyStripUniforms
      total += 64;                    // smileV2Uniforms
      total += numSats * 16 * 2;      // trailBuffer (32 MB, 2 frames)
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

export default SatelliteGPUBuffer;
