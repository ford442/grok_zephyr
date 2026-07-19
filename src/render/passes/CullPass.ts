/**
 * GPU satellite + beam visibility compaction pass.
 */

import { CONSTANTS, RENDER } from '@/types/constants.js';
import { MAX_BEAMS } from '../pipelines/types.js';
import type { SatelliteCullBuffers } from '../SatelliteCullBuffers.js';
import type { FrameContext } from './types.js';

export function encodeCullPass(
  encoder: GPUCommandEncoder,
  ctx: FrameContext,
  cullBuffers: SatelliteCullBuffers,
): void {
  const device = ctx.context.getDevice();
  cullBuffers.resetCounters(device);

  const pass = encoder.beginComputePass({ label: 'satellite-cull' });
  pass.setPipeline(ctx.pipelines.satelliteCullSats);
  pass.setBindGroup(0, ctx.bindGroups.satelliteCull);
  pass.dispatchWorkgroups(Math.ceil(CONSTANTS.NUM_SATELLITES / RENDER.WORKGROUP_SIZE));

  pass.setPipeline(ctx.pipelines.satelliteCullBeams);
  pass.setBindGroup(0, ctx.bindGroups.satelliteCull);
  pass.dispatchWorkgroups(Math.ceil(MAX_BEAMS / 256));

  pass.setPipeline(ctx.pipelines.satelliteCullFinalize);
  pass.setBindGroup(0, ctx.bindGroups.satelliteCull);
  pass.dispatchWorkgroups(1);

  pass.end();

  cullBuffers.scheduleVisibleCountReadback(encoder);
}
