/**
 * Bind Group Factory — static and dynamic bind group creation
 */

import type WebGPUContext from '@/core/WebGPUContext.js';
import type { SatelliteBufferSet } from '@/core/SatelliteGPUBuffer.js';
import type { PipelineBindGroups, Pipelines, RenderTargets } from './types.js';

export interface BindGroupResources {
  context: WebGPUContext;
  buffers: SatelliteBufferSet;
  pipelines: Pipelines;
  renderTargets: RenderTargets;
  linearSampler: GPUSampler;
  atmosphereLUTView: GPUTextureView;
  atmosphereSettingsBuffer: GPUBuffer;
  groundParamsBuffer: GPUBuffer;
  bloomThresholdUniformBuffer: GPUBuffer;
  bloomCompositeUniformBuffer: GPUBuffer;
  tonemapUniformBuffer: GPUBuffer;
  autoExposureStateBuffer: GPUBuffer;
  motionBlurUniformBuffer: GPUBuffer;
  satelliteVisualUniformBuffer: GPUBuffer;
}

export function createStaticBindGroups(resources: BindGroupResources): PipelineBindGroups {
  const {
    context,
    buffers,
    pipelines,
    renderTargets,
    linearSampler,
    atmosphereLUTView,
    atmosphereSettingsBuffer,
    groundParamsBuffer,
    bloomThresholdUniformBuffer,
    bloomCompositeUniformBuffer,
    tonemapUniformBuffer,
    autoExposureStateBuffer,
    motionBlurUniformBuffer,
    satelliteVisualUniformBuffer,
  } = resources;

  const device = context.getDevice();
  const posBuffer = buffers.positions instanceof GPUBuffer
    ? buffers.positions
    : (buffers.positions as { read: GPUBuffer }).read;

  const bloomResultView = renderTargets.bloomMipViews[0];

  return {
    compute: device.createBindGroup({
      layout: pipelines.compute.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.uniforms } },
        { binding: 1, resource: { buffer: buffers.orbitalElements } },
        { binding: 2, resource: { buffer: buffers.extendedElements } },
        { binding: 3, resource: { buffer: posBuffer } },
      ],
    }),

    beamCompute: device.createBindGroup({
      layout: pipelines.beamCompute.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.uniforms } },
        { binding: 1, resource: { buffer: posBuffer } },
        { binding: 2, resource: { buffer: buffers.beams } },
        { binding: 3, resource: { buffer: buffers.beamParams } },
      ],
    }),

    stars: device.createBindGroup({
      layout: pipelines.stars.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.uniforms } },
        { binding: 1, resource: atmosphereLUTView },
        { binding: 2, resource: linearSampler },
        { binding: 3, resource: { buffer: atmosphereSettingsBuffer } },
      ],
    }),

    earth: device.createBindGroup({
      layout: pipelines.earth.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.uniforms } },
        { binding: 1, resource: atmosphereLUTView },
        { binding: 2, resource: linearSampler },
        { binding: 3, resource: { buffer: atmosphereSettingsBuffer } },
      ],
    }),

    atmosphere: device.createBindGroup({
      layout: pipelines.atmosphere.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.uniforms } },
        { binding: 1, resource: atmosphereLUTView },
        { binding: 2, resource: linearSampler },
        { binding: 3, resource: { buffer: atmosphereSettingsBuffer } },
      ],
    }),

    satellites: device.createBindGroup({
      layout: pipelines.satellites.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.uniforms } },
        { binding: 1, resource: { buffer: posBuffer } },
        { binding: 2, resource: { buffer: buffers.colors } },
        { binding: 3, resource: { buffer: buffers.patternParams } },
        { binding: 4, resource: { buffer: motionBlurUniformBuffer } },
        { binding: 5, resource: { buffer: satelliteVisualUniformBuffer } },
      ],
    }),

    beam: device.createBindGroup({
      layout: pipelines.beam.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.uniforms } },
        { binding: 1, resource: { buffer: buffers.beams } },
      ],
    }),

    groundTerrain: device.createBindGroup({
      layout: pipelines.groundTerrain.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.uniforms } },
        { binding: 1, resource: atmosphereLUTView },
        { binding: 2, resource: linearSampler },
        { binding: 3, resource: { buffer: atmosphereSettingsBuffer } },
        { binding: 4, resource: { buffer: groundParamsBuffer } },
      ],
    }),

    moonForeground: device.createBindGroup({
      layout: pipelines.moonForeground.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.uniforms } },
        { binding: 1, resource: atmosphereLUTView },
        { binding: 2, resource: linearSampler },
        { binding: 3, resource: { buffer: atmosphereSettingsBuffer } },
      ],
    }),

    moonEarthDisk: device.createBindGroup({
      layout: pipelines.moonEarthDisk.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.uniforms } },
        { binding: 1, resource: atmosphereLUTView },
        { binding: 2, resource: linearSampler },
        { binding: 3, resource: { buffer: atmosphereSettingsBuffer } },
      ],
    }),

    bloomThreshold: device.createBindGroup({
      layout: pipelines.bloomThreshold.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: renderTargets.hdrView },
        { binding: 1, resource: linearSampler },
        { binding: 2, resource: { buffer: bloomThresholdUniformBuffer } },
      ],
    }),

    composite: device.createBindGroup({
      layout: pipelines.composite.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: renderTargets.hdrView },
        { binding: 1, resource: bloomResultView },
        { binding: 2, resource: linearSampler },
        { binding: 3, resource: { buffer: buffers.uniforms } },
        { binding: 4, resource: { buffer: bloomCompositeUniformBuffer } },
        { binding: 5, resource: { buffer: autoExposureStateBuffer } },
        { binding: 6, resource: { buffer: tonemapUniformBuffer } },
      ],
    }),
  };
}

