export function mat4_invert(a: Float32Array | Float64Array | number[]) { let a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3]; let a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7]; let a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11]; let a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15]; let b00 = a00 * a11 - a01 * a10; let b01 = a00 * a12 - a02 * a10; let b02 = a00 * a13 - a03 * a10; let b03 = a01 * a12 - a02 * a11; let b04 = a01 * a13 - a03 * a11; let b05 = a02 * a13 - a03 * a12; let b06 = a20 * a31 - a21 * a30; let b07 = a20 * a32 - a22 * a30; let b08 = a20 * a33 - a23 * a30; let b09 = a21 * a32 - a22 * a31; let b10 = a21 * a33 - a23 * a31; let b11 = a22 * a33 - a23 * a32; let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06; if (!det) return null; det = 1.0 / det; const res = new Float32Array(16); res[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; res[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det; res[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; res[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det; res[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; res[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det; res[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; res[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det; res[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; res[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det; res[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; res[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det; res[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; res[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det; res[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; res[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det; return res; }
/**
 * Grok Zephyr - Render Pipeline
 * 
 * Manages the 6-pass rendering pipeline:
 * 1. Compute orbital positions
 * 2. Smile V2 animation (optional, between compute and scene)
 * 3. Scene pass (stars, Earth, atmosphere, satellites)
 * 4. Bloom threshold
 * 5. Bloom horizontal blur
 * 6. Bloom vertical blur
 * 7. Composite + tonemapping
 */

import type WebGPUContext from '@/core/WebGPUContext.js';
import type { SatelliteBufferSet } from '@/core/SatelliteGPUBuffer.js';
import { SmileV2Pipeline } from './SmileV2Pipeline.js';
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
  private smileV2Pipeline: SmileV2Pipeline | null = null;
  
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

    // Satellite layout: uniform + positions + per-satellite color buffer
    const satelliteLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
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

    // Composite layout (binding 3 = shared Uni uniform for uni.time used in film grain)
    const compositeLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
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
          { binding: 3, resource: { buffer: this.buffers.uniforms } },
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

    // Set full canvas viewport to ensure entire framebuffer is rendered
    pass.setViewport(0, 0, this.width, this.height, 0, 1);

    // Satellites first (in the sky)
    pass.setPipeline(this.pipelines.satellites);
    pass.setBindGroup(0, this.bindGroups.satellites);
    pass.draw(6, CONSTANTS.NUM_SATELLITES);

    // Laser beams from satellites to Earth surface
    pass.setPipeline(this.pipelines.beam);
    pass.setBindGroup(0, this.bindGroups.beam);
    pass.draw(4, MAX_BEAMS);

    // Ground terrain (fullscreen quad) rendered on top to occlude foreground
    pass.setPipeline(this.pipelines.groundTerrain);
    pass.setBindGroup(0, this.bindGroups.groundTerrain);
    pass.draw(6);  // Draw full quad (6 vertices), not just 3

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
    thrPass.setViewport(0, 0, this.width, this.height, 0, 1);
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
    hBlurPass.setViewport(0, 0, this.width, this.height, 0, 1);
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
    vBlurPass.setViewport(0, 0, this.width, this.height, 0, 1);
    vBlurPass.setPipeline(this.pipelines.bloomBlur);
    vBlurPass.setBindGroup(0, this.bindGroups.bloomVertical);
    vBlurPass.draw(3);
    vBlurPass.end();
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
    
    if (this.smileV2Pipeline) {
      this.smileV2Pipeline.destroy();
      this.smileV2Pipeline = null;
    }
  }
}

export default RenderPipeline;
