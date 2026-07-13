/**
 * Bloom pass encoder — multi-resolution Kawase pyramid
 */

import { createBloomThresholdBindGroup } from '../pipelines/BindGroupFactory.js';
import { MAX_BLOOM_LEVELS, MIN_BLOOM_LEVELS } from '../pipelines/types.js';
import type { FrameContext } from './types.js';

export function encodeBloomPasses(
  encoder: GPUCommandEncoder,
  ctx: FrameContext,
  sceneSourceView?: GPUTextureView,
): void {
  if (ctx.bloomKawaseBuffers.length === 0) return;

  const device = ctx.context.getDevice();
  const levels = Math.min(Math.max(MIN_BLOOM_LEVELS, ctx.bloomConfig.levels), MAX_BLOOM_LEVELS);

  for (let i = 0; i < levels; i++) {
    if (!ctx.renderTargets.bloomMip[i] || !ctx.bloomKawaseBuffers[i]) {
      console.warn(`[RenderPipeline] Bloom mip level ${i} resource missing — bloom pass skipped.`);
      return;
    }
  }

  const thresholdBindGroup = sceneSourceView
    ? createBloomThresholdBindGroup(
        ctx.context,
        ctx.pipelines,
        ctx.linearSampler,
        sceneSourceView,
        ctx.bloomThresholdUniformBuffer,
      )
    : ctx.bindGroups.bloomThreshold;

  {
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: ctx.renderTargets.bloomAView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setViewport(0, 0, ctx.width, ctx.height, 0, 1);
    pass.setPipeline(ctx.pipelines.bloomThreshold);
    pass.setBindGroup(0, thresholdBindGroup);
    pass.draw(3);
    pass.end();
  }

  const srcViews: GPUTextureView[] = [
    ctx.renderTargets.bloomAView,
    ...ctx.renderTargets.bloomMipViews,
  ];
  const dstViews: GPUTextureView[] = ctx.renderTargets.bloomMipViews;

  for (let i = 0; i < levels; i++) {
    const mip = ctx.renderTargets.bloomMip[i];
    const kawaseBuf = ctx.bloomKawaseBuffers[i];
    if (!mip || !kawaseBuf) break;

    const bg = device.createBindGroup({
      layout: ctx.pipelines.bloomDownsample.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: kawaseBuf } },
        { binding: 1, resource: srcViews[i] },
        { binding: 2, resource: ctx.linearSampler },
      ],
    });

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: dstViews[i],
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setViewport(0, 0, mip.width, mip.height, 0, 1);
    pass.setPipeline(ctx.pipelines.bloomDownsample);
    pass.setBindGroup(0, bg);
    pass.draw(3);
    pass.end();
  }

  for (let i = levels - 1; i > 0; i--) {
    const srcMip = ctx.renderTargets.bloomMip[i];
    const dstMip = ctx.renderTargets.bloomMip[i - 1];
    const kawaseBuf = ctx.bloomKawaseBuffers[i];
    if (!srcMip || !dstMip || !kawaseBuf) break;

    const bg = device.createBindGroup({
      layout: ctx.pipelines.bloomUpsample.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: kawaseBuf } },
        { binding: 1, resource: ctx.renderTargets.bloomMipViews[i] },
        { binding: 2, resource: ctx.linearSampler },
      ],
    });

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: ctx.renderTargets.bloomMipViews[i - 1],
          loadOp: 'load',
          storeOp: 'store',
        },
      ],
    });
    pass.setViewport(0, 0, dstMip.width, dstMip.height, 0, 1);
    pass.setPipeline(ctx.pipelines.bloomUpsample);
    pass.setBindGroup(0, bg);
    pass.draw(3);
    pass.end();
  }
}
