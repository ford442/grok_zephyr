/**
 * Compute pass encoders — orbital positions and beam compute
 */

import { CONSTANTS, RENDER } from '@/types/constants.js';
import { MAX_BEAMS } from '../pipelines/types.js';
import type { PassContext } from './types.js';

export function encodeComputePass(
  encoder: GPUCommandEncoder,
  ctx: PassContext,
): void {
  const pass = encoder.beginComputePass();
  pass.setPipeline(ctx.pipelines.compute);
  pass.setBindGroup(0, ctx.bindGroups.compute);
  pass.dispatchWorkgroups(Math.ceil(CONSTANTS.NUM_SATELLITES / RENDER.WORKGROUP_SIZE));
  pass.end();
}

export function encodeBeamComputePass(
  encoder: GPUCommandEncoder,
  ctx: PassContext,
): void {
  const pass = encoder.beginComputePass();
  pass.setPipeline(ctx.pipelines.beamCompute);
  pass.setBindGroup(0, ctx.bindGroups.beamCompute);
  pass.dispatchWorkgroups(Math.ceil(MAX_BEAMS / 256));
  pass.end();
}
