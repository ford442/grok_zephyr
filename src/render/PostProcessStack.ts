/**
 * Grok Zephyr - Post-Process Stack
 * 
 * Ordered effect pipeline with:
 * - TAA (Temporal Anti-Aliasing)
 * - Lens effects
 * - Color grading (lift/gamma/gain)
 * - Film grain
 * - Sharpness filter
 * - Tonemapping
 * - Auto-exposure
 */

import type WebGPUContext from '@/core/WebGPUContext.js';
import type { 
  PostProcessConfig, 
  ColorGrading,
  TAAConfig,
  AdaptiveQuality,
  QualityPreset,
  LensEffectsConfig
} from '@/types/animation.js';
import { DEFAULT_POSTPROCESS_CONFIG, DEFAULT_TAA_CONFIG, QUALITY_PRESETS } from '@/types/animation.js';
import {
  createPostProcessPipelines,
  type PassType,
  type PostProcessPass,
} from '@/render/PostProcessPipelineFactory.js';

/**
 * Post-Process Stack
 * 
 * Manages the complete post-processing pipeline with
 * automatic quality scaling based on performance.
 */
export class PostProcessStack {
  private context: WebGPUContext;
  private config: PostProcessConfig;
  private taaConfig: TAAConfig;
  private adaptiveQuality: AdaptiveQuality;

  /**
   * When true the final output step is a passthrough blit instead of ACES
   * tonemapping.  Use this when the input is already tonemapped (e.g. the
   * frame was piped through the existing composite pass first).
   */
  private readonly skipFinalTonemap: boolean;
  
  // Render targets
  private historyBuffer: GPUTexture[] = []; // For TAA
  private taaOutput: GPUTexture | null = null;
  private pingPongBuffers: GPUTexture[] = [];
  
  // Pipelines
  private passes: Map<PassType, PostProcessPass> = new Map();
  private currentPass = 0;
  
  // Uniform buffers
  private gradingUniformBuffer: GPUBuffer;
  private taaUniformBuffer: GPUBuffer;
  private grainUniformBuffer: GPUBuffer;
  private sharpnessUniformBuffer: GPUBuffer;
  private lensUniformBuffer: GPUBuffer;

  // Lens runtime state
  private sunScreenPos: [number, number] = [-1, -1]; // off-screen by default
  private sunIntensity = 1.0;

  // Shared linear sampler
  private linearSampler: GPUSampler;
  
  // Halton sequence for TAA jitter
  private haltonSequence: Float32Array;
  private frameIndex = 0;
  
  // Performance tracking
  private fpsHistory: number[] = [];
  private lastQualityAdjustment = 0;
  private currentPreset: QualityPreset = 'high';

