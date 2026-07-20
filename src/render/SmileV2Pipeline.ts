/**
 * Grok Zephyr - Smile V2 Pipeline
 *
 * Compute pipeline for "Smile from the Moon v2" animation system.
 * Handles 7-phase animation cycle with visibility culling and trail effects.
 */

import type { WebGPUContext } from '@/core/WebGPUContext.js';
import type { SatelliteBufferSet } from '@/core/SatelliteGPUBuffer.js';
import { CONSTANTS } from '@/types/constants.js';
import { SHADERS } from '@/shaders/index.js';
const SMILE_V2_SHADER = SHADERS.animations.smileV2;

/** Smile V2 animation phases */
export enum SmileV2Phase {
  IDLE = 0,
  EMERGE = 1,
  GLOW = 2,
  TWINKLE = 3,
  FADE = 4,
  MORPH = 5,
  TRAILS = 6,
}

/** Smile V2 uniform data structure (matches WGSL layout) */
export interface SmileV2Uniforms {
  global_time: number; // Byte 0-3: Animation time in seconds
  transition_alpha: number; // Byte 4-7: Blend factor (0-1)
  target_mode: number; // Byte 8-11: Target animation mode
  morph_progress: number; // Byte 12-15: Morph transition progress (0-1)
  // Byte 16-31: reserved (vec4f padding)
}

/** Smile V2 pipeline configuration */
export interface SmileV2Config {
  enabled: boolean;
  currentPhase: SmileV2Phase;
  phaseStartTime: number;
  visibilityCulling: boolean;
  indirectDispatch: boolean;
}

/** Debug timing info */
export interface SmileV2Timing {
  dispatchStart: number;
  dispatchEnd: number;
  frameTime: number;
}

/**
 * Smile V2 Pipeline Manager
 *
 * Manages the compute pipeline for the Smile from the Moon v2 animation:
 * - 7-phase animation cycle (48 seconds total)
 * - Visibility buffer culling for performance
 * - Trail buffer management for phase 6
 * - Indirect dispatch for dynamic workgroup sizing
 */
export class SmileV2Pipeline {
  private context: WebGPUContext;
  private buffers: SatelliteBufferSet;
  private config: SmileV2Config;
  private timing: SmileV2Timing;

  // Pipeline resources
  private pipeline: GPUComputePipeline | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private indirectBuffer: GPUBuffer | null = null;
  private visibilityBuffer: GPUBuffer | null = null;

  // Cached workgroup count
  private workgroupCount: number;

  constructor(context: WebGPUContext, buffers: SatelliteBufferSet) {
    this.context = context;
    this.buffers = buffers;
    this.workgroupCount = Math.ceil(CONSTANTS.NUM_SATELLITES / 256);

    this.config = {
      enabled: false,
      currentPhase: SmileV2Phase.IDLE,
      phaseStartTime: 0,
      visibilityCulling: true,
      indirectDispatch: false,
    };

    this.timing = {
      dispatchStart: 0,
      dispatchEnd: 0,
      frameTime: 0,
    };
  }

  /**
   * Initialize the Smile V2 pipeline
   */
  initialize(): void {
    console.log('[SmileV2Pipeline] Initializing pipeline...');

    this.createPipeline();
    this.createBindGroup();

    if (this.config.indirectDispatch) {
      this.createIndirectBuffer();
    }

    if (this.config.visibilityCulling) {
      this.createVisibilityBuffer();
    }

    console.log(`[SmileV2Pipeline] Initialized with ${this.workgroupCount} workgroups`);
  }

  /**
   * Create the compute pipeline
   */
  private createPipeline(): void {
    const device = this.context.getDevice();

    // Bind group layout must match the smile_v2 compute shader bindings
    // (src/shaders/animations/smileV2Common.ts):
    // Binding 0: params        (uniform)
    // Binding 1: sat_positions (storage, read)
    // Binding 2: sat_output    (storage, read_write)
    // Binding 3: feature_cache (storage, read_write)
    const bindGroupLayout = device.createBindGroupLayout({
      label: 'SmileV2BindGroupLayout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
      ],
    });

    const pipelineLayout = device.createPipelineLayout({
      label: 'SmileV2PipelineLayout',
      bindGroupLayouts: [bindGroupLayout],
    });

    // Use the smile_v2 shader from SHADERS
    this.pipeline = device.createComputePipeline({
      label: 'SmileV2ComputePipeline',
      layout: pipelineLayout,
      compute: {
        module: this.context.createShaderModule(SMILE_V2_SHADER, 'smile-v2'),
        entryPoint: 'smile_v2_compute',
      },
    });

