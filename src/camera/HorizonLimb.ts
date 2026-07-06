/**
 * Earth limb projection + 720 km Horizon framing constants.
 */

import type { Vec3 } from '@/types/index.js';
import { CONSTANTS } from '@/types/constants.js';
import { v3dot, v3sub } from '@/utils/math.js';

/** Flagship Horizon framing — limb on lower third, constellation in upper two-thirds. */
export const HORIZON_FRAMING = {
  /** Added to user pitch (deg); negative tilts toward Earth limb. */
  BASE_PITCH_DEG: -24,
  /** Base upward look component (km) before user pitch. */
  BASE_UPWARD_LOOK_KM: 2200,
  /** Tangential look distance (km) along orbital track. */
  TANGENTIAL_LOOK_KM: 480,
  /** Subtle cinematic roll (deg). */
  ROLL_DEG: 0.85,
  /** Idle yaw drift when user is not interacting (deg/s). */
  DRIFT_YAW_DEG_PER_SEC: 0.02,
  /** Seconds after interaction before drift resumes. */
  DRIFT_IDLE_SEC: 3.0,
  /** Target limb screen position (fraction from top, rule-of-thirds). */
  LIMB_TARGET_SCREEN_Y: 2 / 3,
} as const;

/** Project a world point to NDC. Returns null when behind the camera. */
export function projectWorldToNdc(
  world: Vec3,
  viewProj: Float32Array,
): [number, number, number] | null {
  const [x, y, z] = world;
  const clipW =
    viewProj[3] * x + viewProj[7] * y + viewProj[11] * z + viewProj[15];
  if (clipW <= 1e-6) return null;
  const invW = 1 / clipW;
  return [
    (viewProj[0] * x + viewProj[4] * y + viewProj[8] * z + viewProj[12]) * invW,
    (viewProj[1] * x + viewProj[5] * y + viewProj[9] * z + viewProj[13]) * invW,
    (viewProj[2] * x + viewProj[6] * y + viewProj[10] * z + viewProj[14]) * invW,
  ];
}

/** NDC y → screen Y in pixels (0 = top, increases downward). */
export function ndcYToScreenY(ndcY: number, screenHeight: number): number {
  return (ndcY + 1) * 0.5 * screenHeight;
}

/**
 * Screen Y (pixels, 0 = top) of the upper Earth limb (top of the visible disk).
 * Returns null when Earth is off-screen.
 */
export function computeEarthLimbScreenY(
  viewProj: Float32Array,
  cameraPos: Vec3,
  screenHeight: number,
  earthRadius = CONSTANTS.EARTH_RADIUS_KM,
  earthCenter: Vec3 = [0, 0, 0],
): number | null {
  let bestNdcY = Infinity;
  const thetaSteps = 72;
  const phiSteps = 36;

  for (let ti = 0; ti < thetaSteps; ti++) {
    const theta = (ti / thetaSteps) * Math.PI * 2;
    for (let pi = 0; pi < phiSteps; pi++) {
      const phi = (pi / phiSteps) * Math.PI;
      const surf: Vec3 = [
        earthCenter[0] + earthRadius * Math.sin(phi) * Math.cos(theta),
        earthCenter[1] + earthRadius * Math.sin(phi) * Math.sin(theta),
        earthCenter[2] + earthRadius * Math.cos(phi),
      ];
      const outward = v3sub(surf, earthCenter);
      const toCam = v3sub(cameraPos, surf);
      if (v3dot(outward, toCam) <= 0) continue;

      const ndc = projectWorldToNdc(surf, viewProj);
      if (!ndc || ndc[2] < 0 || ndc[2] > 1) continue;
      if (ndc[0] < -1.05 || ndc[0] > 1.05) continue;
      if (ndc[1] < -1.05 || ndc[1] > 1.05) continue;
      if (ndc[1] < bestNdcY) bestNdcY = ndc[1];
    }
  }

  if (!Number.isFinite(bestNdcY)) return null;
  return ndcYToScreenY(bestNdcY, screenHeight);
}

/** Normalized screen Y (0 = top, 1 = bottom) for HUD placement. */
export function computeEarthLimbScreenYNormalized(
  viewProj: Float32Array,
  cameraPos: Vec3,
  screenHeight: number,
): number | null {
  const y = computeEarthLimbScreenY(viewProj, cameraPos, screenHeight);
  if (y === null || screenHeight <= 0) return null;
  return y / screenHeight;
}

/** Brightest limb point in 0–1 UV for lens flare / anamorphic anchoring. */
export function computeEarthLimbScreenUv(
  viewProj: Float32Array,
  cameraPos: Vec3,
  earthRadius = CONSTANTS.EARTH_RADIUS_KM,
  earthCenter: Vec3 = [0, 0, 0],
): [number, number] | null {
  let bestNdc: [number, number] | null = null;
  let bestNdcY = Infinity;
  const thetaSteps = 72;
  const phiSteps = 36;

  for (let ti = 0; ti < thetaSteps; ti++) {
    const theta = (ti / thetaSteps) * Math.PI * 2;
    for (let pi = 0; pi < phiSteps; pi++) {
      const phi = (pi / phiSteps) * Math.PI;
      const surf: Vec3 = [
        earthCenter[0] + earthRadius * Math.sin(phi) * Math.cos(theta),
        earthCenter[1] + earthRadius * Math.sin(phi) * Math.sin(theta),
        earthCenter[2] + earthRadius * Math.cos(phi),
      ];
      const outward = v3sub(surf, earthCenter);
      const toCam = v3sub(cameraPos, surf);
      if (v3dot(outward, toCam) <= 0) continue;

      const ndc = projectWorldToNdc(surf, viewProj);
      if (!ndc || ndc[2] < 0 || ndc[2] > 1) continue;
      if (ndc[1] < -1.05 || ndc[1] > 1.05) continue;
      if (ndc[1] < bestNdcY) {
        bestNdcY = ndc[1];
        bestNdc = [ndc[0], ndc[1]];
      }
    }
  }

  if (!bestNdc) return null;
  return [(bestNdc[0] + 1) * 0.5, (bestNdc[1] + 1) * 0.5];
}
