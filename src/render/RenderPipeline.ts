/**
 * Grok Zephyr - Render Pipeline
 * 
 * Manages the 6-pass rendering pipeline:
 * 1. Compute orbital positions
 * 2. Smile V2 animation (optional, between compute and scene)
 * 3. Scene pass (stars, Earth, atmosphere, satellites)
 * 4. Bloom threshold (configurable threshold + soft-knee)
 * 5. Bloom downsample pyramid (Kawase dual-filter, 2–5 levels)
 * 6. Bloom upsample pyramid (9-tap tent filter, additive blend)
 * 7. Composite + tonemapping (ACES, optional anamorphic streaks)
 */

import type WebGPUContext from '@/core/WebGPUContext.js';
import type { SatelliteBufferSet } from '@/core/SatelliteGPUBuffer.js';
import type { EarthAtmosphereRenderer } from '@/earth.js';
import type { BloomConfig } from '@/types/animation.js';
import { SmileV2Pipeline } from './SmileV2Pipeline.js';
import { SHADERS } from '@/shaders/index.js';
import { CONSTANTS, RENDER } from '@/types/constants.js';
import { DEFAULT_BLOOM_CONFIG } from '@/types/animation.js';

/** Render targets for HDR pipeline */
export interface RenderTargets {
  hdr: GPUTexture;
  depth: GPUTexture;
  bloomA: GPUTexture;
  bloomB: GPUTexture;
  /** Bloom pyramid mip levels: [0]=1/2, [1]=1/4, [2]=1/8, [3]=1/16, [4]=1/32 */
  bloomMip: GPUTexture[];
  bloomMipViews: GPUTextureView[];
  /** Intermediate target for the composite pass when PostProcessStack is active */
  compositeIntermediate: GPUTexture;
  
  // Cached views
  hdrView: GPUTextureView;
  depthView: GPUTextureView;
  bloomAView: GPUTextureView;
  bloomBView: GPUTextureView;
  compositeIntermediateView: GPUTextureView;
}

/** Pipeline bind groups */
export interface PipelineBindGroups {
  compute: GPUBindGroup;
  beamCompute: GPUBindGroup;
  stars: GPUBindGroup;
  earth: GPUBindGroup;
  atmosphere: GPUBindGroup;
  satellites: GPUBindGroup;
  beam: GPUBindGroup;
  groundTerrain: GPUBindGroup;
  bloomThreshold: GPUBindGroup;
  composite: GPUBindGroup;
}

/** Maximum number of laser beams */
export const MAX_BEAMS = 65536;

/** All render pipelines */
export interface Pipelines {
  compute: GPUComputePipeline;
  beamCompute: GPUComputePipeline;
  stars: GPURenderPipeline;
  earth: GPURenderPipeline;
  atmosphere: GPURenderPipeline;
  satellites: GPURenderPipeline;
  beam: GPURenderPipeline;
  groundTerrain: GPURenderPipeline;
  bloomThreshold: GPURenderPipeline;
  bloomBlur: GPURenderPipeline;
  bloomDownsample: GPURenderPipeline;
  bloomUpsample: GPURenderPipeline;
  composite: GPURenderPipeline;
}

/**
 * Render Pipeline Manager
 * 
 * Encapsulates all rendering logic for the 6-pass pipeline.
 */
export class RenderPipeline {
  private context: WebGPUContext;
  private buffers: SatelliteBufferSet;
  private linearSampler: GPUSampler;
  
  private pipelines: Pipelines | null = null;
  private bindGroups: PipelineBindGroups | null = null;
  private renderTargets: RenderTargets | null = null;
  private smileV2Pipeline: SmileV2Pipeline | null = null;
  
  private width = 0;
  private height = 0;

  /** Current bloom configuration (drives threshold, levels, anamorphic) */
  private bloomConfig: BloomConfig = { ...DEFAULT_BLOOM_CONFIG };

  /** Uniform buffer for the bloom threshold pass (ThresholdUni) */
  private bloomThresholdUniformBuffer: GPUBuffer | null = null;
  /** Uniform buffer for the composite bloom parameters (BloomCompositeUni) */
  private bloomCompositeUniformBuffer: GPUBuffer | null = null;
  /**
   * Per-level Kawase uniform buffers (srcTexelSize for each pyramid level).
   * Index i holds the texel size of mip level i.
   * Created on initialize/resize; maximum MAX_BLOOM_LEVELS entries.
   */
  private bloomKawaseBuffers: GPUBuffer[] = [];

