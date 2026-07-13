/**
 * Depth of field pass encoder
 */

import type { FrameContext } from './types.js';

export function encodeDepthOfFieldPasses(
  encoder: GPUCommandEncoder,
  ctx: FrameContext,
): GPUTextureView {
  if (!ctx.dofConfig.enabled || !ctx.dofUniformBuffer) {
    return ctx.renderTargets.hdrView;
  }

  const device = ctx.context.getDevice();
  const halfWidth = Math.max(1, Math.floor(ctx.width / 2));
  const halfHeight = Math.max(1, Math.floor(ctx.height / 2));

  const downsampleBG = device.createBindGroup({
    layout: ctx.pipelines.dofDownsample.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: ctx.renderTargets.hdrView },
      { binding: 1, resource: ctx.renderTargets.depthView },
      { binding: 2, resource: ctx.linearSampler },
      { binding: 3, resource: { buffer: ctx.dofUniformBuffer } },
    ],
  });
  const blurHBG = device.createBindGroup({
    layout: ctx.pipelines.dofBlurH.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: ctx.dofUniformBuffer } },
      { binding: 1, resource: ctx.renderTargets.dofHalfAView },
      { binding: 2, resource: ctx.linearSampler },
    ],
  });
  const blurVBG = device.createBindGroup({
    layout: ctx.pipelines.dofBlurV.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: ctx.dofUniformBuffer } },
      { binding: 1, resource: ctx.renderTargets.dofHalfBView },
      { binding: 2, resource: ctx.linearSampler },
    ],
  });
  const compositeBG = device.createBindGroup({
    layout: ctx.pipelines.dofComposite.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: ctx.renderTargets.hdrView },
      { binding: 1, resource: ctx.renderTargets.dofHalfAView },
      { binding: 2, resource: ctx.linearSampler },
      { binding: 3, resource: { buffer: ctx.dofUniformBuffer } },
    ],
  });

  {
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: ctx.renderTargets.dofHalfAView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setViewport(0, 0, halfWidth, halfHeight, 0, 1);
    pass.setPipeline(ctx.pipelines.dofDownsample);
    pass.setBindGroup(0, downsampleBG);
    pass.draw(3);
    pass.end();
  }
  {
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: ctx.renderTargets.dofHalfBView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setViewport(0, 0, halfWidth, halfHeight, 0, 1);
    pass.setPipeline(ctx.pipelines.dofBlurH);
    pass.setBindGroup(0, blurHBG);
    pass.draw(3);
    pass.end();
  }
  {
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: ctx.renderTargets.dofHalfAView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setViewport(0, 0, halfWidth, halfHeight, 0, 1);
    pass.setPipeline(ctx.pipelines.dofBlurV);
    pass.setBindGroup(0, blurVBG);
    pass.draw(3);
    pass.end();
  }
  {
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: ctx.renderTargets.dofCompositeView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setViewport(0, 0, ctx.width, ctx.height, 0, 1);
    pass.setPipeline(ctx.pipelines.dofComposite);
    pass.setBindGroup(0, compositeBG);
    pass.draw(3);
    pass.end();
  }

  return ctx.renderTargets.dofCompositeView;
}
