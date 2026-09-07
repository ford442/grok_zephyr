import { RENDER } from '@/types/constants.js';
import type { PipelineBuildArgs } from './pipelineLayouts.js';

export async function createScenePipelines({ context, layouts, modules }: PipelineBuildArgs) {
  const depthFormat = context.getDepthFormat();
  const [stars,
    earth,
    atmosphere,
    satellites,
    satellitesCulled,
    beam,
    beamCulled,
    groundTerrain,
    moonForeground,
    moonEarthDisk,
    skyline] = await Promise.all([
    context.createRenderPipelineAsync({
      label: 'stars',
      layout: layouts.device.createPipelineLayout({ bindGroupLayouts: [layouts.sceneAtmosphereLayout] }),
      vertex: { module: modules.stars, entryPoint: 'vs' },
      fragment: {
        module: modules.stars,
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
      layout: layouts.device.createPipelineLayout({
        bindGroupLayouts: [layouts.sceneAtmosphereLayout, layouts.earthMapLayout],
      }),
      vertex: { module: modules.earth, entryPoint: 'vs', buffers: [layouts.earthVertexLayout] },
      fragment: {
        module: modules.earth,
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
      layout: layouts.device.createPipelineLayout({ bindGroupLayouts: [layouts.sceneAtmosphereLayout] }),
      vertex: { module: modules.atmosphere, entryPoint: 'vs', buffers: [layouts.earthVertexLayout] },
      fragment: {
        module: modules.atmosphere,
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT, blend: layouts.additiveBlend }],
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
      layout: layouts.device.createPipelineLayout({ bindGroupLayouts: [layouts.satelliteLayout] }),
      vertex: { module: modules.satellites, entryPoint: 'vs' },
      fragment: {
        module: modules.satellites,
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT, blend: layouts.additiveBlend }],
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
      layout: layouts.device.createPipelineLayout({ bindGroupLayouts: [layouts.satelliteCulledLayout] }),
      vertex: { module: modules.satellitesCulled, entryPoint: 'vs_culled' },
      fragment: {
        module: modules.satellitesCulled,
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT, blend: layouts.additiveBlend }],
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
      layout: layouts.beamRenderLayout,
      vertex: { module: modules.beam, entryPoint: 'vs' },
      fragment: {
        module: modules.beam,
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT, blend: layouts.additiveBlend }],
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
      layout: layouts.beamCulledRenderLayout,
      vertex: { module: modules.beamCulled, entryPoint: 'vs_culled' },
      fragment: {
        module: modules.beamCulled,
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT, blend: layouts.additiveBlend }],
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
      layout: layouts.device.createPipelineLayout({
        bindGroupLayouts: [layouts.groundTerrainLayout, layouts.earthMapLayout],
      }),
      vertex: { module: modules.ground, entryPoint: 'vs' },
      fragment: {
        module: modules.ground,
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
      layout: layouts.device.createPipelineLayout({ bindGroupLayouts: [layouts.sceneAtmosphereLayout] }),
      vertex: { module: modules.moonForeground, entryPoint: 'vs' },
      fragment: {
        module: modules.moonForeground,
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
      layout: layouts.device.createPipelineLayout({ bindGroupLayouts: [layouts.sceneAtmosphereLayout] }),
      vertex: { module: modules.moonEarthDisk, entryPoint: 'vs' },
      fragment: {
        module: modules.moonEarthDisk,
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
      layout: layouts.device.createPipelineLayout({ bindGroupLayouts: [layouts.skylineLayout] }),
      vertex: { module: modules.skyline, entryPoint: 'vs' },
      fragment: {
        module: modules.skyline,
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: depthFormat,
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    })
  ]);
  return { stars, earth, atmosphere, satellites, satellitesCulled, beam, beamCulled, groundTerrain, moonForeground, moonEarthDisk, skyline };
}
