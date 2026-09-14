/**
 * GPU pass timestamp scope.
 *
 * Shipping WebGPU only records timestamps through `timestampWrites` on
 * `beginComputePass` / `beginRenderPass`. The frame loop opens a named scope on
 * the profiler; every pass encoder below asks for its write indices here so a
 * scope covering several (or conditionally skipped) passes is summed on readback.
 * Returns `undefined` when `timestamp-query` is unavailable or no scope is open.
 */

export type PassTimestampWrites = GPUComputePassTimestampWrites & GPURenderPassTimestampWrites;

type Allocator = () => PassTimestampWrites | undefined;

let activeAllocator: Allocator | null = null;

export function setPassTimestampScope(allocator: Allocator | null): void {
  activeAllocator = allocator;
}

export function passTimestampWrites(): PassTimestampWrites | undefined {
  return activeAllocator?.();
}