  constructor(
    context: WebGPUContext,
    config: Partial<PostProcessConfig> = {},
    taaConfig: Partial<TAAConfig> = {},
    skipFinalTonemap = false
  ) {
    this.skipFinalTonemap = skipFinalTonemap;
    this.context = context;
    this.config = { ...DEFAULT_POSTPROCESS_CONFIG, ...config };
    this.taaConfig = { ...DEFAULT_TAA_CONFIG, ...taaConfig };
    
    // Generate Halton sequence (base 2 and 3)
    this.haltonSequence = this.generateHaltonSequence(16);
    
    // Initialize uniform buffers
    const device = context.getDevice();
    this.gradingUniformBuffer = device.createBuffer({
      size: 128,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    
    this.taaUniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.grainUniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.sharpnessUniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // 80 bytes: 20 × f32/u32 fields (see updateLensUniforms for layout)
    this.lensUniformBuffer = device.createBuffer({
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.linearSampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });
    
    this.adaptiveQuality = {
      enabled: true,
      targetFPS: 60,
      minQuality: 'low',
      maxQuality: 'ultra',
      fpsHistory: [],
      lastAdjustment: 0,
    };
  }

  /**
   * Initialize post-process stack
   */
  initialize(width: number, height: number): void {
    this.createRenderTargets(width, height);
    this.createPipelines();
    this.updateUniforms();
  }

  /**
   * Resize render targets
   */
  resize(width: number, height: number): void {
    this.destroyRenderTargets();
    this.createRenderTargets(width, height);
    this.updateBindGroups();
  }

  /**
   * Execute full post-process stack
   */
  execute(
    encoder: GPUCommandEncoder,
    inputView: GPUTextureView,
    outputView: GPUTextureView,
    width: number,
    height: number,
    deltaTime: number
  ): void {
    // Update TAA jitter
    this.updateTAAJitter(width, height);
    
    // Adaptive quality
    if (this.adaptiveQuality.enabled) {
      this.updateAdaptiveQuality(deltaTime);
    }

    // Update per-frame grain seed once (avoids repeated performance.now() calls)
    if (this.config.filmGrain.enabled) {
      this.updateGrainUniforms();
    }
    
    // Execute passes in order
    let currentInput = inputView;
    
    // TAA pass (if enabled)
    if (this.taaConfig.enabled && this.passes.has('taa')) {
      this.executeTAAPass(encoder, currentInput, width, height);
      currentInput = this.taaOutput!.createView();
    }
    
    // Lens effects (CA, flare, starburst, vignette)
    if (this.isLensEnabled() && this.passes.has('lens')) {
      this.updateLensUniforms(width, height);
      const output = this.getPingPongOutput();
      this.executePass(encoder, 'lens', currentInput, output);
      currentInput = output;
    }
    
    // Color grading
    if (this.passes.has('grading')) {
      const output = this.getPingPongOutput();
      this.executePass(encoder, 'grading', currentInput, output);
      currentInput = output;
    }
    
    // Film grain
    if (this.config.filmGrain.enabled && this.passes.has('grain')) {
      const output = this.getPingPongOutput();
      this.executePass(encoder, 'grain', currentInput, output);
      currentInput = output;
    }
    
    // Sharpness
    if (this.config.sharpness.enabled && this.passes.has('sharpness')) {
      const output = this.getPingPongOutput();
      this.executePass(encoder, 'sharpness', currentInput, output);
      currentInput = output;
    }
    
    // Final tonemapping to output
    this.executeTonemapPass(encoder, currentInput, outputView);
  }

  /**
   * Enable/disable TAA
   */
  enableTAA(enabled: boolean): void {
    this.taaConfig = { ...this.taaConfig, enabled };
    this.updatePassStates();
  }

  /**
   * Get current TAA enabled state
   */
  isTAAEnabled(): boolean {
    return this.taaConfig.enabled;
  }

  /**
   * Set quality preset
   */
  setQualityPreset(preset: QualityPreset): void {
    this.currentPreset = preset;
    const settings = QUALITY_PRESETS[preset];
    
    if (settings.taa) {
      this.taaConfig = { ...this.taaConfig, ...settings.taa };
    }

    if (settings.lens) {
      this.config.lensEffects = { ...this.config.lensEffects, ...settings.lens };
    }
    
    // Update enabled passes
    this.updatePassStates();
  }

  /**
   * Update color grading
   */
  setColorGrading(grading: Partial<ColorGrading>): void {
    this.config.colorGrading = { ...this.config.colorGrading, ...grading };
    this.updateUniforms();
  }

  /**
   * Enable/disable film grain
   */
  setFilmGrain(enabled: boolean, intensity?: number): void {
    this.config.filmGrain.enabled = enabled;
    if (intensity !== undefined) {
      this.config.filmGrain.intensity = intensity;
    }
    this.updatePassStates();
  }

  /**
   * Enable/disable sharpness
   */
  setSharpness(enabled: boolean, strength?: number): void {
    this.config.sharpness.enabled = enabled;
    if (strength !== undefined) {
      this.config.sharpness.strength = strength;
    }
    this.updatePassStates();
  }

  /**
   * Update lens effects configuration
   */
  setLensEffects(lens: Partial<LensEffectsConfig>): void {
    this.config.lensEffects = { ...this.config.lensEffects, ...lens };
    this.updatePassStates();
  }

  /**
   * Set the sun's screen-space position and intensity for lens flare / starburst.
   * Pass coordinates in 0–1 UV space.  Values outside [0,1] mean the sun is
   * off-screen and flare/starburst effects will be suppressed automatically.
   */
  setSunScreenPosition(x: number, y: number, intensity = 1.0): void {
    this.sunScreenPos = [x, y];
    this.sunIntensity = intensity;
  }

  /**
   * Get current configuration
   */
  getConfig(): PostProcessConfig {
    return { ...this.config };
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.destroyRenderTargets();
    this.gradingUniformBuffer.destroy();
    this.taaUniformBuffer.destroy();
    this.grainUniformBuffer.destroy();
    this.sharpnessUniformBuffer.destroy();
    this.lensUniformBuffer.destroy();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PRIVATE METHODS
  // ═══════════════════════════════════════════════════════════════════════════════

  private createRenderTargets(width: number, height: number): void {
    const device = this.context.getDevice();
    
    // TAA history buffers (double buffered)
    for (let i = 0; i < 2; i++) {
      this.historyBuffer.push(device.createTexture({
        size: [width, height],
        format: 'rgba16float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
      }));
    }
    
    // TAA output
    this.taaOutput = device.createTexture({
      size: [width, height],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    
    // Ping-pong buffers for intermediate passes
    for (let i = 0; i < 2; i++) {
      this.pingPongBuffers.push(device.createTexture({
        size: [width, height],
        format: 'rgba16float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      }));
    }
  }

  private destroyRenderTargets(): void {
    this.historyBuffer.forEach(t => t.destroy());
    this.historyBuffer = [];
    this.taaOutput?.destroy();
    this.taaOutput = null;
    this.pingPongBuffers.forEach(t => t.destroy());
    this.pingPongBuffers = [];
  }

  private createPipelines(): void {
    this.passes = createPostProcessPipelines({
      device: this.context.getDevice(),
      surfaceFormat: this.context.getFormat(),
      skipFinalTonemap: this.skipFinalTonemap,
      taaConfig: this.taaConfig,
      config: this.config,
      isLensEnabled: () => this.isLensEnabled(),
    });
    this.updateBindGroups();
  }

  private updateBindGroups(): void {
    // Bind groups that depend on specific input textures are created dynamically
    // in each execute method (cheap WebGPU operation, called per-frame).
    // This method updates the grain and sharpness uniform values so they are
    // ready when the execute methods create their bind groups.
    this.updateGrainUniforms();
    this.updateSharpnessUniforms();
  }

  private updateGrainUniforms(): void {
    const device = this.context.getDevice();
    const data = new Float32Array([
      this.config.filmGrain.intensity,
      performance.now() * 0.001,
      0, 0,
    ]);
    device.queue.writeBuffer(this.grainUniformBuffer, 0, data);
  }

  private updateSharpnessUniforms(): void {
    const device = this.context.getDevice();
    const data = new Float32Array([this.config.sharpness.strength, 0, 0, 0, 0, 0, 0, 0]);
    device.queue.writeBuffer(this.sharpnessUniformBuffer, 0, data);
  }

  private updateLensUniforms(width: number, height: number): void {
    const device = this.context.getDevice();
    const lens = this.config.lensEffects;

    // Use a shared ArrayBuffer so we can write both u32 and f32 fields
    const buf = new ArrayBuffer(80);
    const u32 = new Uint32Array(buf);
    const f32 = new Float32Array(buf);

    u32[0]  = lens.chromaticAberration.enabled ? 1 : 0;
    f32[1]  = lens.chromaticAberration.strength;
    u32[2]  = lens.lensFlare.enabled ? 1 : 0;
    f32[3]  = lens.lensFlare.intensity;
    u32[4]  = lens.lensFlare.anamorphic ? 1 : 0;
    u32[5]  = lens.starburst.enabled ? 1 : 0;
    u32[6]  = lens.starburst.points;
    f32[7]  = lens.starburst.intensity;
    u32[8]  = lens.vignetting.enabled ? 1 : 0;
    f32[9]  = lens.vignetting.intensity;
    f32[10] = lens.vignetting.smoothness;
    f32[11] = lens.vignetting.roundness;
    f32[12] = this.sunScreenPos[0];
    f32[13] = this.sunScreenPos[1];
    f32[14] = this.sunIntensity;
    f32[15] = 0; // pad
    f32[16] = width;
    f32[17] = height;
    f32[18] = 1.0 / width;
    f32[19] = 1.0 / height;

    device.queue.writeBuffer(this.lensUniformBuffer, 0, buf);
  }

  /** Returns true when at least one lens sub-effect is enabled. */
  private isLensEnabled(): boolean {
    const l = this.config.lensEffects;
    return (
      l.chromaticAberration.enabled ||
      l.lensFlare.enabled ||
      l.starburst.enabled ||
      l.vignetting.enabled
    );
  }

  private updateUniforms(): void {
    const device = this.context.getDevice();
    const g = this.config.colorGrading;
    
    const gradingData = new Float32Array([
      ...g.lift, 0,
      ...g.gamma, 0,
      ...g.gain, g.saturation,
      g.contrast, g.brightness, 0, 0,
    ]);
    
    device.queue.writeBuffer(this.gradingUniformBuffer, 0, gradingData);
  }

  private updateTAAJitter(width: number, height: number): void {
    const device = this.context.getDevice();
    const idx = (this.frameIndex % 16) * 2;
    
    const jitterX = (this.haltonSequence[idx] - 0.5) * 2.0 * this.taaConfig.jitterStrength / width;
    const jitterY = (this.haltonSequence[idx + 1] - 0.5) * 2.0 * this.taaConfig.jitterStrength / height;
    
    const taaData = new Float32Array([jitterX, jitterY, this.taaConfig.historyWeight, 0]);
    device.queue.writeBuffer(this.taaUniformBuffer, 0, taaData);
    
    this.frameIndex++;
  }

  private updatePassStates(): void {
    const taaPass = this.passes.get('taa');
    if (taaPass) taaPass.enabled = this.taaConfig.enabled;

    const lensPass = this.passes.get('lens');
    if (lensPass) lensPass.enabled = this.isLensEnabled();
    
    const grainPass = this.passes.get('grain');
    if (grainPass) grainPass.enabled = this.config.filmGrain.enabled;
    
    const sharpnessPass = this.passes.get('sharpness');
    if (sharpnessPass) sharpnessPass.enabled = this.config.sharpness.enabled;
  }

  private executeTAAPass(
    encoder: GPUCommandEncoder,
    inputView: GPUTextureView,
    _width: number,
    _height: number
  ): void {
    const device = this.context.getDevice();
    const historyIdx = this.frameIndex % 2;
    const bindGroup = device.createBindGroup({
      layout: this.passes.get('taa')!.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.taaUniformBuffer } },
        { binding: 1, resource: inputView },
        { binding: 2, resource: this.historyBuffer[historyIdx].createView() },
        { binding: 3, resource: this.linearSampler },
      ],
    });

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.taaOutput!.createView(),
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }],
    });
    
    pass.setPipeline(this.passes.get('taa')!.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();

    // Copy taaOutput into the opposing history buffer for the next frame,
    // completing the TAA feedback loop.
    encoder.copyTextureToTexture(
      { texture: this.taaOutput! },
      { texture: this.historyBuffer[1 - historyIdx] },
      [this.taaOutput!.width, this.taaOutput!.height]
    );
  }

  private executePass(
    encoder: GPUCommandEncoder,
    type: PassType,
    inputView: GPUTextureView,
    outputView: GPUTextureView
  ): void {
    const device = this.context.getDevice();
    const pipeline = this.passes.get(type)!.pipeline;

    // Build bind group based on pass type
    let bindGroup: GPUBindGroup;
    if (type === 'grading') {
      bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.gradingUniformBuffer } },
          { binding: 1, resource: inputView },
          { binding: 2, resource: this.linearSampler },
        ],
      });
    } else if (type === 'grain') {
      bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.grainUniformBuffer } },
          { binding: 1, resource: inputView },
          { binding: 2, resource: this.linearSampler },
        ],
      });
    } else if (type === 'sharpness') {
      bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.sharpnessUniformBuffer } },
          { binding: 1, resource: inputView },
          { binding: 2, resource: this.linearSampler },
        ],
      });
    } else if (type === 'lens') {
      bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.lensUniformBuffer } },
          { binding: 1, resource: inputView },
          { binding: 2, resource: this.linearSampler },
        ],
      });
    } else {
      // Passthrough fallback: source + sampler at bindings 0 and 1
      bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: inputView },
          { binding: 1, resource: this.linearSampler },
        ],
      });
    }

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: outputView,
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }],
    });
    
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  private executeTonemapPass(
    encoder: GPUCommandEncoder,
    inputView: GPUTextureView,
    outputView: GPUTextureView
  ): void {
    const device = this.context.getDevice();
    const pipeline = this.passes.get('tonemap')!.pipeline;
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: inputView },
        { binding: 1, resource: this.linearSampler },
      ],
    });

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: outputView,
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }],
    });
    
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  private getPingPongOutput(): GPUTextureView {
    this.currentPass = 1 - this.currentPass;
    return this.pingPongBuffers[this.currentPass].createView();
  }

  private updateAdaptiveQuality(deltaTime: number): void {
    this.lastQualityAdjustment += deltaTime;
    
    // Adjust quality every 2 seconds
    if (this.lastQualityAdjustment < 2.0) return;
    this.lastQualityAdjustment = 0;
    
    // Calculate average FPS
    const avgFPS = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;
    
    if (avgFPS < this.adaptiveQuality.targetFPS * 0.9) {
      // Drop quality
      const presets: QualityPreset[] = ['low', 'medium', 'high', 'ultra'];
      const currentIdx = presets.indexOf(this.currentPreset);
      if (currentIdx > 0) {
        this.setQualityPreset(presets[currentIdx - 1]);
      }
    } else if (avgFPS > this.adaptiveQuality.targetFPS * 1.1) {
      // Increase quality
      const presets: QualityPreset[] = ['low', 'medium', 'high', 'ultra'];
      const currentIdx = presets.indexOf(this.currentPreset);
      if (currentIdx < presets.length - 1) {
        this.setQualityPreset(presets[currentIdx + 1]);
      }
    }
    
    this.fpsHistory = [];
  }

  private generateHaltonSequence(count: number): Float32Array {
    const result = new Float32Array(count * 2);
    
    for (let i = 0; i < count; i++) {
      // Halton base 2
      let n = i + 1;
      let f = 1.0;
      let r = 0.0;
      while (n > 0) {
        f = f / 2.0;
        r = r + f * (n % 2);
        n = Math.floor(n / 2);
      }
      result[i * 2] = r;
      
      // Halton base 3
      n = i + 1;
      f = 1.0;
      r = 0.0;
      while (n > 0) {
        f = f / 3.0;
        r = r + f * (n % 3);
        n = Math.floor(n / 3);
      }
      result[i * 2 + 1] = r;
    }
    
    return result;
  }
}

export default PostProcessStack;
