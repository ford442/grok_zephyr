/**
 * Grok Zephyr - Render Pipeline
 * 
 * Manages the 6-pass rendering pipeline:
 * 1. Compute orbital positions
 * 2. Scene pass (stars, Earth, atmosphere, satellites)
 * 3. Bloom threshold
 * 4. Bloom horizontal blur
 * 5. Bloom vertical blur
 * 6. Composite + tonemapping
 */

import type WebGPUContext from '@/core/WebGPUContext.js';
import type { SatelliteBufferSet } from '@/core/SatelliteGPUBuffer.js';
import { SHADERS } from '@/shaders/index.js';
import { CONSTANTS, RENDER } from '@/types/constants.js';

/** Render targets for HDR pipeline */
export interface RenderTargets {
  hdr: GPUTexture;
  depth: GPUTexture;
  bloomA: GPUTexture;
  bloomB: GPUTexture;
  
  // Cached views
  hdrView: GPUTextureView;
  depthView: GPUTextureView;
  bloomAView: GPUTextureView;
  bloomBView: GPUTextureView;
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
  bloomHorizontal: GPUBindGroup;
  bloomVertical: GPUBindGroup;
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
  
  private width = 0;
  private height = 0;

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
    
    this.createPipelines();
    this.createRenderTargets(width, height);
    this.createBindGroups();
    
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

