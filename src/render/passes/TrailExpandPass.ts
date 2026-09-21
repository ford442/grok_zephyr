/**
 * GPU trail ribbon expansion — reads the history ring orbital.wgsl wrote and
 * compacts culled, camera-facing ribbon quads into the vertex/index buffers
 * TrailPass draws from. Cinematic-quality only.
 */
import { TRAIL_MAX_TRACKED_SATS } from '@/core/buffer/bufferTypes.js';
import type { FrameContext } from './types.js';
import { passTimestampWrites } from './passTimestamps.js';

export function encodeTrailExpandPass(encoder: GPUCommandEncoder, ctx: FrameContext): void {
  const device = ctx.context.getDevice();
  device.queue.writeBuffer(ctx.buffers.trail.counters, 0, new Uint32Array(2));

  const pass = encoder.beginComputePass({
    timestampWrites: passTimestampWrites(),
    label: 'trail-expand',
  });
  pass.setBindGroup(0, ctx.bindGroups.trailExpand);

  pass.setPipeline(ctx.pipelines.trailExpand);
  pass.dispatchWorkgroups(Math.ceil(TRAIL_MAX_TRACKED_SATS / 64));

  pass.setPipeline(ctx.pipelines.trailExpandFinalize);
  pass.dispatchWorkgroups(1);

  pass.end();
}
