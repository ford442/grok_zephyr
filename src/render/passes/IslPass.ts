/**
 * Additive ISL fiber overlay on the HDR scene (load, not clear).
 */

import { MAX_ISL_LINKS } from '@/types/isl.js';
import type { FrameContext } from './types.js';

export function encodeIslPass(encoder: GPUCommandEncoder, ctx: FrameContext): void {
  const pass = encoder.beginRenderPass({
    label: 'isl-fibers',
    colorAttachments: [
      {
        view: ctx.renderTargets.hdrView,
        loadOp: 'load',
        storeOp: 'store',
      },
    ],
    depthStencilAttachment: {
      view: ctx.renderTargets.depthView,
      depthLoadOp: 'load',
      depthStoreOp: 'store',
    },
  });
  pass.setViewport(0, 0, ctx.width, ctx.height, 0, 1);
  pass.setPipeline(ctx.pipelines.islFiber);
  pass.setBindGroup(0, ctx.bindGroups.islFiber);
  pass.draw(4, MAX_ISL_LINKS);
  pass.end();
}
