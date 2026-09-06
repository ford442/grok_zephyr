/**
 * Pipeline Factory — creates all GPU shader pipelines
 */

import type { WebGPUContext } from '@/core/WebGPUContext.js';
import { SHADERS } from '@/shaders/index.js';
import { buildBloomDownsample } from '@/shaders/render/postProcess/bloomDownsample.js';
import { injectFleetCount } from '@/core/FleetScale.js';
import { RENDER } from '@/types/constants.js';
import type { Pipelines } from './types.js';

export async function createPipelines(context: WebGPUContext): Promise<Pipelines> {
  const device = context.getDevice();

  // Compute pipeline layout
  const computeLayout = device.createPipelineLayout({
    bindGroupLayouts: [
      device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
          { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
          { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
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
      {
        binding: 5,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      },
      { binding: 7, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
    ],
  });

  const satelliteCulledLayout = device.createBindGroupLayout({
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
      {
        binding: 5,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      },
      { binding: 6, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 7, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
    ],
  });

  const satelliteCullLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
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

  const beamCulledRenderLayout = device.createPipelineLayout({
    bindGroupLayouts: [
      device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: 'uniform' },
          },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
          { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        ],
      }),
    ],
  });

  const shader = (code: string, label: string): GPUShaderModule =>
    context.createShaderModule(code, label);

  const satelliteCullModule = shader(
    injectFleetCount(SHADERS.compute.satelliteCull),
    'satellite-cull',
  );
  const orbitalModule = shader(injectFleetCount(SHADERS.compute.orbital), 'orbital');
  const beamComputeModule = shader(injectFleetCount(SHADERS.compute.beam), 'beam-compute');
  const islComputeModule = shader(injectFleetCount(SHADERS.compute.isl), 'isl-compute');
  const islFiberModule = shader(SHADERS.render.isl, 'isl-fiber');
  const autoExposureHistogramModule = shader(
    SHADERS.render.postProcess.autoExposureHistogram,
    'auto-exposure-histogram',
  );
  const autoExposureAdaptModule = shader(
    SHADERS.render.postProcess.autoExposureAdapt,
    'auto-exposure-adapt',
  );
  const starsModule = shader(SHADERS.render.stars, 'stars');
  const earthModule = shader(SHADERS.render.earth, 'earth');
  const atmosphereModule = shader(SHADERS.render.atmosphere, 'atmosphere');
  const satellitesModule = shader(SHADERS.render.satellites, 'satellites');
  const satellitesCulledModule = shader(SHADERS.render.satellitesCulled, 'satellites-culled');
  const beamModule = shader(SHADERS.render.beam, 'beam-render');
  const beamCulledModule = shader(SHADERS.render.beamCulled, 'beam-culled');
  const groundModule = shader(SHADERS.render.ground, 'ground-terrain');
  const moonForegroundModule = shader(SHADERS.render.moonForeground, 'moon-foreground');
  const moonEarthDiskModule = shader(SHADERS.render.moonEarthDisk, 'moon-earth-disk');
  const skylineModule = shader(SHADERS.render.skyline, 'skyline-city');
  const bloomThresholdModule = shader(
    SHADERS.render.postProcess.bloomThreshold,
    'bloom-threshold',
  );
  const bloomBlurModule = shader(SHADERS.render.postProcess.bloomBlur, 'bloom-blur');
  const bloomDownsampleModule = shader(
    buildBloomDownsample(context.getCapabilities()?.shaderF16Bloom ?? false),
    'bloom-downsample',
  );
  const bloomUpsampleModule = shader(SHADERS.render.postProcess.bloomUpsample, 'bloom-upsample');
  const compositeModule = shader(SHADERS.render.postProcess.composite, 'composite');
  const dofDownsampleModule = shader(SHADERS.render.postProcess.dofDownsample, 'dof-downsample');
  const dofBlurModule = shader(SHADERS.render.postProcess.dofBlur, 'dof-blur');
  const dofCompositeModule = shader(SHADERS.render.postProcess.dofComposite, 'dof-composite');
  const motionBlurModule = shader(SHADERS.render.postProcess.motionBlur, 'motion-blur');

  await context.awaitShaderCompilation();

  const depthFormat = context.getDepthFormat();
  const islComputeLayout = device.createPipelineLayout({
    bindGroupLayouts: [
      device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
          { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        ],
      }),
    ],
  });
  const islFiberLayout = device.createPipelineLayout({
    bindGroupLayouts: [
      device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: 'uniform' },
          },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
          {
            binding: 2,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: 'uniform' },
          },
        ],
      }),
    ],
  });

  const [
    compute,
    beamCompute,
    islCompute,
    islFiber,
    satelliteCullSats,
    satelliteCullBeams,
    satelliteCullFinalize,
    autoExposureHistogram,
    autoExposureAdapt,
    stars,
    earth,
    atmosphere,
    satellites,
    satellitesCulled,
    beam,
    beamCulled,
    groundTerrain,
    moonForeground,
    moonEarthDisk,
    skyline,
    bloomThreshold,
    bloomBlur,
    bloomDownsample,
    bloomUpsample,
    composite,
    dofDownsample,
    dofBlurH,
    dofBlurV,
    dofComposite,
    motionBlur,
  ] = await Promise.all([
    context.createComputePipelineAsync({
      label: 'orbital',
      layout: computeLayout,
      compute: { module: orbitalModule, entryPoint: 'main' },
    }),
    context.createComputePipelineAsync({
      label: 'beam-compute',
      layout: beamComputeLayout,
      compute: { module: beamComputeModule, entryPoint: 'main' },
    }),
    context.createComputePipelineAsync({
      label: 'isl-compute',
      layout: islComputeLayout,
      compute: { module: islComputeModule, entryPoint: 'main' },
    }),
    context.createRenderPipelineAsync({
      label: 'isl-fiber',
      layout: islFiberLayout,
      vertex: { module: islFiberModule, entryPoint: 'vs' },
      fragment: {
        module: islFiberModule,
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT, blend: additiveBlend }],
      },
      primitive: { topology: 'triangle-strip' },
      depthStencil: {
        format: depthFormat,
        depthWriteEnabled: false,
        depthCompare: 'less',
      },
    }),
    context.createComputePipelineAsync({
      label: 'satellite-cull-sats',
      layout: device.createPipelineLayout({ bindGroupLayouts: [satelliteCullLayout] }),
      compute: { module: satelliteCullModule, entryPoint: 'cull_satellites' },
    }),
    context.createComputePipelineAsync({
      label: 'satellite-cull-beams',
      layout: device.createPipelineLayout({ bindGroupLayouts: [satelliteCullLayout] }),
      compute: { module: satelliteCullModule, entryPoint: 'cull_beams' },
    }),
    context.createComputePipelineAsync({
      label: 'satellite-cull-finalize',
      layout: device.createPipelineLayout({ bindGroupLayouts: [satelliteCullLayout] }),
      compute: { module: satelliteCullModule, entryPoint: 'finalize_indirect' },
    }),
    context.createComputePipelineAsync({
      label: 'auto-exposure-histogram',
      layout: device.createPipelineLayout({ bindGroupLayouts: [autoExposureHistogramLayout] }),
      compute: { module: autoExposureHistogramModule, entryPoint: 'main' },
    }),
    context.createComputePipelineAsync({
      label: 'auto-exposure-adapt',
      layout: device.createPipelineLayout({ bindGroupLayouts: [autoExposureAdaptLayout] }),
      compute: { module: autoExposureAdaptModule, entryPoint: 'main' },
    }),
    context.createRenderPipelineAsync({
      label: 'stars',
      layout: device.createPipelineLayout({ bindGroupLayouts: [sceneAtmosphereLayout] }),
      vertex: { module: starsModule, entryPoint: 'vs' },
      fragment: {
        module: starsModule,
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: depthFormat,
        depthWriteEnabled: false,
        depthCompare: 'always',
      },
    }),
    context.createRenderPipelineAsync({
      label: 'earth',
      layout: device.createPipelineLayout({ bindGroupLayouts: [sceneAtmosphereLayout] }),
      vertex: { module: earthModule, entryPoint: 'vs', buffers: [earthVertexLayout] },
      fragment: {
        module: earthModule,
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: {
        format: depthFormat,
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    }),
    context.createRenderPipelineAsync({
      label: 'atmosphere',
      layout: device.createPipelineLayout({ bindGroupLayouts: [sceneAtmosphereLayout] }),
      vertex: { module: atmosphereModule, entryPoint: 'vs', buffers: [earthVertexLayout] },
      fragment: {
        module: atmosphereModule,
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT, blend: additiveBlend }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'front' },
      depthStencil: {
        format: depthFormat,
        depthWriteEnabled: false,
        depthCompare: 'less',
      },
    }),
    context.createRenderPipelineAsync({
      label: 'satellites',
      layout: device.createPipelineLayout({ bindGroupLayouts: [satelliteLayout] }),
      vertex: { module: satellitesModule, entryPoint: 'vs' },
      fragment: {
        module: satellitesModule,
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT, blend: additiveBlend }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: depthFormat,
        depthWriteEnabled: false,
        depthCompare: 'less',
      },
    }),
    context.createRenderPipelineAsync({
      label: 'satellites-culled',
      layout: device.createPipelineLayout({ bindGroupLayouts: [satelliteCulledLayout] }),
      vertex: { module: satellitesCulledModule, entryPoint: 'vs_culled' },
      fragment: {
        module: satellitesCulledModule,
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT, blend: additiveBlend }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: depthFormat,
        depthWriteEnabled: false,
        depthCompare: 'less',
      },
    }),
    context.createRenderPipelineAsync({
      label: 'beam-render',
      layout: beamRenderLayout,
      vertex: { module: beamModule, entryPoint: 'vs' },
      fragment: {
        module: beamModule,
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT, blend: additiveBlend }],
      },
      primitive: { topology: 'triangle-strip' },
      depthStencil: {
        format: depthFormat,
        depthWriteEnabled: false,
        depthCompare: 'less',
      },
    }),
    context.createRenderPipelineAsync({
      label: 'beam-culled',
      layout: beamCulledRenderLayout,
      vertex: { module: beamCulledModule, entryPoint: 'vs_culled' },
      fragment: {
        module: beamCulledModule,
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT, blend: additiveBlend }],
      },
      primitive: { topology: 'triangle-strip' },
      depthStencil: {
        format: depthFormat,
        depthWriteEnabled: false,
        depthCompare: 'less',
      },
    }),
    context.createRenderPipelineAsync({
      label: 'ground-terrain',
      layout: device.createPipelineLayout({ bindGroupLayouts: [groundTerrainLayout] }),
      vertex: { module: groundModule, entryPoint: 'vs' },
      fragment: {
        module: groundModule,
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
        format: depthFormat,
        depthWriteEnabled: false,
        depthCompare: 'always',
      },
    }),
    context.createRenderPipelineAsync({
      label: 'moon-foreground',
      layout: device.createPipelineLayout({ bindGroupLayouts: [sceneAtmosphereLayout] }),
      vertex: { module: moonForegroundModule, entryPoint: 'vs' },
      fragment: {
        module: moonForegroundModule,
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
        format: depthFormat,
        depthWriteEnabled: false,
        depthCompare: 'always',
      },
    }),
    context.createRenderPipelineAsync({
      label: 'moon-earth-disk',
      layout: device.createPipelineLayout({ bindGroupLayouts: [sceneAtmosphereLayout] }),
      vertex: { module: moonEarthDiskModule, entryPoint: 'vs' },
      fragment: {
        module: moonEarthDiskModule,
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
        format: depthFormat,
        depthWriteEnabled: false,
        depthCompare: 'always',
      },
    }),
    context.createRenderPipelineAsync({
      label: 'skyline-city',
      layout: device.createPipelineLayout({ bindGroupLayouts: [skylineLayout] }),
      vertex: { module: skylineModule, entryPoint: 'vs' },
      fragment: {
        module: skylineModule,
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: depthFormat,
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    }),
    context.createRenderPipelineAsync({
      label: 'bloom-threshold',
      layout: device.createPipelineLayout({ bindGroupLayouts: [thresholdLayout] }),
      vertex: { module: bloomThresholdModule, entryPoint: 'vs' },
      fragment: {
        module: bloomThresholdModule,
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list' },
    }),
    context.createRenderPipelineAsync({
      label: 'bloom-blur',
      layout: device.createPipelineLayout({ bindGroupLayouts: [bloomLayout] }),
      vertex: { module: bloomBlurModule, entryPoint: 'vs' },
      fragment: {
        module: bloomBlurModule,
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list' },
    }),
    context.createRenderPipelineAsync({
      label: 'bloom-downsample',
      layout: device.createPipelineLayout({ bindGroupLayouts: [bloomLayout] }),
      vertex: { module: bloomDownsampleModule, entryPoint: 'vs' },
      fragment: {
        module: bloomDownsampleModule,
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list' },
    }),
    context.createRenderPipelineAsync({
      label: 'bloom-upsample',
      layout: device.createPipelineLayout({ bindGroupLayouts: [bloomLayout] }),
      vertex: { module: bloomUpsampleModule, entryPoint: 'vs' },
      fragment: {
        module: bloomUpsampleModule,
        entryPoint: 'fs',
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
    context.createRenderPipelineAsync({
      label: 'composite',
      layout: device.createPipelineLayout({ bindGroupLayouts: [compositeLayout] }),
      vertex: { module: compositeModule, entryPoint: 'vs' },
      fragment: {
        module: compositeModule,
        entryPoint: 'fs',
        targets: [{ format: context.getFormat() }],
      },
      primitive: { topology: 'triangle-list' },
    }),
    context.createRenderPipelineAsync({
      label: 'dof-downsample',
      layout: device.createPipelineLayout({ bindGroupLayouts: [dofDownsampleLayout] }),
      vertex: { module: dofDownsampleModule, entryPoint: 'vs' },
      fragment: {
        module: dofDownsampleModule,
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list' },
    }),
    context.createRenderPipelineAsync({
      label: 'dof-blur-h',
      layout: device.createPipelineLayout({ bindGroupLayouts: [dofBlurLayout] }),
      vertex: { module: dofBlurModule, entryPoint: 'vs' },
      fragment: {
        module: dofBlurModule,
        entryPoint: 'fsHorizontal',
        targets: [{ format: RENDER.HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list' },
    }),
    context.createRenderPipelineAsync({
      label: 'dof-blur-v',
      layout: device.createPipelineLayout({ bindGroupLayouts: [dofBlurLayout] }),
      vertex: { module: dofBlurModule, entryPoint: 'vs' },
      fragment: {
        module: dofBlurModule,
        entryPoint: 'fsVertical',
        targets: [{ format: RENDER.HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list' },
    }),
    context.createRenderPipelineAsync({
      label: 'dof-composite',
      layout: device.createPipelineLayout({ bindGroupLayouts: [dofCompositeLayout] }),
      vertex: { module: dofCompositeModule, entryPoint: 'vs' },
      fragment: {
        module: dofCompositeModule,
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list' },
    }),
    context.createRenderPipelineAsync({
      label: 'motion-blur',
      layout: device.createPipelineLayout({ bindGroupLayouts: [motionBlurLayout] }),
      vertex: { module: motionBlurModule, entryPoint: 'vs' },
      fragment: {
        module: motionBlurModule,
        entryPoint: 'fs',
        targets: [{ format: 'rgba16float' }],
      },
      primitive: { topology: 'triangle-list' },
    }),
  ]);

  return {
    compute,
    beamCompute,
    islCompute,
    islFiber,
    satelliteCullSats,
    satelliteCullBeams,
    satelliteCullFinalize,
    autoExposureHistogram,
    autoExposureAdapt,
    stars,
    earth,
    atmosphere,
    satellites,
    satellitesCulled,
    beam,
    beamCulled,
    groundTerrain,
    moonForeground,
    moonEarthDisk,
    skyline,
    bloomThreshold,
    bloomBlur,
    bloomDownsample,
    bloomUpsample,
    composite,
    dofDownsample,
    dofBlurH,
    dofBlurV,
    dofComposite,
    motionBlur,
  };
}