    // Uniform + storage render layout
    const uniformStorageLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });

    // Bloom layout
    const bloomLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });

    // Threshold layout
    const thresholdLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });

    // Composite layout
    const compositeLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
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

    // HDR blend state
    const hdrBlend: GPUBlendState = {
      color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    };

    // Additive blend state
    const additiveBlend: GPUBlendState = {
      color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    };

    // Beam compute bind group layout
    const beamComputeLayout = device.createPipelineLayout({
      bindGroupLayouts: [
        device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
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
          module: this.context.createShaderModule(SHADERS.orbital, 'orbital'),
          entryPoint: 'main',
        },
      }),

      beamCompute: device.createComputePipeline({
        layout: beamComputeLayout,
        compute: {
          module: this.context.createShaderModule(SHADERS.beamCompute, 'beam-compute'),
          entryPoint: 'main',
        },
      }),

      stars: device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [uniformLayout] }),
        vertex: {
          module: this.context.createShaderModule(SHADERS.stars, 'stars'),
          entryPoint: 'vs',
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.stars, 'stars'),
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
          module: this.context.createShaderModule(SHADERS.earth, 'earth'),
          entryPoint: 'vs',
          buffers: [earthVertexLayout],
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.earth, 'earth'),
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
          module: this.context.createShaderModule(SHADERS.atmosphere, 'atmosphere'),
          entryPoint: 'vs',
          buffers: [earthVertexLayout],
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.atmosphere, 'atmosphere'),
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
        layout: device.createPipelineLayout({ bindGroupLayouts: [uniformStorageLayout] }),
        vertex: {
          module: this.context.createShaderModule(SHADERS.satellites, 'satellites'),
          entryPoint: 'vs',
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.satellites, 'satellites'),
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
          module: this.context.createShaderModule(SHADERS.beamRender, 'beam-render'),
          entryPoint: 'vs_main',
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.beamRender, 'beam-render'),
          entryPoint: 'fs_main',
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
          module: this.context.createShaderModule(SHADERS.groundTerrain, 'ground-terrain'),
          entryPoint: 'vs',
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.groundTerrain, 'ground-terrain'),
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
          module: this.context.createShaderModule(SHADERS.bloomThreshold, 'bloom-threshold'),
          entryPoint: 'vs',
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.bloomThreshold, 'bloom-threshold'),
          entryPoint: 'fs',
          targets: [{ format: RENDER.HDR_FORMAT }],
        },
        primitive: { topology: 'triangle-list' },
      }),

      bloomBlur: device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bloomLayout] }),
        vertex: {
          module: this.context.createShaderModule(SHADERS.bloomBlur, 'bloom-blur'),
          entryPoint: 'vs',
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.bloomBlur, 'bloom-blur'),
          entryPoint: 'fs',
          targets: [{ format: RENDER.HDR_FORMAT }],
        },
        primitive: { topology: 'triangle-list' },
      }),

      composite: device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [compositeLayout] }),
        vertex: {
          module: this.context.createShaderModule(SHADERS.composite, 'composite'),
          entryPoint: 'vs',
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.composite, 'composite'),
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
    const mkTex = (format: GPUTextureFormat, usage: GPUTextureUsageFlags): GPUTexture => {
      return this.context.getDevice().createTexture({
        size: [width, height],
        format,
        usage: usage | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      });
    };

    const hdr = mkTex(RENDER.HDR_FORMAT, GPUTextureUsage.TEXTURE_BINDING);
    const depth = this.context.getDevice().createTexture({
      size: [width, height],
      format: RENDER.DEPTH_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const bloomA = mkTex(RENDER.HDR_FORMAT, GPUTextureUsage.TEXTURE_BINDING);
    const bloomB = mkTex(RENDER.HDR_FORMAT, GPUTextureUsage.TEXTURE_BINDING);

    this.renderTargets = {
      hdr,
      depth,
      bloomA,
      bloomB,
      hdrView: hdr.createView(),
      depthView: depth.createView(),
      bloomAView: bloomA.createView(),
      bloomBView: bloomB.createView(),
    };
  }

  /**
   * Create bind groups for all pipelines
   */
  private createBindGroups(): void {
    if (!this.pipelines || !this.renderTargets) return;

    const device = this.context.getDevice();
    const posBuffer = this.buffers.positions instanceof GPUBuffer
      ? this.buffers.positions
      : (this.buffers.positions as { read: GPUBuffer }).read;

    this.bindGroups = {
      compute: device.createBindGroup({
        layout: this.pipelines.compute.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.buffers.uniforms } },
          { binding: 1, resource: { buffer: this.buffers.orbitalElements } },
          { binding: 2, resource: { buffer: posBuffer } },
        ],
      }),

      beamCompute: device.createBindGroup({
        layout: this.pipelines.beamCompute.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.buffers.uniforms } },
          { binding: 1, resource: { buffer: posBuffer } },
          { binding: 2, resource: { buffer: this.buffers.beams } },
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
        ],
      }),

      bloomHorizontal: device.createBindGroup({
        layout: this.pipelines.bloomBlur.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.buffers.bloomUniforms.horizontal } },
          { binding: 1, resource: this.renderTargets.bloomAView },
          { binding: 2, resource: this.linearSampler },
        ],
      }),

      bloomVertical: device.createBindGroup({
        layout: this.pipelines.bloomBlur.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.buffers.bloomUniforms.vertical } },
          { binding: 1, resource: this.renderTargets.bloomBView },
          { binding: 2, resource: this.linearSampler },
        ],
      }),

      composite: device.createBindGroup({
        layout: this.pipelines.composite.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.renderTargets.hdrView },
          { binding: 1, resource: this.renderTargets.bloomAView },
          { binding: 2, resource: this.linearSampler },
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
    
    // Destroy old textures
    this.renderTargets?.hdr.destroy();
    this.renderTargets?.depth.destroy();
    this.renderTargets?.bloomA.destroy();
    this.renderTargets?.bloomB.destroy();
    
    // Recreate
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
   * Execute ground view scene render pass (mountains, lake, satellites, beams)
   */
  encodeGroundScenePass(encoder: GPUCommandEncoder): void {
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

    // Satellites first (in the sky)
    pass.setPipeline(this.pipelines.satellites);
    pass.setBindGroup(0, this.bindGroups.satellites);
    pass.draw(6, CONSTANTS.NUM_SATELLITES);

    // Laser beams from satellites to Earth surface
    pass.setPipeline(this.pipelines.beam);
    pass.setBindGroup(0, this.bindGroups.beam);
    pass.draw(4, MAX_BEAMS);

    // Ground terrain (mountains + lake) rendered on top to occlude foreground
    pass.setPipeline(this.pipelines.groundTerrain);
    pass.setBindGroup(0, this.bindGroups.groundTerrain);
    pass.draw(3);

    pass.end();
  }

  /**
   * Execute bloom passes
   */
  encodeBloomPasses(encoder: GPUCommandEncoder): void {
    if (!this.pipelines || !this.bindGroups || !this.renderTargets) return;

    // Threshold
    const thrPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.renderTargets.bloomAView,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    thrPass.setPipeline(this.pipelines.bloomThreshold);
    thrPass.setBindGroup(0, this.bindGroups.bloomThreshold);
    thrPass.draw(3);
    thrPass.end();

    // Horizontal blur
    const hBlurPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.renderTargets.bloomBView,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    hBlurPass.setPipeline(this.pipelines.bloomBlur);
    hBlurPass.setBindGroup(0, this.bindGroups.bloomHorizontal);
    hBlurPass.draw(3);
    hBlurPass.end();

    // Vertical blur
    const vBlurPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.renderTargets.bloomAView,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    vBlurPass.setPipeline(this.pipelines.bloomBlur);
    vBlurPass.setBindGroup(0, this.bindGroups.bloomVertical);
    vBlurPass.draw(3);
    vBlurPass.end();
  }

  /**
   * Execute composite pass
   */
  encodeCompositePass(encoder: GPUCommandEncoder, outputView: GPUTextureView): void {
    if (!this.pipelines || !this.bindGroups) return;

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: outputView,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.pipelines.composite);
    pass.setBindGroup(0, this.bindGroups.composite);
    pass.draw(3);
    pass.end();
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
    this.renderTargets = null;
    this.pipelines = null;
    this.bindGroups = null;
  }
}

export default RenderPipeline;
