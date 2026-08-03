/**
 * Comfort snap points for WebXR — discrete ECI poses, no continuous locomotion.
 */

import type { CameraState } from '@/camera/cameraTypes.js';
import type { CameraAngles } from '@/camera/cameraTypes.js';
import {
  calculateGodView,
  calculateGroundView,
  calculateHorizonView,
  calculateStationGroundView,
} from '@/camera/viewPoses.js';
import type { GroundStation } from '@/ground/GroundStation.js';
import { CONSTANTS, CAMERA } from '@/types/constants.js';
import { mat4inv, mat4lookAt } from '@/utils/math.js';

export type XrAnchorId = 'horizon-720' | 'geo-overview' | 'ground-station';

export const XR_ANCHOR_IDS: readonly XrAnchorId[] = [
  'horizon-720',
  'geo-overview',
  'ground-station',
] as const;

/** GEO-ish overview radius (Earth-centered, ~geostationary altitude). */
export const GEO_OVERVIEW_RADIUS_KM = 42164.0;

const DEFAULT_ANGLES: CameraAngles = { yaw: 0, pitch: 0, distance: CONSTANTS.CAMERA_RADIUS_KM };

export interface XrAnchorContext {
  groundStation: GroundStation | null;
  groundStationUtcMs: number;
}

/** Camera state for a named comfort anchor. */
export function cameraStateForAnchor(id: XrAnchorId, ctx: XrAnchorContext): CameraState {
  switch (id) {
    case 'horizon-720':
      return calculateHorizonView(DEFAULT_ANGLES, 0);
    case 'geo-overview': {
      // God-view style: sit on +X at GEO radius looking at Earth center.
      return calculateGodView(
        { yaw: 0, pitch: 15, distance: GEO_OVERVIEW_RADIUS_KM },
        0,
      );
    }
    case 'ground-station':
      return ctx.groundStation
        ? calculateStationGroundView(DEFAULT_ANGLES, ctx.groundStation, ctx.groundStationUtcMs)
        : calculateGroundView(DEFAULT_ANGLES);
    default:
      return calculateHorizonView(DEFAULT_ANGLES, 0);
  }
}

/**
 * Stage matrix: XR-local (camera space at rest) → ECI km.
 * Equals inv(lookAt) for the anchor pose (camera world matrix).
 */
export function stageMatrixFromCameraState(camera: CameraState): Float32Array {
  const view = mat4lookAt(camera.position, camera.target, camera.up);
  return mat4inv(view);
}

export function nextAnchorId(current: XrAnchorId): XrAnchorId {
  const i = XR_ANCHOR_IDS.indexOf(current);
  return XR_ANCHOR_IDS[(i + 1) % XR_ANCHOR_IDS.length];
}

export function previousAnchorId(current: XrAnchorId): XrAnchorId {
  const i = XR_ANCHOR_IDS.indexOf(current);
  return XR_ANCHOR_IDS[(i - 1 + XR_ANCHOR_IDS.length) % XR_ANCHOR_IDS.length];
}

/** Default near/far for orbital XR projection rebuild (km). */
export const XR_NEAR_KM = 1.0;
export const XR_FAR_KM = CAMERA.FAR_PLANE;
