/**
 * Grok Zephyr – Volumetric Beam Renderer
 *
 * Implements a two-pass god-ray effect gated behind the Cinematic quality preset:
 *
 *   Pass A (ray-march):   fullscreen triangle at HALF resolution.
 *                         Each fragment ray-marches through up to 64 active beams,
 *                         accumulating Mie-scattered light with Beer–Lambert transmittance.
 *                         Outputs to a half-res rgba16float texture.
 *
 *   Pass B (composite):   fullscreen triangle at FULL resolution.
 *                         Samples the half-res result with bilinear upsampling and
 *                         blends it additively onto the HDR render target.
 *
 * Performance target: <1.5 ms on modern discrete GPUs at 1080p.
 */

import type WebGPUContext from '@/core/WebGPUContext.js';
import { SHADERS } from '@/shaders/index.js';
import { RENDER } from '@/types/constants.js';

/** Configuration exposed through the Cinematic quality preset. */
export interface VolumetricBeamConfig {
  /** Scattering density coefficient (default 0.08). */
  density: number;
  /** Light intensity multiplier (default 2.0). */
  intensity: number;
  /** Mie asymmetry g-factor (default 0.7, range 0–1). */
  mieG: number;
  /** Ray-march step count per beam (default 8, range 4–16). */
  maxSteps: number;
  /** Volumetric beam radius in km (default 80). */
  beamRadius: number;
  /** Ambient light fraction added to every sample (default 0.05). */
  ambientFactor: number;
  /** Whether to apply Earth shadow occlusion. */
  earthShadow: boolean;
}

export const DEFAULT_VOLUMETRIC_BEAM_CONFIG: VolumetricBeamConfig = {
  density: 0.08,
  intensity: 2.0,
  mieG: 0.7,
  maxSteps: 8,
  beamRadius: 80.0,
  ambientFactor: 0.05,
  earthShadow: true,
};

/** Composite (upsample + additive blend) shader — simple blit from half-res texture. */
const COMPOSITE_SHADER = /* wgsl */ `
@group(0) @binding(0) var volTexture: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0)       uv : vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
  const pts = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  var out: VSOut;
  out.pos = vec4f(pts[vi], 0, 1);
  out.uv  = pts[vi] * 0.5 + 0.5;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4f {
  return textureSample(volTexture, linearSampler, in.uv);
}
`;

export class VolumetricBeamRenderer {
  private context: WebGPUContext;

  /** The shared beams storage buffer (written by the beam compute pass). */
  private beamsBuffer: GPUBuffer;
  /** The shared Uni uniform buffer (camera, time, …). */
  private uniformBuffer: GPUBuffer;

  // Half-res render target
  private volumetricTexture: GPUTexture | null = null;
  private volumetricView: GPUTextureView | null = null;

  // Linear sampler for the composite pass
  private linearSampler: GPUSampler;

  // GPU pipelines
  private raymarchPipeline: GPURenderPipeline | null = null;
  private compositePipeline: GPURenderPipeline | null = null;

  // GPU bind groups (recreated on resize)
  private raymarchBindGroup: GPUBindGroup | null = null;
  private compositeBindGroup: GPUBindGroup | null = null;

  // Volumetric config uniform buffer (32 bytes, always present)
  private configBuffer: GPUBuffer;

  private config: VolumetricBeamConfig;
  private halfWidth = 0;
  private halfHeight = 0;
  private fullWidth = 0;
  private fullHeight = 0;

  constructor(
    context: WebGPUContext,
    beamsBuffer: GPUBuffer,
    uniformBuffer: GPUBuffer,
    config: Partial<VolumetricBeamConfig> = {},
  ) {
    this.context = context;
    this.beamsBuffer = beamsBuffer;
    this.uniformBuffer = uniformBuffer;
    this.config = { ...DEFAULT_VOLUMETRIC_BEAM_CONFIG, ...config };

    const device = context.getDevice();

    // Create the config uniform buffer (32 bytes: 8 × f32/u32)
    this.configBuffer = device.createBuffer({
      label: 'VolumetricBeam Config',
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.linearSampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });
  }

  /**
   * Initialize pipelines and create render targets for the given dimensions.
   * Must be called once before encoding any passes.
   */
  initialize(width: number, height: number): void {
    this.createPipelines();
    this.resize(width, height);
  }

