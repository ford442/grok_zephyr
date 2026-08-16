/**
 * Compute pass encoders — orbital positions and beam compute
 */

import { RENDER } from '@/types/constants.js';
import { getActiveFleetSize } from '@/core/FleetScale.js';
import { MAX_BEAMS } from '../pipelines/types.js';
import { MAX_ISL_LINKS } from '@/types/isl.js';
import type { FrameContext } from './types.js';

export function encodeComputePass(encoder: GPUCommandEncoder, ctx: FrameContext): void {
  const pass = encoder.beginComputePass();
  pass.setPipeline(ctx.pipelines.compute);
  pass.setBindGroup(0, ctx.bindGroups.compute);
  pass.dispatchWorkgroups(Math.ceil(getActiveFleetSize() / RENDER.WORKGROUP_SIZE));
  pass.end();
}

export function encodeBeamComputePass(encoder: GPUCommandEncoder, ctx: FrameContext): void {
  const pass = encoder.beginComputePass();
  pass.setPipeline(ctx.pipelines.beamCompute);
  pass.setBindGroup(0, ctx.bindGroups.beamCompute);
  pass.dispatchWorkgroups(Math.ceil(MAX_BEAMS / 256));
  pass.end();
}

export function encodeIslComputePass(encoder: GPUCommandEncoder, ctx: FrameContext): void {
  const pass = encoder.beginComputePass({ label: 'isl-topology' });
  pass.setPipeline(ctx.pipelines.islCompute);
  pass.setBindGroup(0, ctx.bindGroups.islCompute);
  pass.dispatchWorkgroups(Math.ceil(MAX_ISL_LINKS / 2 / RENDER.WORKGROUP_SIZE));
  pass.end();
}
