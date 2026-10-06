/**
 * Composite pass encoder — tonemap HDR + bloom to output
 */

import { createCompositeBindGroup } from '../pipelines/BindGroupFactory.js';
import type { FrameContext } from './types.js';
import { passTimestampWrites } from './passTimestamps.js';

/** XR / sub-viewport target: draw into a rectangle of a larger attachment. */
export interface CompositeTargetOptions {
  /** Pipeline for a non-swapchain colour format (XR projection layer). */
  pipeline?: GPURenderPipeline;
  viewportX?: number;
  viewportY?: number;
  /**
   * Keep what is outside the viewport (side-by-side eye layouts share one
   * texture). Scissors to the viewport and loads instead of clearing.
   */
  preserveOutside?: boolean;
}

export function encodeCompositePass(
  encoder: GPUCommandEncoder,
  ctx: FrameContext,
  outputView: GPUTextureView,
  outputWidth?: number,
  outputHeight?: number,
  sceneSourceView?: GPUTextureView,
  target: CompositeTargetOptions = {},
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
    timestampWrites: passTimestampWrites(),
    colorAttachments: [
      {
        view: outputView,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: target.preserveOutside ? 'load' : 'clear',
        storeOp: 'store',
      },
    ],
  });

  const width = outputWidth || ctx.width;
  const height = outputHeight || ctx.height;
  const x = target.viewportX ?? 0;
  const y = target.viewportY ?? 0;
  pass.setViewport(x, y, width, height, 0, 1);
  if (target.preserveOutside) {
    pass.setScissorRect(x, y, width, height);
  }

  pass.setPipeline(target.pipeline ?? ctx.pipelines.composite);
  pass.setBindGroup(0, compositeBindGroup);
  pass.draw(3);
  pass.end();
}
