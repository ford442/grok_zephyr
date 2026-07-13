/**
 * Auto exposure pass encoder — histogram + adaptation compute
 */

import type { FrameContext } from './types.js';

export function encodeAutoExposurePasses(
  encoder: GPUCommandEncoder,
  ctx: FrameContext,
  sceneSourceView: GPUTextureView,
  deltaTime: number,
): void {
  if (
    !ctx.autoExposureHistogramBuffer ||
    !ctx.autoExposureStateBuffer ||
    !ctx.autoExposureSettingsBuffer
  ) {
    return;
  }

  ctx.uniforms.writeAutoExposureSettingsUniform(deltaTime);
  if (!ctx.exposureSettings.autoEnabled) {
    return;
  }

  const device = ctx.context.getDevice();
  device.queue.writeBuffer(
    ctx.autoExposureHistogramBuffer,
    0,
    ctx.autoExposureHistogramClearData.buffer.slice(0),
  );

  const histogramBG = device.createBindGroup({
    layout: ctx.pipelines.autoExposureHistogram.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: sceneSourceView },
      { binding: 1, resource: { buffer: ctx.autoExposureHistogramBuffer } },
    ],
  });

  const adaptBG = device.createBindGroup({
    layout: ctx.pipelines.autoExposureAdapt.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: ctx.autoExposureHistogramBuffer } },
      { binding: 1, resource: { buffer: ctx.autoExposureStateBuffer } },
      { binding: 2, resource: { buffer: ctx.autoExposureSettingsBuffer } },
    ],
  });

  const pass = encoder.beginComputePass();
  pass.setPipeline(ctx.pipelines.autoExposureHistogram);
  pass.setBindGroup(0, histogramBG);
  pass.dispatchWorkgroups(Math.ceil(ctx.width / 16), Math.ceil(ctx.height / 16));
  pass.setPipeline(ctx.pipelines.autoExposureAdapt);
  pass.setBindGroup(0, adaptBG);
  pass.dispatchWorkgroups(1, 1, 1);
  pass.end();
}
