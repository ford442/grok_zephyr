/**
 * Pipeline Factory — creates all GPU shader pipelines
 */

import type { WebGPUContext } from '@/core/WebGPUContext.js';
import { SHADERS } from '@/shaders/index.js';
import { RENDER } from '@/types/constants.js';
import type { Pipelines } from './types.js';

export function createPipelines(context: WebGPUContext): Pipelines {
  const device = context.getDevice();

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

  // Shared scene atmosphere layout (uniform + LUT + sampler + settings)
  const sceneAtmosphereLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });

  // Ground horizon layout: scene atmosphere bindings + per-preset GroundParams
  const groundTerrainLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });

  // Satellite layout: uniform + positions + per-satellite color buffer + pattern params
  const satelliteLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      {
        binding: 3,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      },
      { binding: 4, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
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
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 6, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });

  const autoExposureHistogramLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });

  const autoExposureAdaptLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ],
  });

  const dofDownsampleLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });

  const dofBlurLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    ],
  });

  const dofCompositeLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });

  // Skyline city layout: shared Uni + CityUni + read-only buildings storage
  const skylineLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'read-only-storage' },
      },
    ],
  });

  const motionBlurLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      {
        binding: 3,
        visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX,
        buffer: { type: 'uniform' },
      },
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
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: 'uniform' },
          },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        ],
      }),
    ],
  });

  // Create pipelines
  return {
    compute: device.createComputePipeline({
      layout: computeLayout,
      compute: {
        module: context.createShaderModule(SHADERS.compute.orbital, 'orbital'),
        entryPoint: 'main',
      },
    }),

    beamCompute: device.createComputePipeline({
      layout: beamComputeLayout,
      compute: {
        module: context.createShaderModule(SHADERS.compute.beam, 'beam-compute'),
        entryPoint: 'main',
      },
    }),
    autoExposureHistogram: device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [autoExposureHistogramLayout] }),
      compute: {
        module: context.createShaderModule(
          SHADERS.render.postProcess.autoExposureHistogram,
          'auto-exposure-histogram',
        ),
        entryPoint: 'main',
      },
    }),
    autoExposureAdapt: device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [autoExposureAdaptLayout] }),
      compute: {
        module: context.createShaderModule(
          SHADERS.render.postProcess.autoExposureAdapt,
          'auto-exposure-adapt',
        ),
        entryPoint: 'main',
      },
    }),

    stars: device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [sceneAtmosphereLayout] }),
      vertex: {
        module: context.createShaderModule(SHADERS.render.stars, 'stars'),
        entryPoint: 'vs',
      },
      fragment: {
        module: context.createShaderModule(SHADERS.render.stars, 'stars'),
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
      layout: device.createPipelineLayout({ bindGroupLayouts: [sceneAtmosphereLayout] }),
      vertex: {
        module: context.createShaderModule(SHADERS.render.earth, 'earth'),
        entryPoint: 'vs',
        buffers: [earthVertexLayout],
      },
      fragment: {
        module: context.createShaderModule(SHADERS.render.earth, 'earth'),
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
      layout: device.createPipelineLayout({ bindGroupLayouts: [sceneAtmosphereLayout] }),
      vertex: {
        module: context.createShaderModule(SHADERS.render.atmosphere, 'atmosphere'),
        entryPoint: 'vs',
        buffers: [earthVertexLayout],
      },
      fragment: {
        module: context.createShaderModule(SHADERS.render.atmosphere, 'atmosphere'),
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
        module: context.createShaderModule(SHADERS.render.satellites, 'satellites'),
        entryPoint: 'vs',
      },
      fragment: {
        module: context.createShaderModule(SHADERS.render.satellites, 'satellites'),
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
        module: context.createShaderModule(SHADERS.render.beam, 'beam-render'),
        entryPoint: 'vs',
      },
      fragment: {
        module: context.createShaderModule(SHADERS.render.beam, 'beam-render'),
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
      layout: device.createPipelineLayout({ bindGroupLayouts: [groundTerrainLayout] }),
      vertex: {
        module: context.createShaderModule(SHADERS.render.ground, 'ground-terrain'),
        entryPoint: 'vs',
      },
      fragment: {
        module: context.createShaderModule(SHADERS.render.ground, 'ground-terrain'),
        entryPoint: 'fs',
        targets: [
          {
            format: RENDER.HDR_FORMAT,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: RENDER.DEPTH_FORMAT,
        depthWriteEnabled: false,
        depthCompare: 'always',
      },
    }),

    moonForeground: device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [sceneAtmosphereLayout] }),
      vertex: {
        module: context.createShaderModule(SHADERS.render.moonForeground, 'moon-foreground'),
        entryPoint: 'vs',
      },
      fragment: {
        module: context.createShaderModule(SHADERS.render.moonForeground, 'moon-foreground'),
        entryPoint: 'fs',
        targets: [
          {
            format: RENDER.HDR_FORMAT,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: RENDER.DEPTH_FORMAT,
        depthWriteEnabled: false,
        depthCompare: 'always',
      },
    }),

    moonEarthDisk: device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [sceneAtmosphereLayout] }),
      vertex: {
        module: context.createShaderModule(SHADERS.render.moonEarthDisk, 'moon-earth-disk'),
        entryPoint: 'vs',
      },
      fragment: {
        module: context.createShaderModule(SHADERS.render.moonEarthDisk, 'moon-earth-disk'),
        entryPoint: 'fs',
        targets: [
          {
            format: RENDER.HDR_FORMAT,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: RENDER.DEPTH_FORMAT,
        depthWriteEnabled: false,
        depthCompare: 'always',
      },
    }),

    skyline: device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [skylineLayout] }),
      vertex: {
        module: context.createShaderModule(SHADERS.render.skyline, 'skyline-city'),
        entryPoint: 'vs',
      },
      fragment: {
        module: context.createShaderModule(SHADERS.render.skyline, 'skyline-city'),
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: RENDER.DEPTH_FORMAT,
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    }),

    bloomThreshold: device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [thresholdLayout] }),
      vertex: {
        module: context.createShaderModule(
          SHADERS.render.postProcess.bloomThreshold,
          'bloom-threshold',
        ),
        entryPoint: 'vs',
      },
      fragment: {
        module: context.createShaderModule(
          SHADERS.render.postProcess.bloomThreshold,
          'bloom-threshold',
        ),
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list' },
    }),

    bloomBlur: device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bloomLayout] }),
      vertex: {
        module: context.createShaderModule(SHADERS.render.postProcess.bloomBlur, 'bloom-blur'),
        entryPoint: 'vs',
      },
      fragment: {
        module: context.createShaderModule(SHADERS.render.postProcess.bloomBlur, 'bloom-blur'),
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list' },
    }),

    bloomDownsample: device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bloomLayout] }),
      vertex: {
        module: context.createShaderModule(
          SHADERS.render.postProcess.bloomDownsample,
          'bloom-downsample',
        ),
        entryPoint: 'vs',
      },
      fragment: {
        module: context.createShaderModule(
          SHADERS.render.postProcess.bloomDownsample,
          'bloom-downsample',
        ),
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list' },
    }),

    bloomUpsample: device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bloomLayout] }),
      vertex: {
        module: context.createShaderModule(
          SHADERS.render.postProcess.bloomUpsample,
          'bloom-upsample',
        ),
        entryPoint: 'vs',
      },
      fragment: {
        module: context.createShaderModule(
          SHADERS.render.postProcess.bloomUpsample,
          'bloom-upsample',
        ),
        entryPoint: 'fs',
        // Additive blend: each upsample level accumulates onto the target
        targets: [
          {
            format: RENDER.HDR_FORMAT,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
    }),

    composite: device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [compositeLayout] }),
      vertex: {
        module: context.createShaderModule(SHADERS.render.postProcess.composite, 'composite'),
        entryPoint: 'vs',
      },
      fragment: {
        module: context.createShaderModule(SHADERS.render.postProcess.composite, 'composite'),
        entryPoint: 'fs',
        targets: [{ format: context.getFormat() }],
      },
      primitive: { topology: 'triangle-list' },
    }),
    dofDownsample: device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [dofDownsampleLayout] }),
      vertex: {
        module: context.createShaderModule(
          SHADERS.render.postProcess.dofDownsample,
          'dof-downsample',
        ),
        entryPoint: 'vs',
      },
      fragment: {
        module: context.createShaderModule(
          SHADERS.render.postProcess.dofDownsample,
          'dof-downsample',
        ),
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list' },
    }),
    dofBlurH: device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [dofBlurLayout] }),
      vertex: {
        module: context.createShaderModule(SHADERS.render.postProcess.dofBlur, 'dof-blur'),
        entryPoint: 'vs',
      },
      fragment: {
        module: context.createShaderModule(SHADERS.render.postProcess.dofBlur, 'dof-blur'),
        entryPoint: 'fsHorizontal',
        targets: [{ format: RENDER.HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list' },
    }),
    dofBlurV: device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [dofBlurLayout] }),
      vertex: {
        module: context.createShaderModule(SHADERS.render.postProcess.dofBlur, 'dof-blur'),
        entryPoint: 'vs',
      },
      fragment: {
        module: context.createShaderModule(SHADERS.render.postProcess.dofBlur, 'dof-blur'),
        entryPoint: 'fsVertical',
        targets: [{ format: RENDER.HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list' },
    }),
    dofComposite: device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [dofCompositeLayout] }),
      vertex: {
        module: context.createShaderModule(
          SHADERS.render.postProcess.dofComposite,
          'dof-composite',
        ),
        entryPoint: 'vs',
      },
      fragment: {
        module: context.createShaderModule(
          SHADERS.render.postProcess.dofComposite,
          'dof-composite',
        ),
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list' },
    }),
    motionBlur: device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [motionBlurLayout] }),
      vertex: {
        module: context.createShaderModule(SHADERS.render.postProcess.motionBlur, 'motion-blur'),
        entryPoint: 'vs',
      },
      fragment: {
        module: context.createShaderModule(SHADERS.render.postProcess.motionBlur, 'motion-blur'),
        entryPoint: 'fs',
        targets: [{ format: 'rgba16float' }],
      },
      primitive: { topology: 'triangle-list' },
    }),
  };
}
