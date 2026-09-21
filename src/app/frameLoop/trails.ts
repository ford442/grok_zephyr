/**
 * Trail sampling/rendering glue for the WebGPU frame loop.
 *
 * Cinematic quality drives trails entirely on the GPU: orbital.wgsl writes a
 * tracked subset's positions into a history ring every frame, and
 * trailExpand.wgsl turns that ring into ribbon geometry — no per-frame
 * `calculateSatellitePosition` CPU sampling. Lower quality tiers (no GPU
 * trail-history buffer allocated) fall back to the CPU sampler below.
 */
import { getActiveFleetSize } from '@/core/FleetScale.js';
import type { CameraState } from '@/camera/CameraController.js';
import type { AppRuntime } from '@/app/AppRuntime.js';
import type { SatelliteFrameBuffers } from '@/core/buffer/bufferTypes.js';

function frameBuffers(rt: AppRuntime): SatelliteFrameBuffers | null {
  return rt.buffers;
}

/** True once the GPU trail-history/ribbon buffers are wired in (cinematic quality). */
export function isGpuTrailDriven(rt: AppRuntime): boolean {
  return rt.trailRenderer?.isGpuDriven() ?? false;
}

/** CPU fallback sampler for quality tiers without a GPU trail-history buffer. */
export function recordTrailSamplesForCamera(
  rt: AppRuntime,
  time: number,
  cameraState: CameraState,
): void {
  const buffers = frameBuffers(rt);
  if (!rt.trailRenderer || !buffers || !rt.trailRenderer.isEnabled()) return;

  const orbitalData = buffers.getOrbitalElementData();
  const sampleCount = rt.trailRenderer.getSamplingBudget();
  if (sampleCount <= 0) return;
  const sampleStride = Math.max(1, Math.floor(getActiveFleetSize() / sampleCount));
  const phase = rt.trailSamplePhase % sampleStride;
  rt.trailSamplePhase++;

  const position = new Float32Array(3);
  const cameraForward = new Float32Array([
    cameraState.target[0] - cameraState.position[0],
    cameraState.target[1] - cameraState.position[1],
    cameraState.target[2] - cameraState.position[2],
  ]);
  const forwardLen = Math.hypot(cameraForward[0], cameraForward[1], cameraForward[2]) || 1.0;
  cameraForward[0] /= forwardLen;
  cameraForward[1] /= forwardLen;
  cameraForward[2] /= forwardLen;
  const cameraPos = new Float32Array(cameraState.position);
  const maxDistance =
    rt.camera.getViewMode() === 'moon'
      ? 240000
      : rt.camera.getViewMode() === 'god'
        ? 140000
        : 90000;
  const visibilityDotThreshold = rt.camera.getViewMode() === 'god' ? -0.35 : -0.2;

  for (let idx = phase; idx < getActiveFleetSize(); idx += sampleStride) {
    const satPos = buffers.calculateSatellitePosition(idx, time);
    const dx = satPos[0] - cameraPos[0];
    const dy = satPos[1] - cameraPos[1];
    const dz = satPos[2] - cameraPos[2];
    const dist = Math.hypot(dx, dy, dz);
    if (dist > maxDistance) continue;
    const invDist = dist > 1e-3 ? 1.0 / dist : 0.0;
    const facing =
      (dx * cameraForward[0] + dy * cameraForward[1] + dz * cameraForward[2]) * invDist;
    if (facing < visibilityDotThreshold) continue;
    position[0] = satPos[0];
    position[1] = satPos[1];
    position[2] = satPos[2];
    const shellIndex = (orbitalData[idx * 4 + 3] >> 8) & 0xff;
    rt.trailRenderer.recordPosition(idx, position, time, shellIndex);
  }
}

/** CPU fallback ribbon builder, paired with recordTrailSamplesForCamera above. */
export function updateTrailGeometryCpu(rt: AppRuntime, simTime: number, cameraState: CameraState): void {
  if (!rt.trailRenderer) return;
  const forward = new Float32Array([
    cameraState.target[0] - cameraState.position[0],
    cameraState.target[1] - cameraState.position[1],
    cameraState.target[2] - cameraState.position[2],
  ]);
  const fLen = Math.hypot(forward[0], forward[1], forward[2]) || 1.0;
  forward[0] /= fLen;
  forward[1] /= fLen;
  forward[2] /= fLen;
  rt.trailRenderer.updateGeometry(simTime, new Float32Array(cameraState.position), forward);
}

/**
 * Ticks the GPU trail-history ring's write index and expands this frame's
 * ribbon geometry. Runs every frame once cinematic trail buffers exist, even
 * while the trails UI toggle is off, so the ring is already warm — full
 * history depth — the moment a user turns trails on.
 */
export function dispatchGpuTrailWork(rt: AppRuntime, encoder: GPUCommandEncoder): void {
  if (!rt.pipeline || !isGpuTrailDriven(rt)) return;
  rt.buffers?.tickTrailWriteIndex();
  rt.profiler.beginGPUTimestamp('trails');
  rt.pipeline.encodeTrailExpandPass(encoder);
  rt.profiler.endGPUTimestamp('trails');
}
