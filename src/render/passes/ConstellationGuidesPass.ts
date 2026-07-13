import type { FrameContext } from './types.js';

export function encodeConstellationGuidesPass(
  encoder: GPUCommandEncoder,
  ctx: FrameContext,
  guides: { encodeRenderPass(pass: GPURenderPassEncoder, uniformBuffer: GPUBuffer): void } | null,
): void {
  if (!guides) return;

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
  guides.encodeRenderPass(pass, ctx.buffers.uniforms);
  pass.end();
}
