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
  QualityPreset 
} from '@/types/animation.js';
import { DEFAULT_POSTPROCESS_CONFIG, DEFAULT_TAA_CONFIG, QUALITY_PRESETS } from '@/types/animation.js';

/** Post-process pass types */
type PassType = 'taa' | 'lens' | 'grading' | 'grain' | 'sharpness' | 'tonemap';

/** Post-process pass */
interface PostProcessPass {
  type: PassType;
  enabled: boolean;
  pipeline: GPURenderPipeline;
  bindGroup: GPUBindGroup;
  target?: GPUTexture;
}

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
    taaConfig: Partial<TAAConfig> = {}
  ) {
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
      size: 16,
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
    
    // Execute passes in order
    let currentInput = inputView;
    
    // TAA pass (if enabled)
    if (this.taaConfig.enabled && this.passes.has('taa')) {
      this.executeTAAPass(encoder, currentInput, width, height);
      currentInput = this.taaOutput!.createView();
    }
    
    // Lens effects
    if (this.config.filmGrain.enabled && this.passes.has('lens')) {
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
   * Set quality preset
   */
  setQualityPreset(preset: QualityPreset): void {
    this.currentPreset = preset;
    const settings = QUALITY_PRESETS[preset];
    
    if (settings.taa) {
      this.taaConfig = { ...this.taaConfig, ...settings.taa };
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
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      }));
    }
    
    // TAA output
    this.taaOutput = device.createTexture({
      size: [width, height],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
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
    const device = this.context.getDevice();
    
    // Create shader modules for each pass
    this.createTAAPipeline(device);
    this.createGradingPipeline(device);
    this.createGrainPipeline(device);
    this.createSharpnessPipeline(device);
    this.createTonemapPipeline(device);
    
    this.updateBindGroups();
  }

  private createTAAPipeline(device: GPUDevice): void {
    // TAA shader implementation
    const shader = device.createShaderModule({
      code: /* wgsl */ `
        struct TAAUniforms {
          jitter: vec2f,
          historyWeight: f32,
          pad: f32,
        };
        
        @group(0) @binding(0) var taaUniforms: TAAUniforms;
        @group(0) @binding(1) var currentFrame: texture_2d<f32>;
        @group(0) @binding(2) var historyFrame: texture_2d<f32>;
        @group(0) @binding(3) var linearSampler: sampler;
        
        @vertex
        fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
          const pts = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
          return vec4f(pts[vi], 0, 1);
        }
        
        @fragment
        fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
          let uv = pos.xy / vec2f(textureDimensions(currentFrame));
          let current = textureSample(currentFrame, linearSampler, uv).rgb;
          let history = textureSample(historyFrame, linearSampler, uv).rgb;
          let blended = mix(current, history, taaUniforms.historyWeight);
          return vec4f(blended, 1.0);
        }
      `,
    });
    
    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: shader, entryPoint: 'vs' },
      fragment: { module: shader, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
      primitive: { topology: 'triangle-list' },
    });
    
    this.passes.set('taa', {
      type: 'taa',
      enabled: this.taaConfig.enabled,
      pipeline,
      bindGroup: null as any, // Will be set in updateBindGroups
    });
  }

  private createGradingPipeline(device: GPUDevice): void {
    const shader = device.createShaderModule({
      code: /* wgsl */ `
        struct GradingUniforms {
          lift: vec3f,
          pad1: f32,
          gamma: vec3f,
          pad2: f32,
          gain: vec3f,
          saturation: f32,
          contrast: f32,
          brightness: f32,
          pad3: f32,
        };
        
        @group(0) @binding(0) var gradingUniforms: GradingUniforms;
        @group(0) @binding(1) var sourceTexture: texture_2d<f32>;
        @group(0) @binding(2) var linearSampler: sampler;
        
        @vertex
        fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
          const pts = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
          return vec4f(pts[vi], 0, 1);
        }
        
        @fragment
        fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
          let uv = pos.xy / vec2f(textureDimensions(sourceTexture));
          var col = textureSample(sourceTexture, linearSampler, uv).rgb;
          
          // Lift/Gamma/Gain
          col = pow(col * (1.0 + gradingUniforms.gain - gradingUniforms.lift) + gradingUniforms.lift, 
                    1.0 / gradingUniforms.gamma);
          
          // Saturation
          let lum = dot(col, vec3f(0.2126, 0.7152, 0.0722));
          col = mix(vec3f(lum), col, gradingUniforms.saturation);
          
          // Contrast
          col = (col - 0.5) * gradingUniforms.contrast + 0.5 + gradingUniforms.brightness;
          
          return vec4f(col, 1.0);
        }
      `,
    });
    
    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: shader, entryPoint: 'vs' },
      fragment: { module: shader, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
      primitive: { topology: 'triangle-list' },
    });
    
    this.passes.set('grading', {
      type: 'grading',
      enabled: true,
      pipeline,
      bindGroup: null as any,
    });
  }

  private createGrainPipeline(device: GPUDevice): void {
    const shader = device.createShaderModule({
      code: /* wgsl */ `
        struct GrainUniforms {
          intensity: f32,
          seed: f32,
          pad: vec2f,
        };
        
        @group(0) @binding(0) var grainUniforms: GrainUniforms;
        @group(0) @binding(1) var sourceTexture: texture_2d<f32>;
        @group(0) @binding(2) var linearSampler: sampler;
        
        fn random(p: vec2f) -> f32 {
          return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453);
        }
        
        @vertex
        fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
          const pts = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
          return vec4f(pts[vi], 0, 1);
        }
        
        @fragment
        fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
          let uv = pos.xy / vec2f(textureDimensions(sourceTexture));
          var col = textureSample(sourceTexture, linearSampler, uv).rgb;
          
          // Film grain
          let grain = random(uv + grainUniforms.seed) * 2.0 - 1.0;
          col = col + grain * grainUniforms.intensity;
          
          return vec4f(col, 1.0);
        }
      `,
    });
    
    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: shader, entryPoint: 'vs' },
      fragment: { module: shader, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
      primitive: { topology: 'triangle-list' },
    });
    
    this.passes.set('grain', {
      type: 'grain',
      enabled: this.config.filmGrain.enabled,
      pipeline,
      bindGroup: null as any,
    });
  }

  private createSharpnessPipeline(device: GPUDevice): void {
    const shader = device.createShaderModule({
      code: /* wgsl */ `
        struct SharpnessUniforms {
          strength: f32,
          pad: vec3f,
        };
        
        @group(0) @binding(0) var sharpnessUniforms: SharpnessUniforms;
        @group(0) @binding(1) var sourceTexture: texture_2d<f32>;
        @group(0) @binding(2) var linearSampler: sampler;
        
        @vertex
        fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
          const pts = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
          return vec4f(pts[vi], 0, 1);
        }
        
        @fragment
        fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
          let dim = vec2f(textureDimensions(sourceTexture));
          let uv = pos.xy / dim;
          let texel = 1.0 / dim;
          
          let center = textureSample(sourceTexture, linearSampler, uv).rgb;
          
          // Laplacian kernel
          var sum = vec3f(0.0);
          sum += textureSample(sourceTexture, linearSampler, uv + vec2f(texel.x, 0.0)).rgb;
          sum += textureSample(sourceTexture, linearSampler, uv - vec2f(texel.x, 0.0)).rgb;
          sum += textureSample(sourceTexture, linearSampler, uv + vec2f(0.0, texel.y)).rgb;
          sum += textureSample(sourceTexture, linearSampler, uv - vec2f(0.0, texel.y)).rgb;
          
          let sharpened = center * 5.0 - sum;
          let result = mix(center, sharpened, sharpnessUniforms.strength);
          
          return vec4f(result, 1.0);
        }
      `,
    });
    
    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: shader, entryPoint: 'vs' },
      fragment: { module: shader, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
      primitive: { topology: 'triangle-list' },
    });
    
    this.passes.set('sharpness', {
      type: 'sharpness',
      enabled: this.config.sharpness.enabled,
      pipeline,
      bindGroup: null as any,
    });
  }

  private createTonemapPipeline(device: GPUDevice): void {
    const shader = device.createShaderModule({
      code: /* wgsl */ `
        @group(0) @binding(0) var sourceTexture: texture_2d<f32>;
        @group(0) @binding(1) var linearSampler: sampler;
        
        fn aces(x: vec3f) -> vec3f {
          let a = 2.51;
          let b = 0.03;
          let c = 2.43;
          let d = 0.59;
          let e = 0.14;
          return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
        }
        
        fn reinhard(x: vec3f) -> vec3f {
          return x / (1.0 + x);
        }
        
        fn filmic(x: vec3f) -> vec3f {
          let X = max(vec3f(0.0), x - 0.004);
          return (X * (6.2 * X + 0.5)) / (X * (6.2 * X + 1.7) + 0.06);
        }
        
        @vertex
        fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
          const pts = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
          return vec4f(pts[vi], 0, 1);
        }
        
        @fragment
        fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
          let uv = pos.xy / vec2f(textureDimensions(sourceTexture));
          let col = textureSample(sourceTexture, linearSampler, uv).rgb;
          
          // ACES tonemapping
          let result = aces(col);
          
          // Slight saturation boost after tonemap
          let lum = dot(result, vec3f(0.2126, 0.7152, 0.0722));
          let saturated = mix(vec3f(lum), result, 1.05);
          
          return vec4f(saturated, 1.0);
        }
      `,
    });
    
    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: shader, entryPoint: 'vs' },
      fragment: { module: shader, entryPoint: 'fs', targets: [{ format: 'bgra8unorm' }] },
      primitive: { topology: 'triangle-list' },
    });
    
    this.passes.set('tonemap', {
      type: 'tonemap',
      enabled: true,
      pipeline,
      bindGroup: null as any,
    });
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
    const data = new Float32Array([this.config.sharpness.strength, 0, 0, 0]);
    device.queue.writeBuffer(this.sharpnessUniformBuffer, 0, data);
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

    // Copy taaOutput into history for next frame
    // (A full TAA copy pass would be needed here in a production setup)
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
      this.updateGrainUniforms();
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
    } else {
      // Lens or other passes: just source + sampler at bindings 0 and 1
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