  /**
   * Resize the half-res render target and rebind.
   * Call when the canvas size changes.
   */
  resize(width: number, height: number): void {
    this.fullWidth  = width;
    this.fullHeight = height;
    this.halfWidth  = Math.max(1, Math.floor(width  / 2));
    this.halfHeight = Math.max(1, Math.floor(height / 2));

    // Destroy old texture
    this.volumetricTexture?.destroy();

    const device = this.context.getDevice();

    this.volumetricTexture = device.createTexture({
      label: 'Volumetric Beam Half-Res',
      size: [this.halfWidth, this.halfHeight],
      format: RENDER.HDR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.volumetricView = this.volumetricTexture.createView();

    this.writeConfigBuffer();
    this.createBindGroups();
  }

  /**
   * Update the volumetric configuration and push to GPU.
   */
  setConfig(config: Partial<VolumetricBeamConfig>): void {
    this.config = { ...this.config, ...config };
    this.writeConfigBuffer();
  }

  /** Return a copy of the current config. */
  getConfig(): VolumetricBeamConfig {
    return { ...this.config };
  }

  /**
   * Pass A — encode the ray-marching render pass at half resolution.
   * Call this after the beam compute pass and before bloom.
   */
  encodeRaymarchPass(encoder: GPUCommandEncoder): void {
    if (!this.raymarchPipeline || !this.raymarchBindGroup || !this.volumetricView) return;

    const pass = encoder.beginRenderPass({
      label: 'Volumetric Beam Ray-March',
      colorAttachments: [{
        view: this.volumetricView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setViewport(0, 0, this.halfWidth, this.halfHeight, 0, 1);
    pass.setPipeline(this.raymarchPipeline);
    pass.setBindGroup(0, this.raymarchBindGroup);
    pass.draw(3);
    pass.end();
  }

  /**
   * Pass B — composite the volumetric result additively into the HDR texture.
   * Uses bilinear upsampling from half-res.
   */
  encodeCompositePass(
    encoder: GPUCommandEncoder,
    hdrView: GPUTextureView,
  ): void {
    if (!this.compositePipeline || !this.compositeBindGroup) return;

    const pass = encoder.beginRenderPass({
      label: 'Volumetric Beam Composite',
      colorAttachments: [{
        view: hdrView,
        loadOp: 'load',   // preserve existing HDR content
        storeOp: 'store',
      }],
    });
    pass.setViewport(0, 0, this.fullWidth, this.fullHeight, 0, 1);
    pass.setPipeline(this.compositePipeline);
    pass.setBindGroup(0, this.compositeBindGroup);
    pass.draw(3);
    pass.end();
  }

  /** Release all GPU resources. */
  destroy(): void {
    this.volumetricTexture?.destroy();
    this.volumetricTexture = null;
    this.volumetricView = null;
    this.configBuffer.destroy();
    this.raymarchPipeline = null;
    this.compositePipeline = null;
    this.raymarchBindGroup = null;
    this.compositeBindGroup = null;
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private createPipelines(): void {
    const device = this.context.getDevice();

    // ── Ray-march pipeline ───────────────────────────────────────────────────
    const raymarchLayout = device.createPipelineLayout({
      bindGroupLayouts: [
        device.createBindGroupLayout({
          label: 'VolumetricBeam Ray-March BGL',
          entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
          ],
        }),
      ],
    });

    const raymarchModule = this.context.createShaderModule(
      SHADERS.render.volumetricBeam,
      'volumetric-beam-raymarch',
    );

    this.raymarchPipeline = device.createRenderPipeline({
      label: 'Volumetric Beam Ray-March',
      layout: raymarchLayout,
      vertex:   { module: raymarchModule, entryPoint: 'vs_main' },
      fragment: {
        module: raymarchModule,
        entryPoint: 'fs_main',
        targets: [{
          format: RENDER.HDR_FORMAT,
          // Premultiplied-alpha additive blend: src * 1  +  dst * 1
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });

    // ── Composite (upsample + additive blit) pipeline ───────────────────────
    const compositeLayout = device.createPipelineLayout({
      bindGroupLayouts: [
        device.createBindGroupLayout({
          label: 'VolumetricBeam Composite BGL',
          entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
          ],
        }),
      ],
    });

    const compositeModule = this.context.createShaderModule(
      COMPOSITE_SHADER,
      'volumetric-beam-composite',
    );

    this.compositePipeline = device.createRenderPipeline({
      label: 'Volumetric Beam Composite',
      layout: compositeLayout,
      vertex:   { module: compositeModule, entryPoint: 'vs_main' },
      fragment: {
        module: compositeModule,
        entryPoint: 'fs_main',
        targets: [{
          format: RENDER.HDR_FORMAT,
          // The half-res texture stores premultiplied RGBA, so use srcFactor:'one'
          // to avoid double-multiplying the alpha channel on composite.
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  private createBindGroups(): void {
    if (!this.raymarchPipeline || !this.compositePipeline || !this.volumetricView) return;
    const device = this.context.getDevice();

    this.raymarchBindGroup = device.createBindGroup({
      label: 'VolumetricBeam Ray-March BG',
      layout: this.raymarchPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.beamsBuffer } },
        { binding: 2, resource: { buffer: this.configBuffer } },
      ],
    });

    this.compositeBindGroup = device.createBindGroup({
      label: 'VolumetricBeam Composite BG',
      layout: this.compositePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.volumetricView },
        { binding: 1, resource: this.linearSampler },
      ],
    });
  }

  /** Write the packed VolumetricBeamConfig into the GPU uniform buffer. */
  private writeConfigBuffer(): void {
    const ab  = new ArrayBuffer(32);
    const f32 = new Float32Array(ab);
    const u32 = new Uint32Array(ab);

    f32[0] = this.config.density;
    f32[1] = this.config.intensity;
    f32[2] = this.config.mieG;
    u32[3] = this.config.maxSteps;
    f32[4] = this.config.beamRadius;
    f32[5] = this.config.ambientFactor;
    u32[6] = this.config.earthShadow ? 1 : 0;
    u32[7] = 0; // _pad

    this.context.getDevice().queue.writeBuffer(this.configBuffer, 0, ab);
  }
}
