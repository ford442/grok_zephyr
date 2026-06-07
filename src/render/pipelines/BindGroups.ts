
import { RenderPipeline } from '../RenderPipeline.js';
import { PipelineBindGroups } from './types.js';

/**
   * Create bind groups for all pipelines
   */
  export function createBindGroups(pipeline: RenderPipeline): PipelineBindGroups {
    if (!pipeline.pipelines || !pipeline.renderTargets) return;
    if (!pipeline.bloomThresholdUniformBuffer || !pipeline.bloomCompositeUniformBuffer || !pipeline.tonemapUniformBuffer) return;
    if (!pipeline.motionBlurUniformBuffer) return;
    if (!pipeline.atmosphereLUTView || !pipeline.atmosphereSettingsBuffer) return;
    if (!pipeline.autoExposureStateBuffer) return;

    const device = pipeline.context.getDevice();
    const posBuffer = pipeline.buffers.positions instanceof GPUBuffer
    ? pipeline.buffers.positions
    : (pipeline.buffers.positions as { read: GPUBuffer }).read;

    // The bloom pyramid result is in mip[0] (1/2 res) after the upsample passes.
    const bloomResultView = pipeline.renderTargets.bloomMipViews[0];

    return {
    compute: device.createBindGroup({
      layout: pipeline.pipelines.compute.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: pipeline.buffers.uniforms } },
        { binding: 1, resource: { buffer: pipeline.buffers.orbitalElements } },
        { binding: 2, resource: { buffer: pipeline.buffers.extendedElements } },
        { binding: 3, resource: { buffer: posBuffer } },
      ],
    }),

    beamCompute: device.createBindGroup({
      layout: pipeline.pipelines.beamCompute.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: pipeline.buffers.uniforms } },
        { binding: 1, resource: { buffer: posBuffer } },
        { binding: 2, resource: { buffer: pipeline.buffers.beams } },
        { binding: 3, resource: { buffer: pipeline.buffers.beamParams } },
      ],
    }),

    stars: device.createBindGroup({
      layout: pipeline.pipelines.stars.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: pipeline.buffers.uniforms } },
        { binding: 1, resource: pipeline.atmosphereLUTView },
        { binding: 2, resource: pipeline.linearSampler },
        { binding: 3, resource: { buffer: pipeline.atmosphereSettingsBuffer } },
      ],
    }),

    earth: device.createBindGroup({
      layout: pipeline.pipelines.earth.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: pipeline.buffers.uniforms } },
        { binding: 1, resource: pipeline.atmosphereLUTView },
        { binding: 2, resource: pipeline.linearSampler },
        { binding: 3, resource: { buffer: pipeline.atmosphereSettingsBuffer } },
      ],
    }),

    atmosphere: device.createBindGroup({
      layout: pipeline.pipelines.atmosphere.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: pipeline.buffers.uniforms } },
        { binding: 1, resource: pipeline.atmosphereLUTView },
        { binding: 2, resource: pipeline.linearSampler },
        { binding: 3, resource: { buffer: pipeline.atmosphereSettingsBuffer } },
      ],
    }),

    satellites: device.createBindGroup({
      layout: pipeline.pipelines.satellites.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: pipeline.buffers.uniforms } },
        { binding: 1, resource: { buffer: posBuffer } },
        { binding: 2, resource: { buffer: pipeline.buffers.colors } },
        { binding: 3, resource: { buffer: pipeline.buffers.patternParams } },
        { binding: 4, resource: { buffer: pipeline.motionBlurUniformBuffer } },
      ],
    }),

    beam: device.createBindGroup({
      layout: pipeline.pipelines.beam.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: pipeline.buffers.uniforms } },
        { binding: 1, resource: { buffer: pipeline.buffers.beams } },
      ],
    }),

    groundTerrain: device.createBindGroup({
      layout: pipeline.pipelines.groundTerrain.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: pipeline.buffers.uniforms } }],
    }),

    bloomThreshold: device.createBindGroup({
      layout: pipeline.pipelines.bloomThreshold.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: pipeline.renderTargets.hdrView },
        { binding: 1, resource: pipeline.linearSampler },
        { binding: 2, resource: { buffer: pipeline.bloomThresholdUniformBuffer } },
      ],
    }),

    composite: device.createBindGroup({
      layout: pipeline.pipelines.composite.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: pipeline.renderTargets.hdrView },
        { binding: 1, resource: bloomResultView },
        { binding: 2, resource: pipeline.linearSampler },
        { binding: 3, resource: { buffer: pipeline.buffers.uniforms } },
        { binding: 4, resource: { buffer: pipeline.bloomCompositeUniformBuffer } },
        { binding: 5, resource: { buffer: pipeline.autoExposureStateBuffer } },
        { binding: 6, resource: { buffer: pipeline.tonemapUniformBuffer } },
      ],
    }),
    };
  }
