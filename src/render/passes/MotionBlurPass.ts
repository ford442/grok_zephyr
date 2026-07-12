/**
 * Motion blur pass encoder
 */

import type { PassContext } from './types.js';

export function encodeMotionBlurPass(
  encoder: GPUCommandEncoder,
  ctx: PassContext,
  sourceView: GPUTextureView,
): GPUTextureView {
  if (!ctx.motionBlurUniformBuffer) return sourceView;
  if (!ctx.motionBlurConfig.enabled || ctx.motionBlurConfig.cameraStrength <= 0.0) return sourceView;

  const bindGroup = ctx.context.getDevice().createBindGroup({
    layout: ctx.pipelines.motionBlur.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: sourceView },
      { binding: 1, resource: ctx.renderTargets.depthView },
      { binding: 2, resource: ctx.linearSampler },
      { binding: 3, resource: { buffer: ctx.motionBlurUniformBuffer } },
    ],
  });

  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: ctx.renderTargets.motionBlurView,
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });
  pass.setViewport(0, 0, ctx.width, ctx.height, 0, 1);
  pass.setPipeline(ctx.pipelines.motionBlur);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3);
  pass.end();

  return ctx.renderTargets.motionBlurView;
}