  /** Maximum supported pyramid levels */
  private static readonly MAX_BLOOM_LEVELS = 5;

  /** Minimum meaningful pyramid levels (need at least 2 for the Kawase dual-filter to work) */
  private static readonly MIN_BLOOM_LEVELS = 2;

  constructor(context: WebGPUContext, buffers: SatelliteBufferSet) {
    this.context = context;
    this.buffers = buffers;
    this.linearSampler = context.createLinearSampler();
  }

  /**
   * Initialize all pipelines and render targets
   */
  initialize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    
    console.log(`[RenderPipeline] Initializing ${width}x${height}`);
    
    this.createBloomUniformBuffers(width, height);
    this.createPipelines();
    this.createRenderTargets(width, height);
    this.createBindGroups();
    
    // Initialize Smile V2 pipeline
    this.smileV2Pipeline = new SmileV2Pipeline(this.context, this.buffers);
    this.smileV2Pipeline.initialize();
    
    console.log('[RenderPipeline] Initialization complete');
  }

  /**
   * Create all shader pipelines
   */
  private createPipelines(): void {
    const device = this.context.getDevice();
    
    // Compute pipeline layout
    const computeLayout = device.createPipelineLayout({
      bindGroupLayouts: [
        device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
          ],
        }),
      ],
    });

    // Uniform-only render layout
    const uniformLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    // Satellite layout: uniform + positions + per-satellite color buffer + pattern params
    const satelliteLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    // Bloom layout (Kawase downsample + upsample + legacy blur)
    const bloomLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });

    // Threshold layout (texture + sampler + ThresholdUni)
    const thresholdLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    // Composite layout (binding 3 = shared Uni for film grain, binding 4 = BloomCompositeUni)
    const compositeLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    // Earth vertex buffer layout
    const earthVertexLayout: GPUVertexBufferLayout = {
      arrayStride: 24,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' },
      ],
    };

    // HDR blend state (unused but kept for reference)
    // const hdrBlend: GPUBlendState = {
    //   color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    //   alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    // };

    // Additive blend state
    const additiveBlend: GPUBlendState = {
      color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    };

    // Beam compute bind group layout (includes beamParams uniform)
    const beamComputeLayout = device.createPipelineLayout({
      bindGroupLayouts: [
        device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
          ],
        }),
      ],
    });

    // Beam render bind group layout (same as satellites - uniform + storage)
    const beamRenderLayout = device.createPipelineLayout({
      bindGroupLayouts: [
        device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
          ],
        }),
      ],
    });

    // Create pipelines
    this.pipelines = {
      compute: device.createComputePipeline({
        layout: computeLayout,
        compute: {
          module: this.context.createShaderModule(SHADERS.compute.orbital, 'orbital'),
          entryPoint: 'main',
        },
      }),

      beamCompute: device.createComputePipeline({
        layout: beamComputeLayout,
        compute: {
          module: this.context.createShaderModule(SHADERS.compute.beam, 'beam-compute'),
          entryPoint: 'main',
        },
      }),

      stars: device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [uniformLayout] }),
        vertex: {
          module: this.context.createShaderModule(SHADERS.render.stars, 'stars'),
          entryPoint: 'vs',
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.render.stars, 'stars'),
          entryPoint: 'fs',
          targets: [{ format: RENDER.HDR_FORMAT }],
        },
        primitive: { topology: 'triangle-list' },
        depthStencil: {
          format: RENDER.DEPTH_FORMAT,
          depthWriteEnabled: false,
          depthCompare: 'always',
        },
      }),

      earth: device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [uniformLayout] }),
        vertex: {
          module: this.context.createShaderModule(SHADERS.render.earth, 'earth'),
          entryPoint: 'vs',
          buffers: [earthVertexLayout],
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.render.earth, 'earth'),
          entryPoint: 'fs',
          targets: [{ format: RENDER.HDR_FORMAT }],
        },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        depthStencil: {
          format: RENDER.DEPTH_FORMAT,
          depthWriteEnabled: true,
          depthCompare: 'less',
        },
      }),

      atmosphere: device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [uniformLayout] }),
        vertex: {
          module: this.context.createShaderModule(SHADERS.render.atmosphere, 'atmosphere'),
          entryPoint: 'vs',
          buffers: [earthVertexLayout],
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.render.atmosphere, 'atmosphere'),
          entryPoint: 'fs',
          targets: [{ format: RENDER.HDR_FORMAT, blend: additiveBlend }],
        },
        primitive: { topology: 'triangle-list', cullMode: 'front' },
        depthStencil: {
          format: RENDER.DEPTH_FORMAT,
          depthWriteEnabled: false,
          depthCompare: 'less',
        },
      }),

      satellites: device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [satelliteLayout] }),
        vertex: {
          module: this.context.createShaderModule(SHADERS.render.satellites, 'satellites'),
          entryPoint: 'vs',
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.render.satellites, 'satellites'),
          entryPoint: 'fs',
          targets: [{ format: RENDER.HDR_FORMAT, blend: additiveBlend }],
        },
        primitive: { topology: 'triangle-list' },
        depthStencil: {
          format: RENDER.DEPTH_FORMAT,
          depthWriteEnabled: false,
          depthCompare: 'less',
        },
      }),

      beam: device.createRenderPipeline({
        layout: beamRenderLayout,
        vertex: {
          module: this.context.createShaderModule(SHADERS.render.beam, 'beam-render'),
          entryPoint: 'vs',
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.render.beam, 'beam-render'),
          entryPoint: 'fs',
          targets: [{ format: RENDER.HDR_FORMAT, blend: additiveBlend }],
        },
        primitive: { 
          topology: 'triangle-strip',
        },
        depthStencil: {
          format: RENDER.DEPTH_FORMAT,
          depthWriteEnabled: false,
          depthCompare: 'less',
        },
      }),

      groundTerrain: device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [uniformLayout] }),
        vertex: {
          module: this.context.createShaderModule(SHADERS.render.ground, 'ground-terrain'),
          entryPoint: 'vs',
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.render.ground, 'ground-terrain'),
          entryPoint: 'fs',
          targets: [{ 
            format: RENDER.HDR_FORMAT,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          }],
        },
        primitive: { topology: 'triangle-list' },
        depthStencil: {
          format: RENDER.DEPTH_FORMAT,
          depthWriteEnabled: false,
          depthCompare: 'always',
        },
      }),

      bloomThreshold: device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [thresholdLayout] }),
        vertex: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.bloomThreshold, 'bloom-threshold'),
          entryPoint: 'vs',
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.bloomThreshold, 'bloom-threshold'),
          entryPoint: 'fs',
          targets: [{ format: RENDER.HDR_FORMAT }],
        },
        primitive: { topology: 'triangle-list' },
      }),

      bloomBlur: device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bloomLayout] }),
        vertex: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.bloomBlur, 'bloom-blur'),
          entryPoint: 'vs',
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.bloomBlur, 'bloom-blur'),
          entryPoint: 'fs',
          targets: [{ format: RENDER.HDR_FORMAT }],
        },
        primitive: { topology: 'triangle-list' },
      }),

      bloomDownsample: device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bloomLayout] }),
        vertex: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.bloomDownsample, 'bloom-downsample'),
          entryPoint: 'vs',
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.bloomDownsample, 'bloom-downsample'),
          entryPoint: 'fs',
          targets: [{ format: RENDER.HDR_FORMAT }],
        },
        primitive: { topology: 'triangle-list' },
      }),

      bloomUpsample: device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bloomLayout] }),
        vertex: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.bloomUpsample, 'bloom-upsample'),
          entryPoint: 'vs',
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.bloomUpsample, 'bloom-upsample'),
          entryPoint: 'fs',
          // Additive blend: each upsample level accumulates onto the target
          targets: [{
            format: RENDER.HDR_FORMAT,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            },
          }],
        },
        primitive: { topology: 'triangle-list' },
      }),

      composite: device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [compositeLayout] }),
        vertex: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.composite, 'composite'),
          entryPoint: 'vs',
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.composite, 'composite'),
          entryPoint: 'fs',
          targets: [{ format: this.context.getFormat() }],
        },
        primitive: { topology: 'triangle-list' },
      }),
    };
  }

  /**
   * Create render targets for HDR pipeline
   */
  private createRenderTargets(width: number, height: number): void {
    const device = this.context.getDevice();
    const mkTex = (w: number, h: number, format: GPUTextureFormat): GPUTexture => {
      return device.createTexture({
        size: [w, h],
        format,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      });
    };

    const hdr = mkTex(width, height, RENDER.HDR_FORMAT);
    const depth = device.createTexture({
      size: [width, height],
      format: RENDER.DEPTH_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const bloomA = mkTex(width, height, RENDER.HDR_FORMAT);
    const bloomB = mkTex(width, height, RENDER.HDR_FORMAT);

    // Bloom pyramid mip levels: [0]=1/2, [1]=1/4, [2]=1/8, [3]=1/16, [4]=1/32
    const bloomMip: GPUTexture[] = [];
    const bloomMipViews: GPUTextureView[] = [];
    for (let i = 0; i < RenderPipeline.MAX_BLOOM_LEVELS; i++) {
      const scale = 1 << (i + 1); // 2, 4, 8, 16, 32
      const mw = Math.max(1, Math.floor(width / scale));
      const mh = Math.max(1, Math.floor(height / scale));
      const mip = mkTex(mw, mh, RENDER.HDR_FORMAT);
      bloomMip.push(mip);
      bloomMipViews.push(mip.createView());
    }

    // Intermediate composite target: the composite pass writes to this when
    // PostProcessStack is active, so the post-process stack can read from it.
    const surfaceFormat = this.context.getFormat();
    const compositeIntermediate = device.createTexture({
      size: [width, height],
      format: surfaceFormat,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    this.renderTargets = {
      hdr,
      depth,
      bloomA,
      bloomB,
      bloomMip,
      bloomMipViews,
      compositeIntermediate,
      hdrView: hdr.createView(),
      depthView: depth.createView(),
      bloomAView: bloomA.createView(),
      bloomBView: bloomB.createView(),
      compositeIntermediateView: compositeIntermediate.createView(),
    };
  }

  /**
   * Create bind groups for all pipelines
   */
  private createBindGroups(): void {
    if (!this.pipelines || !this.renderTargets) return;
    if (!this.bloomThresholdUniformBuffer || !this.bloomCompositeUniformBuffer) return;

    const device = this.context.getDevice();
    const posBuffer = this.buffers.positions instanceof GPUBuffer
    ? this.buffers.positions
    : (this.buffers.positions as { read: GPUBuffer }).read;

    // The bloom pyramid result is in mip[0] (1/2 res) after the upsample passes.
    const bloomResultView = this.renderTargets.bloomMipViews[0];

    this.bindGroups = {
    compute: device.createBindGroup({
      layout: this.pipelines.compute.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.buffers.uniforms } },
        { binding: 1, resource: { buffer: this.buffers.orbitalElements } },
        { binding: 2, resource: { buffer: this.buffers.extendedElements } },
        { binding: 3, resource: { buffer: posBuffer } },
      ],
    }),

    beamCompute: device.createBindGroup({
      layout: this.pipelines.beamCompute.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.buffers.uniforms } },
        { binding: 1, resource: { buffer: posBuffer } },
        { binding: 2, resource: { buffer: this.buffers.beams } },
        { binding: 3, resource: { buffer: this.buffers.beamParams } },
      ],
    }),

    stars: device.createBindGroup({
      layout: this.pipelines.stars.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.buffers.uniforms } }],
    }),

    earth: device.createBindGroup({
      layout: this.pipelines.earth.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.buffers.uniforms } }],
    }),

    atmosphere: device.createBindGroup({
      layout: this.pipelines.atmosphere.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.buffers.uniforms } }],
    }),

    satellites: device.createBindGroup({
      layout: this.pipelines.satellites.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.buffers.uniforms } },
        { binding: 1, resource: { buffer: posBuffer } },
        { binding: 2, resource: { buffer: this.buffers.colors } },
        { binding: 3, resource: { buffer: this.buffers.patternParams } },
      ],
    }),

    beam: device.createBindGroup({
      layout: this.pipelines.beam.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.buffers.uniforms } },
        { binding: 1, resource: { buffer: this.buffers.beams } },
      ],
    }),

    groundTerrain: device.createBindGroup({
      layout: this.pipelines.groundTerrain.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.buffers.uniforms } }],
    }),

    bloomThreshold: device.createBindGroup({
      layout: this.pipelines.bloomThreshold.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.renderTargets.hdrView },
        { binding: 1, resource: this.linearSampler },
        { binding: 2, resource: { buffer: this.bloomThresholdUniformBuffer } },
      ],
    }),

    composite: device.createBindGroup({
      layout: this.pipelines.composite.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.renderTargets.hdrView },
        { binding: 1, resource: bloomResultView },
        { binding: 2, resource: this.linearSampler },
        { binding: 3, resource: { buffer: this.buffers.uniforms } },
        { binding: 4, resource: { buffer: this.bloomCompositeUniformBuffer } },
      ],
    }),
    };
  }

  /**
   * Handle resize
   */
  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    
    this.width = width;
    this.height = height;
    
    console.log(`[RenderPipeline] Resized to ${width}x${height}`);
    
    // Destroy old textures
    this.renderTargets?.hdr.destroy();
    this.renderTargets?.depth.destroy();
    this.renderTargets?.bloomA.destroy();
    this.renderTargets?.bloomB.destroy();
    this.renderTargets?.bloomMip.forEach(t => t.destroy());
    this.renderTargets?.compositeIntermediate.destroy();

    // Recreate Kawase uniform buffers for new dimensions
    this.bloomKawaseBuffers.forEach(b => b.destroy());
    this.bloomKawaseBuffers = [];
    this.createBloomUniformBuffers(width, height);

    // Recreate render targets + bind groups
    this.createRenderTargets(width, height);
    this.createBindGroups();
  }

  /**
   * Execute compute pass
   */
  encodeComputePass(encoder: GPUCommandEncoder): void {
    if (!this.pipelines || !this.bindGroups) return;
    
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.compute);
    pass.setBindGroup(0, this.bindGroups.compute);
    pass.dispatchWorkgroups(Math.ceil(CONSTANTS.NUM_SATELLITES / RENDER.WORKGROUP_SIZE));
    pass.end();
  }

  /**
   * Execute beam compute pass
   */
  encodeBeamComputePass(encoder: GPUCommandEncoder): void {
    if (!this.pipelines || !this.bindGroups) return;
    
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.beamCompute);
    pass.setBindGroup(0, this.bindGroups.beamCompute);
    pass.dispatchWorkgroups(Math.ceil(MAX_BEAMS / 256));
    pass.end();
  }

  /**
   * Execute Smile V2 compute pass
   * Inserted between compute and bloom passes
   */
  encodeSmileV2Pass(encoder: GPUCommandEncoder): void {
    if (!this.smileV2Pipeline || !this.smileV2Pipeline.isActive()) {
      return;
    }
    
    this.smileV2Pipeline.encodeComputePass(encoder);
  }

  /**
   * Get the Smile V2 pipeline for external control
   */
  getSmileV2Pipeline(): SmileV2Pipeline | null {
    return this.smileV2Pipeline;
  }

  /**
   * Execute scene render pass
   */
  encodeScenePass(
    encoder: GPUCommandEncoder,
    earthVertexBuffer: GPUBuffer,
    earthIndexBuffer: GPUBuffer,
    earthIndexCount: number
  ): void {
    if (!this.pipelines || !this.bindGroups || !this.renderTargets) return;

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.renderTargets.hdrView,
        clearValue: { r: 0, g: 0, b: 0.02, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.renderTargets.depthView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    // Set full canvas viewport to ensure entire framebuffer is rendered
    pass.setViewport(0, 0, this.width, this.height, 0, 1);

    // Stars
    pass.setPipeline(this.pipelines.stars);
    pass.setBindGroup(0, this.bindGroups.stars);
    pass.draw(3);

    // Earth
    pass.setPipeline(this.pipelines.earth);
    pass.setBindGroup(0, this.bindGroups.earth);
    pass.setVertexBuffer(0, earthVertexBuffer);
    pass.setIndexBuffer(earthIndexBuffer, 'uint32');
    pass.drawIndexed(earthIndexCount);

    // Atmosphere
    pass.setPipeline(this.pipelines.atmosphere);
    pass.setBindGroup(0, this.bindGroups.atmosphere);
    pass.setVertexBuffer(0, earthVertexBuffer);
    pass.setIndexBuffer(earthIndexBuffer, 'uint32');
    pass.drawIndexed(earthIndexCount);

    // Satellites
    pass.setPipeline(this.pipelines.satellites);
    pass.setBindGroup(0, this.bindGroups.satellites);
    pass.draw(6, CONSTANTS.NUM_SATELLITES);

    // Laser beams (65k beams, 4 verts each via triangle strip)
    pass.setPipeline(this.pipelines.beam);
    pass.setBindGroup(0, this.bindGroups.beam);
    pass.draw(4, MAX_BEAMS);

    pass.end();
  }

  /**
   * Execute additive trail render pass onto the HDR target.
   */
  encodeTrailPass(encoder: GPUCommandEncoder, trailRenderer: { encodeRenderPass(pass: GPURenderPassEncoder, uniformBuffer: GPUBuffer): void } | null): void {
    if (!this.renderTargets || !trailRenderer) return;

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.renderTargets.hdrView,
        loadOp: 'load',
        storeOp: 'store',
      }],
    });

    pass.setViewport(0, 0, this.width, this.height, 0, 1);
    trailRenderer.encodeRenderPass(pass, this.buffers.uniforms);
    pass.end();
  }

  /**
   * Execute ground view scene render pass (mountains, lake, satellites, beams)
   */
  encodeGroundScenePass(
    encoder: GPUCommandEncoder,
    earthAtmosphereRenderer?: EarthAtmosphereRenderer,
    earthVertexBuffer?: GPUBuffer,
    earthIndexBuffer?: GPUBuffer,
    earthIndexCount?: number
  ): void {
    if (!this.pipelines || !this.bindGroups || !this.renderTargets) return;

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.renderTargets.hdrView,
        clearValue: { r: 0, g: 0, b: 0.02, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.renderTargets.depthView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    pass.setViewport(0, 0, this.width, this.height, 0, 1);

    if (earthAtmosphereRenderer && earthAtmosphereRenderer.getEnabled() && earthVertexBuffer && earthIndexBuffer && earthIndexCount) {
      pass.setPipeline(this.pipelines.earth);
      pass.setBindGroup(0, this.bindGroups.earth);
      pass.setVertexBuffer(0, earthVertexBuffer);
      pass.setIndexBuffer(earthIndexBuffer, 'uint32');
      pass.drawIndexed(earthIndexCount);

      earthAtmosphereRenderer.encode(pass, earthVertexBuffer, earthIndexBuffer, earthIndexCount);
    } else {
      pass.setPipeline(this.pipelines.groundTerrain);
      pass.setBindGroup(0, this.bindGroups.groundTerrain);
      pass.draw(6);
    }

    pass.setPipeline(this.pipelines.satellites);
    pass.setBindGroup(0, this.bindGroups.satellites);
    pass.draw(6, CONSTANTS.NUM_SATELLITES);

    pass.setPipeline(this.pipelines.beam);
    pass.setBindGroup(0, this.bindGroups.beam);
    pass.draw(4, MAX_BEAMS);

    pass.end();
  }

  /**
   * Execute bloom passes — multi-resolution Kawase pyramid.
   *
   * Pass sequence:
   *   1. Threshold pass  → bloomA (full res, bright-pass with soft knee)
   *   2. Downsample chain: bloomA → mip[0] → mip[1] → … → mip[levels-1]
   *   3. Upsample chain (additive):  mip[levels-1] → mip[levels-2] → … → mip[0]
   *
   * The composite pass reads from mip[0] (half res) as the final bloom result.
   */
  encodeBloomPasses(encoder: GPUCommandEncoder): void {
    if (!this.pipelines || !this.bindGroups || !this.renderTargets) return;
    if (this.bloomKawaseBuffers.length === 0) return;

    const device = this.context.getDevice();
    const levels = Math.min(
      Math.max(RenderPipeline.MIN_BLOOM_LEVELS, this.bloomConfig.levels),
      RenderPipeline.MAX_BLOOM_LEVELS
    );

    // Validate that all required GPU resources exist for the requested level count.
    for (let i = 0; i < levels; i++) {
      if (!this.renderTargets.bloomMip[i] || !this.bloomKawaseBuffers[i]) {
        console.warn(`[RenderPipeline] Bloom mip level ${i} resource missing — bloom pass skipped.`);
        return;
      }
    }

    // ── 1. Threshold pass ────────────────────────────────────────────────────
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.renderTargets.bloomAView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.setViewport(0, 0, this.width, this.height, 0, 1);
      pass.setPipeline(this.pipelines.bloomThreshold);
      pass.setBindGroup(0, this.bindGroups.bloomThreshold);
      pass.draw(3);
      pass.end();
    }

    // ── 2. Downsample chain ──────────────────────────────────────────────────
    // Level 0: bloomA (full res) → mip[0]  (1/2 res)
    // Level i: mip[i-1]         → mip[i]
    const srcViews: GPUTextureView[] = [this.renderTargets.bloomAView, ...this.renderTargets.bloomMipViews];
    const dstViews: GPUTextureView[] = this.renderTargets.bloomMipViews;

    for (let i = 0; i < levels; i++) {
      const mip = this.renderTargets.bloomMip[i];
      const kawaseBuf = this.bloomKawaseBuffers[i];
      if (!mip || !kawaseBuf) break;

      const bg = device.createBindGroup({
        layout: this.pipelines.bloomDownsample.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: kawaseBuf } },
          { binding: 1, resource: srcViews[i] },
          { binding: 2, resource: this.linearSampler },
        ],
      });

      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: dstViews[i],
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.setViewport(0, 0, mip.width, mip.height, 0, 1);
      pass.setPipeline(this.pipelines.bloomDownsample);
      pass.setBindGroup(0, bg);
      pass.draw(3);
      pass.end();
    }

    // ── 3. Upsample chain (additive blend) ───────────────────────────────────
    // Levels are accumulated from the bottom of the pyramid up.
    // mip[levels-1] → mip[levels-2] → … → mip[0]
    for (let i = levels - 1; i > 0; i--) {
      const srcMip = this.renderTargets.bloomMip[i];
      const dstMip = this.renderTargets.bloomMip[i - 1];
      const kawaseBuf = this.bloomKawaseBuffers[i];
      if (!srcMip || !dstMip || !kawaseBuf) break;

      const bg = device.createBindGroup({
        layout: this.pipelines.bloomUpsample.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: kawaseBuf } },
          { binding: 1, resource: this.renderTargets.bloomMipViews[i] },
          { binding: 2, resource: this.linearSampler },
        ],
      });

      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.renderTargets.bloomMipViews[i - 1],
          // loadOp 'load' to preserve the existing downsampled content and
          // let the GPU additive blend state accumulate on top of it.
          loadOp: 'load',
          storeOp: 'store',
        }],
      });
      pass.setViewport(0, 0, dstMip.width, dstMip.height, 0, 1);
      pass.setPipeline(this.pipelines.bloomUpsample);
      pass.setBindGroup(0, bg);
      pass.draw(3);
      pass.end();
    }
  }

  /**
   * Execute composite pass
   */
  encodeCompositePass(encoder: GPUCommandEncoder, outputView: GPUTextureView, outputWidth?: number, outputHeight?: number): void {
    if (!this.pipelines || !this.bindGroups) return;

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: outputView,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    // Use provided dimensions or fall back to stored dimensions
    const width = outputWidth || this.width;
    const height = outputHeight || this.height;
    pass.setViewport(0, 0, width, height, 0, 1);

    pass.setPipeline(this.pipelines.composite);
    pass.setBindGroup(0, this.bindGroups.composite);
    pass.draw(3);
    pass.end();
  }

  /**
   * Get the intermediate composite texture view.
   * When PostProcessStack is active the composite pass writes to this texture
   * instead of the swapchain, and PostProcessStack samples from it.
   */
  getCompositeIntermediateView(): GPUTextureView {
    if (!this.renderTargets) {
      throw new Error('RenderPipeline not initialized');
    }
    return this.renderTargets.compositeIntermediateView;
  }

  /**
   * Get render targets
   */
  getRenderTargets(): RenderTargets | null {
    return this.renderTargets;
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.renderTargets?.hdr.destroy();
    this.renderTargets?.depth.destroy();
    this.renderTargets?.bloomA.destroy();
    this.renderTargets?.bloomB.destroy();
    this.renderTargets?.bloomMip.forEach(t => t.destroy());
    this.renderTargets?.compositeIntermediate.destroy();
    this.renderTargets = null;
    this.pipelines = null;
    this.bindGroups = null;

    this.bloomThresholdUniformBuffer?.destroy();
    this.bloomThresholdUniformBuffer = null;
    this.bloomCompositeUniformBuffer?.destroy();
    this.bloomCompositeUniformBuffer = null;
    this.bloomKawaseBuffers.forEach(b => b.destroy());
    this.bloomKawaseBuffers = [];
    
    if (this.smileV2Pipeline) {
      this.smileV2Pipeline.destroy();
      this.smileV2Pipeline = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Bloom configuration helpers
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Update the active bloom configuration.
   * Writes new values into the GPU uniform buffers immediately.
   * The change takes effect on the next rendered frame.
   */
  setBloomConfig(config: Partial<BloomConfig>): void {
    this.bloomConfig = { ...this.bloomConfig, ...config };
    this.writeBloomThresholdUni();
    this.writeBloomCompositeUni();
  }

  /** Return a copy of the current bloom configuration. */
  getBloomConfig(): BloomConfig {
    return { ...this.bloomConfig };
  }

  /**
   * Create GPU uniform buffers used by the bloom passes.
   * Called once on initialize() and again on resize() to update texel sizes.
   */
  private createBloomUniformBuffers(width: number, height: number): void {
    const device = this.context.getDevice();

    // ThresholdUni: 4 × f32 = 16 bytes
    if (!this.bloomThresholdUniformBuffer) {
      this.bloomThresholdUniformBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'Bloom Threshold Uniform',
      });
    }
    this.writeBloomThresholdUni();

    // BloomCompositeUni: 4 × f32/u32 = 16 bytes
    if (!this.bloomCompositeUniformBuffer) {
      this.bloomCompositeUniformBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'Bloom Composite Uniform',
      });
    }
    this.writeBloomCompositeUni();

    // Per-level Kawase uniform buffers — one per pyramid level.
    // Each holds { srcTexelSize: vec2f, pad: vec2f } = 16 bytes.
    //
    // Buffer[i] stores the texel size of the SOURCE texture for downsample pass i:
    //   pass 0: source = bloomA (full res, scale = 1×)  → destination = mip[0] (1/2 res)
    //   pass 1: source = mip[0] (1/2 res, scale = 2×)  → destination = mip[1] (1/4 res)
    //   …
    // The same buffer is reused for the corresponding upsample pass.
    this.bloomKawaseBuffers.forEach(b => b.destroy());
    this.bloomKawaseBuffers = [];
    for (let i = 0; i < RenderPipeline.MAX_BLOOM_LEVELS; i++) {
      // scale = resolution divisor of the source texture for this pass level.
      const scale = 1 << i; // i=0 → ÷1 (bloomA), i=1 → ÷2 (mip[0]), …
      const srcW = Math.max(1, Math.floor(width / scale));
      const srcH = Math.max(1, Math.floor(height / scale));

      const buf = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: `Bloom Kawase Uniform L${i}`,
      });
      const data = new Float32Array(4);
      data[0] = 1.0 / srcW;
      data[1] = 1.0 / srcH;
      data[2] = 0.0;
      data[3] = 0.0;
      device.queue.writeBuffer(buf, 0, data);
      this.bloomKawaseBuffers.push(buf);
    }
  }

  /** Write the ThresholdUni buffer from the current bloomConfig. */
  private writeBloomThresholdUni(): void {
    if (!this.bloomThresholdUniformBuffer) return;
    const data = new Float32Array(4);
    data[0] = this.bloomConfig.threshold;
    data[1] = this.bloomConfig.knee;
    data[2] = 0.0;
    data[3] = 0.0;
    this.context.getDevice().queue.writeBuffer(this.bloomThresholdUniformBuffer, 0, data);
  }

  /** Write the BloomCompositeUni buffer from the current bloomConfig. */
  private writeBloomCompositeUni(): void {
    if (!this.bloomCompositeUniformBuffer) return;
    const ab = new ArrayBuffer(16);
    const f32 = new Float32Array(ab);
    const u32 = new Uint32Array(ab);
    f32[0] = this.bloomConfig.intensity;
    u32[1] = this.bloomConfig.anamorphicEnabled ? 1 : 0;
    f32[2] = this.bloomConfig.anamorphicRatio;
    f32[3] = 0.0;
    this.context.getDevice().queue.writeBuffer(this.bloomCompositeUniformBuffer, 0, ab);
  }
}

export default RenderPipeline;
