/**
 * Compute pass encoders — orbital positions and beam compute
 */

import { RENDER } from '@/types/constants.js';
import { getActiveFleetSize } from '@/core/FleetScale.js';
import { MAX_BEAMS } from '../pipelines/types.js';
import { MAX_ISL_LINKS } from '@/types/isl.js';
import type { FrameContext } from './types.js';
import { passTimestampWrites } from './passTimestamps.js';

export function encodeComputePass(encoder: GPUCommandEncoder, ctx: FrameContext): void {
  const pass = encoder.beginComputePass({ timestampWrites: passTimestampWrites() });
  pass.setPipeline(ctx.pipelines.compute);
  pass.setBindGroup(0, ctx.bindGroups.compute);
  pass.dispatchWorkgroups(Math.ceil(getActiveFleetSize() / RENDER.WORKGROUP_SIZE));
  pass.end();
}

export function encodeBeamComputePass(encoder: GPUCommandEncoder, ctx: FrameContext): void {
  const pass = encoder.beginComputePass({ timestampWrites: passTimestampWrites() });
  pass.setPipeline(ctx.pipelines.beamCompute);
  pass.setBindGroup(0, ctx.bindGroups.beamCompute);
  pass.dispatchWorkgroups(Math.ceil(MAX_BEAMS / 256));
  pass.end();
}

/** Light Brush: one dispatch over the fleet, writing the packed animation scratch. */
export function encodeBrushComputePass(
  encoder: GPUCommandEncoder,
  ctx: FrameContext,
  bindGroup: GPUBindGroup,
): void {
  const pass = encoder.beginComputePass({
    timestampWrites: passTimestampWrites(),
    label: 'brush-paint',
  });
  pass.setPipeline(ctx.pipelines.brushPaint);
  pass.setBindGroup(0, bindGroup);
  // brush.wgsl is @workgroup_size(256), not RENDER.WORKGROUP_SIZE.
  pass.dispatchWorkgroups(Math.ceil(getActiveFleetSize() / 256));
  pass.end();
}

export function encodeIslComputePass(encoder: GPUCommandEncoder, ctx: FrameContext): void {
  const pass = encoder.beginComputePass({
    timestampWrites: passTimestampWrites(),
    label: 'isl-topology',
  });
  pass.setPipeline(ctx.pipelines.islCompute);
  pass.setBindGroup(0, ctx.bindGroups.islCompute);
  pass.dispatchWorkgroups(Math.ceil(MAX_ISL_LINKS / 2 / RENDER.WORKGROUP_SIZE));
  pass.end();
}