export function createBloomThresholdBindGroup(
  context: WebGPUContext,
  pipelines: Pipelines,
  linearSampler: GPUSampler,
  sceneSourceView: GPUTextureView,
  bloomThresholdUniformBuffer: GPUBuffer,
): GPUBindGroup {
  const device = context.getDevice();
  return device.createBindGroup({
    layout: pipelines.bloomThreshold.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: sceneSourceView },
      { binding: 1, resource: linearSampler },
      { binding: 2, resource: { buffer: bloomThresholdUniformBuffer } },
    ],
  });
}

export function createCompositeBindGroup(
  context: WebGPUContext,
  pipelines: Pipelines,
  buffers: SatelliteBufferSet,
  renderTargets: RenderTargets,
  linearSampler: GPUSampler,
  sceneSourceView: GPUTextureView,
  bloomCompositeUniformBuffer: GPUBuffer,
  autoExposureStateBuffer: GPUBuffer,
  tonemapUniformBuffer: GPUBuffer,
): GPUBindGroup {
  const device = context.getDevice();
  const bloomResultView = renderTargets.bloomMipViews[0];
  return device.createBindGroup({
    layout: pipelines.composite.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: sceneSourceView },
      { binding: 1, resource: bloomResultView },
      { binding: 2, resource: linearSampler },
      { binding: 3, resource: { buffer: buffers.uniforms } },
      { binding: 4, resource: { buffer: bloomCompositeUniformBuffer } },
      { binding: 5, resource: { buffer: autoExposureStateBuffer } },
      { binding: 6, resource: { buffer: tonemapUniformBuffer } },
    ],
  });
}

export function createSkylineBindGroup(
  context: WebGPUContext,
  pipelines: Pipelines,
  uniforms: GPUBuffer,
  cityUniformBuffer: GPUBuffer,
  instanceBuffer: GPUBuffer,
): GPUBindGroup {
  const device = context.getDevice();
  return device.createBindGroup({
    layout: pipelines.skyline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniforms } },
      { binding: 1, resource: { buffer: cityUniformBuffer } },
      { binding: 2, resource: { buffer: instanceBuffer } },
    ],
  });
}
