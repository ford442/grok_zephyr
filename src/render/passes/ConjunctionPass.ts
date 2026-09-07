/**
 * Close-approach passes — hash bin + pair search, then the warning overlay.
 *
 * Nothing here is encoded when the feature is off: FrameLoop skips the calls
 * entirely, so a disabled feature costs zero dispatches and zero bound
 * resources rather than an empty pass per frame.
 */

import { MAX_CONJUNCTION_PAIRS } from '@/types/conjunction.js';
import type { ConjunctionBufferSet } from '../ConjunctionBuffers.js';
import type { FrameContext } from './types.js';

const WORKGROUP_SIZE = 256;

export function encodeConjunctionComputePass(
  encoder: GPUCommandEncoder,
  ctx: FrameContext,
  set: ConjunctionBufferSet,
  bindGroup: GPUBindGroup,
): void {
  const pass = encoder.beginComputePass({ label: 'conjunction' });
  pass.setBindGroup(0, bindGroup);

  // Clear covers the bucket table; the counters are reset by invocation 0.
  pass.setPipeline(ctx.pipelines.conjunctionClear);
  pass.dispatchWorkgroups(Math.ceil(set.buckets / WORKGROUP_SIZE));

  // Binning must complete before the neighbour walk reads the table. Separate
  // dispatches in one pass are ordered, so no explicit barrier is needed.
  pass.setPipeline(ctx.pipelines.conjunctionBin);
  pass.dispatchWorkgroups(Math.ceil(set.scanCount / WORKGROUP_SIZE));

  pass.setPipeline(ctx.pipelines.conjunctionPairs);
  pass.dispatchWorkgroups(Math.ceil(set.scanCount / WORKGROUP_SIZE));

  pass.end();
}

export function encodeConjunctionDensityPass(
  encoder: GPUCommandEncoder,
  ctx: FrameContext,
  set: ConjunctionBufferSet,
  bindGroup: GPUBindGroup,
): void {
  const pass = encoder.beginRenderPass({
    label: 'conjunction-density',
    colorAttachments: [{ view: ctx.renderTargets.hdrView, loadOp: 'load', storeOp: 'store' }],
    depthStencilAttachment: {
      view: ctx.renderTargets.depthView,
      depthLoadOp: 'load',
      depthStoreOp: 'store',
    },
  });
  pass.setViewport(0, 0, ctx.width, ctx.height, 0, 1);
  pass.setPipeline(ctx.pipelines.conjunctionDensity);
  pass.setBindGroup(0, bindGroup);
  // One instance per bucket; empty buckets collapse in the vertex shader.
  pass.draw(4, set.buckets);
  pass.end();
}

export function encodeConjunctionPass(
  encoder: GPUCommandEncoder,
  ctx: FrameContext,
  bindGroup: GPUBindGroup,
): void {
  const pass = encoder.beginRenderPass({
    label: 'conjunction-markers',
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
  pass.setPipeline(ctx.pipelines.conjunctionDraw);
  pass.setBindGroup(0, bindGroup);
  // Fixed instance count; the vertex shader collapses instances past the live
  // pair count, which avoids a second indirect-args buffer for 4096 markers.
  pass.draw(4, MAX_CONJUNCTION_PAIRS);
  pass.end();
}
