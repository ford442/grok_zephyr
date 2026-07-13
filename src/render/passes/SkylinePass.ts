import type { FrameContext } from './types.js';

export function encodeSkylinePass(
  encoder: GPUCommandEncoder,
  ctx: FrameContext,
  buildingCount: number,
): void {
  if (!ctx.skylineBindGroup) return;

  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: ctx.renderTargets.hdrView,
        loadOp: 'load',
        storeOp: 'store',
      },
    ],
    depthStencilAttachment: {
      view: ctx.renderTargets.depthView,
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  });

  pass.setViewport(0, 0, ctx.width, ctx.height, 0, 1);
  pass.setPipeline(ctx.pipelines.skyline);
  pass.setBindGroup(0, ctx.skylineBindGroup);
  pass.draw(36, buildingCount);
  pass.end();
}