    console.log('[SmileV2Pipeline] Compute pipeline created');
  }

  /**
   * Create bind group with all resources
   */
  private createBindGroup(): void {
    if (!this.pipeline) {
      throw new Error('Pipeline not initialized');
    }

    const device = this.context.getDevice();
    const posBuffer =
      this.buffers.positions instanceof GPUBuffer
        ? this.buffers.positions
        : (this.buffers.positions as { read: GPUBuffer }).read;

    // Bindings mirror the smile_v2 compute shader: params, read-only positions,
    // a read-write vec4f output buffer (patterns, 16 bytes/sat) and a read-write
    // u32 feature-cache buffer (colors, 4 bytes/sat).
    this.bindGroup = device.createBindGroup({
      label: 'SmileV2BindGroup',
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.buffers.smileV2Uniforms } },
        { binding: 1, resource: { buffer: posBuffer } },
        { binding: 2, resource: { buffer: this.buffers.patterns } },
        { binding: 3, resource: { buffer: this.buffers.colors } },
      ],
    });

    console.log('[SmileV2Pipeline] Bind group created');
  }

  /**
   * Create indirect dispatch buffer for dynamic workgroup sizing
   */
  private createIndirectBuffer(): void {
    const device = this.context.getDevice();

    // Indirect dispatch args: [x, y, z]
    const indirectData = new Uint32Array([this.workgroupCount, 1, 1]);

    this.indirectBuffer = device.createBuffer({
      label: 'SmileV2IndirectBuffer',
      size: 12, // 3 * 4 bytes
      usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
    });

    device.queue.writeBuffer(this.indirectBuffer, 0, indirectData);
    console.log('[SmileV2Pipeline] Indirect dispatch buffer created');
  }

  /**
   * Create visibility buffer for culling non-facing satellites
   */
  private createVisibilityBuffer(): void {
    const device = this.context.getDevice();

    // One uint32 per workgroup containing count of visible satellites
    const visibilitySize = Math.ceil(this.workgroupCount / 32) * 4;

    this.visibilityBuffer = device.createBuffer({
      label: 'SmileV2VisibilityBuffer',
      size: visibilitySize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });

    console.log(`[SmileV2Pipeline] Visibility buffer created (${visibilitySize} bytes)`);
  }

  /**
   * Update uniform buffer with current animation state
   */
  updateUniforms(uniforms: SmileV2Uniforms): void {
    // SmileV2Params WGSL layout (96 bytes):
    // [0] cycle_time, [1] global_time, [2] speed_multiplier, [3] _pad0,
    // [4] transition_alpha, [5] morph_target, [6] transition_duration, [7] _pad1,
    // [8..10] ref_nadir, [11] pad, [12..14] ref_east, [15] pad,
    // [16..18] ref_north, [19] pad, [20] morph_mode (u32), [21..23] _pad2
    const data = new Float32Array(24);
    data[0] = uniforms.global_time; // cycle_time (reuse global_time)
    data[1] = uniforms.global_time; // global_time
    data[2] = 1.0; // speed_multiplier
    data[4] = uniforms.transition_alpha;
    data[5] = uniforms.target_mode; // morph_target
    // ref vectors and morph_mode default to 0 (already zeroed)

    this.context.writeBuffer(this.buffers.smileV2Uniforms, data);
  }

  /**
   * Encode the compute pass
   */
  encodeComputePass(encoder: GPUCommandEncoder): void {
    if (!this.isActive() || !this.pipeline || !this.bindGroup) {
      return;
    }

    this.timing.dispatchStart = performance.now();

    const pass = encoder.beginComputePass({
      label: 'SmileV2ComputePass',
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);

    if (this.config.indirectDispatch && this.indirectBuffer) {
      pass.dispatchWorkgroupsIndirect(this.indirectBuffer, 0);
    } else {
      pass.dispatchWorkgroups(this.workgroupCount);
    }

    pass.end();

    this.timing.dispatchEnd = performance.now();
    this.timing.frameTime = this.timing.dispatchEnd - this.timing.dispatchStart;

    // Log performance warning if frame time exceeds 16ms target
    if (this.timing.frameTime > 16) {
      console.warn(
        `[SmileV2Pipeline] Frame time ${this.timing.frameTime.toFixed(2)}ms exceeds 16ms target`,
      );
    }
  }

  /**
   * Update indirect dispatch args (for dynamic workgroup sizing)
   */
  updateIndirectDispatch(visibleCount: number): void {
    if (!this.config.indirectDispatch || !this.indirectBuffer) {
      return;
    }

    const workgroups = Math.ceil(visibleCount / 256);
    const data = new Uint32Array([workgroups, 1, 1]);

    this.context.writeBuffer(this.indirectBuffer, data);
  }

  /**
   * Enable/disable visibility culling
   */
  setVisibilityCulling(enabled: boolean): void {
    this.config.visibilityCulling = enabled;
  }

  /**
   * Enable/disable indirect dispatch
   */
  setIndirectDispatch(enabled: boolean): void {
    if (enabled && !this.indirectBuffer) {
      this.createIndirectBuffer();
    }
    this.config.indirectDispatch = enabled;
  }

  /**
   * Start a new animation phase
   */
  startPhase(phase: SmileV2Phase): void {
    this.config.currentPhase = phase;
    this.config.phaseStartTime = performance.now();
    this.config.enabled = phase !== SmileV2Phase.IDLE;

    console.log(`[SmileV2Pipeline] Started phase ${SmileV2Phase[phase]}`);
  }

  /**
   * Get current animation phase
   */
  getCurrentPhase(): SmileV2Phase {
    return this.config.currentPhase;
  }

  /**
   * Get elapsed time in current phase
   */
  getPhaseElapsedTime(): number {
    return (performance.now() - this.config.phaseStartTime) / 1000;
  }

  /**
   * Check if Smile V2 is currently active
   */
  isActive(): boolean {
    return this.config.enabled && this.pipeline !== null;
  }

  /**
   * Get timing statistics
   */
  getTiming(): SmileV2Timing {
    return { ...this.timing };
  }

  /**
   * Enable the pipeline
   */
  enable(): void {
    this.config.enabled = true;
    console.log('[SmileV2Pipeline] Enabled');
  }

  /**
   * Disable the pipeline
   */
  disable(): void {
    this.config.enabled = false;
    console.log('[SmileV2Pipeline] Disabled');
  }

  /**
   * Get configuration
   */
  getConfig(): SmileV2Config {
    return { ...this.config };
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.pipeline = null;
    this.bindGroup = null;

    if (this.indirectBuffer) {
      this.indirectBuffer.destroy();
      this.indirectBuffer = null;
    }

    if (this.visibilityBuffer) {
      this.visibilityBuffer.destroy();
      this.visibilityBuffer = null;
    }

    console.log('[SmileV2Pipeline] Destroyed');
  }
}
