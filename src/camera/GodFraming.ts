/**
 * God View hero pose, idle orbit, and zoom-dependent bloom helpers.
 */

import type { ImageTuningSettings } from '@/core/ImageTuning.js';
import { CAMERA } from '@/types/constants.js';

/** Default hero pose — 53° shell edge-on with RAAN fan visible. */
export const GOD_FRAMING = {
  HERO_YAW_DEG: 48,
  HERO_PITCH_DEG: 22,
  HERO_DISTANCE_KM: CAMERA.GOD_VIEW_DISTANCE,
  /** Idle yaw orbit when user is not interacting (deg/s). */
  IDLE_YAW_DEG_PER_SEC: 0.015,
  /** Seconds after interaction before idle orbit resumes. */
  IDLE_PAUSE_SEC: 3.0,
  /** God-only distance LOD bands (km). */
  LOD_NEAR_KM: 15_000,
  LOD_MID_KM: 40_000,
  LOD_NEAR_BLEND_KM: 2500,
  LOD_MID_BLEND_KM: 4000,
  /** Zoom-out bloom threshold scale (raised when far to resist soup). */
  ZOOM_BLOOM_THRESHOLD_MIN: 0.94,
  ZOOM_BLOOM_THRESHOLD_MAX: 1.14,
  ZOOM_NEAR_KM: CAMERA.GOD_VIEW_MIN_DISTANCE,
  ZOOM_FAR_KM: CAMERA.GOD_VIEW_MAX_DISTANCE,
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / Math.max(edge1 - edge0, 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Bloom threshold multiplier from God View camera distance. */
export function godZoomBloomThresholdScale(cameraDistanceKm: number): number {
  const t = smoothstep(GOD_FRAMING.ZOOM_NEAR_KM, GOD_FRAMING.ZOOM_FAR_KM, cameraDistanceKm);
  return (
    GOD_FRAMING.ZOOM_BLOOM_THRESHOLD_MIN +
    (GOD_FRAMING.ZOOM_BLOOM_THRESHOLD_MAX - GOD_FRAMING.ZOOM_BLOOM_THRESHOLD_MIN) * t
  );
}

/** Apply zoom-dependent bloom threshold on top of the God View tuning profile. */
export function applyGodZoomBloomTuning(
  base: ImageTuningSettings,
  cameraDistanceKm: number,
): ImageTuningSettings {
  const scale = godZoomBloomThresholdScale(cameraDistanceKm);
  return {
    ...base,
    bloomThreshold: clamp(base.bloomThreshold * scale, 0.5, 3.0),
  };
}
