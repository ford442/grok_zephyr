/**
 * CPU mirror of GPU satellite visibility tests (for unit tests).
 */

import { CONSTANTS, CULLING } from '@/types/constants.js';

const MOON_BILLBOARD_SCALE = 750;
const SHELL_SIZE_SCALE = [0.8, 1.0, 1.3] as const;

export function shellSizeScale(shell: number): number {
  return SHELL_SIZE_SCALE[Math.min(2, shell)] ?? 1.0;
}

export function billboardRadiusKm(
  dist: number,
  shellIdx: number,
  viewMode: number,
  isGroundView: boolean,
): number {
  const groundScale = isGroundView ? 0.72 : 1.0;
  const isMoonView = (viewMode & 0xffff) === 4;
  const moonScale = isMoonView ? MOON_BILLBOARD_SCALE : 1.0;
  const shellSize = shellSizeScale(shellIdx);
  return Math.min(60, Math.max(0.4, (1200 / Math.max(dist, 50)) * moonScale * shellSize * groundScale));
}

export function sphereInFrustum(
  center: readonly [number, number, number],
  radius: number,
  frustum: readonly Float32Array[],
): boolean {
  for (let p = 0; p < 6; p++) {
    const plane = frustum[p];
    const d = plane[0] * center[0] + plane[1] * center[1] + plane[2] * center[2] + plane[3];
    if (d < -radius) return false;
  }
  return true;
}

export function isAboveHorizon(
  satPos: readonly [number, number, number],
  observerPos: readonly [number, number, number],
  earthRadius = CONSTANTS.EARTH_RADIUS_KM,
): boolean {
  const dx = satPos[0] - observerPos[0];
  const dy = satPos[1] - observerPos[1];
  const dz = satPos[2] - observerPos[2];
  const satDist = Math.hypot(dx, dy, dz);
  if (satDist < 1e-3) return false;

  const inv = 1 / satDist;
  const d0 = dx * inv;
  const d1 = dy * inv;
  const d2 = dz * inv;

  const b = observerPos[0] * d0 + observerPos[1] * d1 + observerPos[2] * d2;
  const c =
    observerPos[0] * observerPos[0] +
    observerPos[1] * observerPos[1] +
    observerPos[2] * observerPos[2] -
    earthRadius * earthRadius;
  const disc = b * b - c;
  if (disc < 0) return true;

  const t = -b - Math.sqrt(disc);
  return t < 0 || t > satDist;
}

export function needsHorizonCull(viewMode: number, isGroundView: boolean): boolean {
  return isGroundView || (viewMode & 0xffff) === 5;
}

export interface SatelliteCullInput {
  satIdx: number;
  satPos: readonly [number, number, number];
  cameraPos: readonly [number, number, number];
  viewMode: number;
  isGroundView: boolean;
  distanceCullKm: number;
  frustum: readonly Float32Array[];
  selectedSatellite: number;
}

export function isSatelliteVisibleCpu(input: SatelliteCullInput): boolean {
  if (input.selectedSatellite >= 0 && input.satIdx === input.selectedSatellite) {
    return true;
  }

  const wp = input.satPos;
  const cam = input.cameraPos;
  const dx = wp[0] - cam[0];
  const dy = wp[1] - cam[1];
  const dz = wp[2] - cam[2];
  const dist = Math.hypot(dx, dy, dz);
  const maxVisibleDist = Math.max(input.distanceCullKm, 1000);
  if (dist >= maxVisibleDist) return false;

  const shellIdx = Math.floor(input.satIdx / 349525);
  const radius = billboardRadiusKm(dist, shellIdx, input.viewMode, input.isGroundView) + CULLING.FRUSTUM_MARGIN;
  if (!sphereInFrustum(wp, radius, input.frustum)) return false;

  if (needsHorizonCull(input.viewMode, input.isGroundView) && !isAboveHorizon(wp, cam)) {
    return false;
  }

  return true;
}
