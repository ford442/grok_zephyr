/**
 * Composite pass encoder — tonemap HDR + bloom to output
 */

import { createCompositeBindGroup } from '../pipelines/BindGroupFactory.js';
import type { PassContext } from './types.js';

export function encodeCompositePass(
  encoder: GPUCommandEncoder,
  ctx: PassContext,
  outputView: GPUTextureView,
  outputWidth?: number,
  outputHeight?: number,
  sceneSourceView?: GPUTextureView,
): void {
  const compositeBindGroup = sceneSourceView
    ? createCompositeBindGroup(
        ctx.context,
        ctx.pipelines,
        ctx.buffers,
        ctx.renderTargets,
        ctx.linearSampler,
        sceneSourceView,
        ctx.bloomCompositeUniformBuffer,
        ctx.autoExposureStateBuffer!,
        ctx.tonemapUniformBuffer,
      )
    : ctx.bindGroups.composite;

  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: outputView,
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });

  const width = outputWidth || ctx.width;
  const height = outputHeight || ctx.height;
  pass.setViewport(0, 0, width, height, 0, 1);

  pass.setPipeline(ctx.pipelines.composite);
  pass.setBindGroup(0, compositeBindGroup);
  pass.draw(3);
  pass.end();
}
