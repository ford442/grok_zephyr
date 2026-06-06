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
    const device = this.context.getDevice();
    
    // Create shader modules for each pass
    this.createTAAPipeline(device);
    this.createLensPipeline(device);
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
        
        @group(0) @binding(0) var<uniform> taaUniforms: TAAUniforms;
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

  private createLensPipeline(device: GPUDevice): void {
    const shader = device.createShaderModule({
      label: 'LensEffects',
      code: /* wgsl */ `
        // LensParams uniform layout (80 bytes, 20 × 4-byte slots):
        //  [0]  ca_enabled       u32
        //  [1]  ca_strength      f32
        //  [2]  flare_enabled    u32
        //  [3]  flare_intensity  f32
        //  [4]  flare_anamorphic u32
        //  [5]  starburst_enabled u32
        //  [6]  starburst_points  u32
        //  [7]  starburst_intensity f32
        //  [8]  vignette_enabled  u32
        //  [9]  vignette_intensity f32
        //  [10] vignette_smoothness f32
        //  [11] vignette_roundness  f32
        //  [12..13] sun_screen_pos vec2f
        //  [14] sun_intensity     f32
        //  [15] (pad)
        //  [16..17] screen_size   vec2f
        //  [18..19] inv_screen_size vec2f
        struct LensParams {
          ca_enabled: u32,
          ca_strength: f32,
          flare_enabled: u32,
          flare_intensity: f32,
          flare_anamorphic: u32,
          starburst_enabled: u32,
          starburst_points: u32,
          starburst_intensity: f32,
          vignette_enabled: u32,
          vignette_intensity: f32,
          vignette_smoothness: f32,
          vignette_roundness: f32,
          sun_screen_pos: vec2f,
          sun_intensity: f32,
          _pad: f32,
          screen_size: vec2f,
          inv_screen_size: vec2f,
        };

        @group(0) @binding(0) var<uniform> lensParams: LensParams;
        @group(0) @binding(1) var sourceTexture: texture_2d<f32>;
        @group(0) @binding(2) var linearSampler: sampler;

        struct VSOut {
          @builtin(position) pos: vec4f,
          @location(0) uv: vec2f,
        };

        @vertex
        fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
          const pts = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
          var out: VSOut;
          out.pos = vec4f(pts[vi], 0, 1);
          out.uv = pts[vi] * 0.5 + 0.5;
          return out;
        }

        // ── Chromatic Aberration ──────────────────────────────────────────────
        fn applyChromaticAberration(uv: vec2f, strength: f32) -> vec3f {
          let center = vec2f(0.5);
          let dist = length(uv - center);
          let dir = normalize(uv - center);
          let aberration = dist * dist * strength;
          let r = textureSample(sourceTexture, linearSampler, uv + dir * aberration).r;
          let g = textureSample(sourceTexture, linearSampler, uv + dir * aberration * 0.5).g;
          let b = textureSample(sourceTexture, linearSampler, uv).b;
          return vec3f(r, g, b);
        }

        // ── Anamorphic Streak ─────────────────────────────────────────────────
        fn anamorphicStreak(uv: vec2f, lightPos: vec2f, intensity: f32, anamorphic: bool) -> vec3f {
          let toLight = lightPos - uv;
          let dist = length(toLight);
          let dir = normalize(toLight);
          var scaledToLight = toLight;
          if (anamorphic) {
            let aspect = lensParams.screen_size.x / lensParams.screen_size.y;
            scaledToLight.y *= aspect;
          }
          let lineDist = abs(dir.x * scaledToLight.y - dir.y * scaledToLight.x);
          let streakWidth = 0.02;
          let streak = exp(-lineDist * lineDist / (streakWidth * streakWidth));
          let falloff = 1.0 / (1.0 + dist * 2.0);
          return vec3f(0.8, 0.9, 1.0) * streak * falloff * intensity;
        }

        // ── Ghost Flares ──────────────────────────────────────────────────────
        fn ghostFlares(uv: vec2f, lightPos: vec2f, intensity: f32) -> vec3f {
          var result = vec3f(0.0);
          let offsets = array<f32, 5>(-0.5, -0.3, 0.2, 0.4, -0.7);
          let intensities = array<f32, 5>(0.4, 0.3, 0.2, 0.15, 0.1);
          let sizes = array<f32, 5>(0.08, 0.06, 0.04, 0.05, 0.1);
          for (var i: i32 = 0; i < 5; i++) {
            let ghostPos = vec2f(0.5) + (lightPos - 0.5) * offsets[i];
            let dist = length(uv - ghostPos);
            let ghost = smoothstep(sizes[i], 0.0, dist);
            let tint = vec3f(1.0 - f32(i) * 0.15, 0.8 + f32(i) * 0.05, 0.6 + f32(i) * 0.1);
            result += tint * ghost * intensities[i];
          }
          return result * intensity;
        }

        // ── Starburst ─────────────────────────────────────────────────────────
        fn applyStarburst(uv: vec2f, lightPos: vec2f, numPoints: u32, intensity: f32) -> f32 {
          let toLight = uv - lightPos;
          let dist = length(toLight);
          let angle = atan2(toLight.y, toLight.x);
          let radialPattern = pow(abs(cos(angle * f32(numPoints))), 8.0);
          let falloff = 1.0 / (1.0 + dist * 3.0);
          let spikeAttenuation = smoothstep(0.3, 0.0, dist);
          return radialPattern * falloff * spikeAttenuation * intensity;
        }

        // ── Vignette ──────────────────────────────────────────────────────────
        fn applyVignette(uv: vec2f, intensity: f32, smoothness: f32, roundness: f32) -> f32 {
          let pos = uv * 2.0 - 1.0;
          let d = length(pos);
          return clamp(1.0 - smoothness * pow(d, roundness) * intensity, 0.0, 1.0);
        }

        // ── Fragment ──────────────────────────────────────────────────────────
        @fragment
        fn fs(in: VSOut) -> @location(0) vec4f {
          let uv = in.uv;
          var color: vec3f;

          // Chromatic aberration
          if (lensParams.ca_enabled != 0u) {
            color = applyChromaticAberration(uv, lensParams.ca_strength);
          } else {
            color = textureSample(sourceTexture, linearSampler, uv).rgb;
          }

          // Lens flare (sun + automatic bright-spot detection)
          if (lensParams.flare_enabled != 0u) {
            let sunPos = lensParams.sun_screen_pos;
            let sunInView = all(sunPos > vec2f(0.0)) && all(sunPos < vec2f(1.0));
            if (sunInView) {
              color += anamorphicStreak(uv, sunPos,
                lensParams.flare_intensity * lensParams.sun_intensity,
                lensParams.flare_anamorphic != 0u);
              color += ghostFlares(uv, sunPos, lensParams.flare_intensity * 0.5);
            }
          }

          // Starburst diffraction
          if (lensParams.starburst_enabled != 0u) {
            let sunPos = lensParams.sun_screen_pos;
            let sunInView = all(sunPos > vec2f(0.0)) && all(sunPos < vec2f(1.0));
            if (sunInView) {
              color += vec3f(applyStarburst(uv, sunPos,
                lensParams.starburst_points,
                lensParams.starburst_intensity * lensParams.sun_intensity));
            }
          }

          // Vignetting
          if (lensParams.vignette_enabled != 0u) {
            color *= applyVignette(uv,
              lensParams.vignette_intensity,
              lensParams.vignette_smoothness,
              lensParams.vignette_roundness);
          }

          return vec4f(color, 1.0);
        }
      `,
    });

    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: shader, entryPoint: 'vs' },
      fragment: { module: shader, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
      primitive: { topology: 'triangle-list' },
    });

    this.passes.set('lens', {
      type: 'lens',
      enabled: this.isLensEnabled(),
      pipeline,
      bindGroup: null as any,
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
        
        @group(0) @binding(0) var<uniform> gradingUniforms: GradingUniforms;
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
        
        @group(0) @binding(0) var<uniform> grainUniforms: GrainUniforms;
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
        
        @group(0) @binding(0) var<uniform> sharpnessUniforms: SharpnessUniforms;
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
    const surfaceFormat = this.context.getFormat();

    const fullscreenVertexShader = /* wgsl */ `
        @vertex
        fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
          const pts = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
          return vec4f(pts[vi], 0, 1);
        }
      `;

    const acesShaderCode = fullscreenVertexShader + /* wgsl */ `
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
      `;

    // When skipFinalTonemap is true the input is already tonemapped LDR —
    // use a simple passthrough to avoid double-tonemapping.
    const passthroughShaderCode = fullscreenVertexShader + /* wgsl */ `
        @group(0) @binding(0) var sourceTexture: texture_2d<f32>;
        @group(0) @binding(1) var linearSampler: sampler;

        @fragment
        fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
          let uv = pos.xy / vec2f(textureDimensions(sourceTexture));
          return textureSample(sourceTexture, linearSampler, uv);
        }
      `;

    const shader = device.createShaderModule({
      code: this.skipFinalTonemap ? passthroughShaderCode : acesShaderCode,
    });
    
    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: shader, entryPoint: 'vs' },
      fragment: { module: shader, entryPoint: 'fs', targets: [{ format: surfaceFormat }] },
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
