import type { FrameContext } from './types.js';

export function encodeTrailPass(
  encoder: GPUCommandEncoder,
  ctx: FrameContext,
  trailRenderer: {
    encodeRenderPass(pass: GPURenderPassEncoder, uniformBuffer: GPUBuffer): void;
  } | null,
): void {
  if (!trailRenderer) return;

  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: ctx.renderTargets.hdrView,
        loadOp: 'load',
        storeOp: 'store',
      },
    ],
  });

  pass.setViewport(0, 0, ctx.width, ctx.height, 0, 1);
  trailRenderer.encodeRenderPass(pass, ctx.buffers.uniforms);
  pass.end();
}
