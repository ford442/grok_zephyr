import type { Vec3, ViewMode } from '@/types/index.js';
import { v3norm } from '@/utils/math.js';
import type { CameraState } from './cameraTypes.js';

/** Smoothly maps arbitrary input to [0, 1] by clamping first, then applying smoothstep. */
export function smoothstep(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

export function blendCameraState(a: CameraState, b: CameraState, t: number): CameraState {
  return {
    position: lerpVec3(a.position, b.position, t),
    target: lerpVec3(a.target, b.target, t),
    up: v3norm(lerpVec3(a.up, b.up, t)),
    fov: a.fov + (b.fov - a.fov) * t,
    near: a.near + (b.near - a.near) * t,
    far: a.far + (b.far - a.far) * t,
  };
}

/** Return the transition duration (seconds) for a given mode pair. */
export function getTransitionDuration(from: ViewMode, to: ViewMode): number {
  if (from === 'moon' || to === 'moon') return 1.4;
  if ((from === 'sat-pov' && to === 'ground') || (from === 'ground' && to === 'sat-pov')) return 0.7;
  if ((from === 'god' && to === 'horizon-720') || (from === 'horizon-720' && to === 'god')) return 0.8;
  if ((from === 'ground' && to === 'skyline') || (from === 'skyline' && to === 'ground')) return 0.5;
  return 1.0;
}
