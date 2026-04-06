/**
 * Grok Zephyr - Satellite GPU Buffer Manager
 * 
 * Manages GPU buffers for 1M+ satellites with double-buffering
 * for efficient compute/graphics interop.
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
  /** Smile V2: Trail buffer for phase 6 trails (4-second history at 60fps = 240 frames) */
  trailBuffer: GPUBuffer;
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
   * 
   * SAFETY: Total buffer size is capped to prevent exceeding Pascal GPU limits
   * (maxStorageBufferBindingSize = 134 MB, we use conservative 128 MB limit)
   */
  initialize(): SatelliteBufferSet {
    const numSats = CONSTANTS.NUM_SATELLITES;

    // ←←← EXACT SIZES (never exceed 128 MB total on Pascal)
    const POSITION_SIZE = numSats * 16; // vec4<f32> position + flare
    const ELEMENT_SIZE = numSats * 16; // vec4<f32> velocity + featureID
    const COLOR_SIZE = numSats * 4; // rgba8unorm packed
    const PATTERN_SIZE = numSats * 16; // Sky Strips pattern data (vec4)
    const BEAM_SIZE = 65_536 * 32; // 64k beams max
    // TRAIL_SIZE: Reduced from 240 frames to 4 frames to stay under GPU limits
    // Phase 6 trails will use a circular buffer of 4 frames instead of 240
    const TRAIL_HISTORY_FRAMES = 4;
    const TRAIL_SIZE = numSats * 16 * TRAIL_HISTORY_FRAMES; // vec4<f32> per sat per frame

    console.log(`[SatelliteGPUBuffer] Initializing buffers for ${numSats.toLocaleString()} satellites`);
    console.log(`[SatelliteGPUBuffer] Position: ${(POSITION_SIZE / 1024 / 1024).toFixed(2)} MB`);
    console.log(`[SatelliteGPUBuffer] Element : ${(ELEMENT_SIZE / 1024 / 1024).toFixed(2)} MB`);
    console.log(`[SatelliteGPUBuffer] Color   : ${(COLOR_SIZE / 1024 / 1024).toFixed(2)} MB`);
    console.log(`[SatelliteGPUBuffer] Pattern : ${(PATTERN_SIZE / 1024 / 1024).toFixed(2)} MB`);
    console.log(`[SatelliteGPUBuffer] Trail   : ${(TRAIL_SIZE / 1024 / 1024).toFixed(2)} MB (${TRAIL_HISTORY_FRAMES} frames)`);
    console.log(`[SatelliteGPUBuffer] Beam    : ${(BEAM_SIZE / 1024).toFixed(2)} KB`);
    
    // ← SAFETY GUARD (prevents the 8GB crash)
    const MAX_ALLOWED = 128 * 1024 * 1024; // 128 MB conservative limit for Pascal
    const total = POSITION_SIZE + ELEMENT_SIZE + COLOR_SIZE + PATTERN_SIZE + TRAIL_SIZE + BEAM_SIZE;
    console.log(`[SatelliteGPUBuffer] Total storage buffers ≈ ${(total / 1024 / 1024).toFixed(1)} MB`);
    
    if (total > MAX_ALLOWED) {
      throw new Error(`Buffer total (${(total/1024/1024).toFixed(1)} MB) exceeds Pascal safe limit of 128 MB`);
    }

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

    // Create pattern params uniform buffer for animation patterns
    const patternParams = this.context.createUniformBuffer(16);
    const patternParamsData = new Float32Array(4);
    patternParamsData[0] = 0;   // animation_time
    patternParamsData[1] = 0;   // pattern_mode (0 = chaos default)
    patternParamsData[2] = 0;   // seed
    patternParamsData[3] = 0;   // padding
    this.context.writeBuffer(patternParams, patternParamsData);

    // Create per-satellite RGBA color buffer (rgba8unorm packed as u32, 4 MB)
    const colorBufferSize = this.numSatellites * 4;
    const colors = this.context.createBuffer(
      colorBufferSize,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    // Initialize to white, full brightness — shader multiplies shell color by this
    const colorData = new Uint32Array(this.numSatellites);
    colorData.fill(0xFFFFFFFF);
    this.context.writeBuffer(colors, colorData);
    console.log(`[SatelliteGPUBuffer] Color buffer: ${(colorBufferSize / 1024 / 1024).toFixed(2)} MB (rgba8unorm)`);

    // Create Sky Strips pattern data buffer (16 bytes per satellite: vec4f)
    const patternBufferSize = this.numSatellites * 16; // 4 floats × 4 bytes
    const patterns = this.context.createBuffer(
      patternBufferSize,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    // Initialize with default pulse pattern
    const patternData = new Float32Array(this.numSatellites * 4);
    for (let i = 0; i < this.numSatellites; i++) {
      const idx = i * 4;
      patternData[idx + 0] = 0.7 + Math.random() * 0.3;  // brightnessMod
      patternData[idx + 1] = 0;  // patternId (PULSE default)
      patternData[idx + 2] = (i % 1000) * 0.01;  // phaseOffset
      patternData[idx + 3] = 0.8 + Math.random() * 0.4;  // speedMult
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
    console.log(`[SatelliteGPUBuffer] Sky Strip uniforms: 32 bytes`);

    // Create Smile V2 uniform buffer (64 bytes aligned)
    // Layout:
    // Byte 0-3: global_time (f32)
    // Byte 4-7: transition_alpha (f32)
    // Byte 8-11: target_mode (f32)
    // Byte 12-15: morph_progress (f32)
    // Byte 16-31: reserved (vec4f padding)
    const smileV2Uniforms = this.context.createUniformBuffer(64);
    const smileV2UniformsData = new Float32Array(16);
    smileV2UniformsData[0] = 0;   // global_time
    smileV2UniformsData[1] = 0;   // transition_alpha
    smileV2UniformsData[2] = 0;   // target_mode
    smileV2UniformsData[3] = 0;   // morph_progress
    // Bytes 16-31: reserved (already zero-initialized)
    this.context.writeBuffer(smileV2Uniforms, smileV2UniformsData);
    console.log(`[SatelliteGPUBuffer] Smile V2 uniforms: 64 bytes`);

    // Create Smile V2 trail buffer for phase 6 trails
    // REDUCED: 4 frames instead of 240 to stay under Pascal GPU limits (128 MB)
    // Trail rendering will use a circular buffer approach with motion blur
    const TRAIL_HISTORY_FRAMES = 4;
    const trailBufferSize = numSats * 16 * TRAIL_HISTORY_FRAMES; // vec4<f32> per sat per frame
    const trailBuffer = this.context.createBuffer(
      trailBufferSize,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    // Initialize to zero
    const trailData = new Float32Array(numSats * 4 * TRAIL_HISTORY_FRAMES);
    this.context.writeBuffer(trailBuffer, trailData);
    console.log(`[SatelliteGPUBuffer] Trail buffer: ${(trailBufferSize / 1024 / 1024).toFixed(2)} MB (${TRAIL_HISTORY_FRAMES} frames history)`);

    this.buffers = {
      orbitalElements,
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
   * Load orbital elements from parsed TLE data.
   *
   * Data flow: TLE text → TLELoader.parse() → TLEData[] → this method → GPU buffer
   *
   * Each TLE line-2 encodes: inclination, RAAN, eccentricity, arg of perigee,
   * mean anomaly, and mean motion. We extract RAAN, inclination, and mean anomaly
   * into the compact vec4f GPU format. The shell index is inferred from altitude.
   *
   * If tleCount < NUM_SATELLITES, the remaining slots are filled deterministically
   * with procedural Walker satellites (same as generateOrbitalElements) so the
   * compute shader always processes a full 1,048,576-element buffer.
   *
   * @param tles - Parsed TLE records from TLELoader.parse()
   * @returns Number of real TLE satellites loaded (before padding)
   */
  loadFromTLEData(tles: TLEData[]): number {
    const startTime = performance.now();
    const tleCount = Math.min(tles.length, this.numSatellites);

    console.log(`[SatelliteGPUBuffer] Loading ${tleCount} TLE satellites...`);

    for (let t = 0; t < tleCount; t++) {
      const { line2 } = tles[t];
      // TLE line-2 format (fixed-width columns):
      //   col 9-16:  inclination (deg)
      //   col 18-25: RAAN (deg)
      //   col 27-33: eccentricity (leading decimal point implied)
      //   col 35-42: argument of perigee (deg)
      //   col 44-51: mean anomaly (deg)
      //   col 53-63: mean motion (rev/day)
      const incDeg = parseFloat(line2.substring(8, 16).trim());
      const raanDeg = parseFloat(line2.substring(17, 25).trim());
      const meanAnomalyDeg = parseFloat(line2.substring(43, 51).trim());
      const meanMotionRevPerDay = parseFloat(line2.substring(52, 63).trim());

      const DEG_TO_RAD = Math.PI / 180;
      const raan = raanDeg * DEG_TO_RAD;
      const inc = incDeg * DEG_TO_RAD;
      const M = meanAnomalyDeg * DEG_TO_RAD;

      // Derive altitude from mean motion: n(rad/s) = meanMotion * 2π / 86400
      // a = (μ / n²)^(1/3), altitude = a - R_earth
      const nRadPerSec = meanMotionRevPerDay * 2 * Math.PI / 86400;
      const MU = 398600.4418;
      const a = Math.pow(MU / (nRadPerSec * nRadPerSec), 1 / 3);
      const altKm = a - 6371.0;

      // Classify into shell by altitude
      let shellIndex: number;
      if (altKm < 450) {
        shellIndex = 0; // low shell (~340 km)
      } else if (altKm < 800) {
        shellIndex = 1; // mid shell (~550 km)
      } else {
        shellIndex = 2; // high shell (~1150 km)
      }

      const shellColors = [2.0, 6.0, 3.0]; // Blue, White, Gold
      const colorIndex = shellColors[shellIndex];
      const shellData = (shellIndex << 8) | (colorIndex & 0xFF);

      const idx = t * 4;
      this.orbitalElementData[idx + 0] = raan;
      this.orbitalElementData[idx + 1] = inc;
      this.orbitalElementData[idx + 2] = M;
      this.orbitalElementData[idx + 3] = shellData;
    }

    // Fill remaining slots with deterministic procedural Walker satellites.
    // Uses the same distribution as generateOrbitalElements but with a fixed
    // seed (no Math.random) so results are reproducible.
    if (tleCount < this.numSatellites) {
      const remaining = this.numSatellites - tleCount;
      console.log(`[SatelliteGPUBuffer] Padding ${remaining.toLocaleString()} remaining slots with procedural Walker data`);

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

        // Deterministic shell assignment based on global index
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
    console.log(`[SatelliteGPUBuffer] TLE load complete in ${elapsed.toFixed(2)}ms (${tleCount} real + ${this.numSatellites - tleCount} procedural)`);
    return tleCount;
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
    
    // Add Smile V2 buffers
    if (this.buffers) {
      total += 64; // smileV2Uniforms
      total += CONSTANTS.NUM_SATELLITES * 16 * 4; // trailBuffer (4 frames history)
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
  }

  /**
   * Type guard for BufferPair
   */
  private isBufferPair(buffer: GPUBuffer | BufferPair): buffer is BufferPair {
    return 'read' in buffer && 'write' in buffer;
  }
}

export default SatelliteGPUBuffer;
