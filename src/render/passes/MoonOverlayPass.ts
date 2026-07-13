import type { FrameContext } from './types.js';

export function encodeMoonOverlayPass(
  encoder: GPUCommandEncoder,
  ctx: FrameContext,
  ringGuide: {
    encodeRenderPass(pass: GPURenderPassEncoder, uniformBuffer: GPUBuffer): void;
  } | null,
): void {
  const { pipelines, bindGroups, renderTargets, width, height } = ctx;

  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: renderTargets.hdrView,
        loadOp: 'load',
        storeOp: 'store',
      },
    ],
  });

  pass.setViewport(0, 0, width, height, 0, 1);

  pass.setPipeline(pipelines.moonEarthDisk);
  pass.setBindGroup(0, bindGroups.moonEarthDisk);
  pass.draw(6);

  if (ringGuide) {
    ringGuide.encodeRenderPass(pass, ctx.buffers.uniforms);
  }

  pass.setPipeline(pipelines.moonForeground);
  pass.setBindGroup(0, bindGroups.moonForeground);
  pass.draw(6);

  pass.end();
}
