import { CONSTANTS } from '@/types/constants.js';
import type { TrailConfig } from '@/types/animation.js';
import { QUALITY_PRESETS, type QualityLevel } from '@/core/QualityPresets.js';
import type { AppRuntime } from '@/app/AppRuntime.js';

/**
 * Performance timing estimation constants (milliseconds)
 *
 * These values are used to provide realistic timing breakdowns when GPU timestamp
 * queries are unavailable or not supported by the device.
 */
export const TIMING_ESTIMATES = {
  BASE_COMPUTE: 1.5,
  BASE_SCENE: 3.0,
  BASE_BLOOM: 2.0,
  BASE_POST: 1.5,
  COMPUTE_NO_TRAIL_MULT: 1.0,
  COMPUTE_TRAIL_MULT: 1.2,
  SCENE_ATMOSPHERE_MULT: 1.3,
  BLOOM_DISABLED: 0.5,
  POST_DISABLED: 0.5,
};

export function getEffectiveTrailConfig(rt: AppRuntime, level: QualityLevel): TrailConfig {
  const base = QUALITY_PRESETS[level].trail;
  const lengthScale =
    rt.trailLengthMode === 'short' ? 0.55 : rt.trailLengthMode === 'long' ? 1.65 : 1.0;
  const enabled = rt.trailToggleOverride ?? base.enabled;
  return {
    enabled,
    maxLength: Math.max(8, Math.round(base.maxLength * lengthScale)),
    fadeOut: Math.max(8, Math.round(base.fadeOut * lengthScale)),
    colorByShell: true,
    ribbonWidth: Math.max(2.5, base.ribbonWidth * (rt.trailLengthMode === 'long' ? 1.12 : 1.0)),
  };
}

export function recordPassTimings(rt: AppRuntime): void {
  const preset = QUALITY_PRESETS[rt.simulation.currentQualityLevel];
  const effectiveTrail = getEffectiveTrailConfig(rt, rt.simulation.currentQualityLevel);

  const computeMultiplier = effectiveTrail.enabled
    ? TIMING_ESTIMATES.COMPUTE_TRAIL_MULT
    : TIMING_ESTIMATES.COMPUTE_NO_TRAIL_MULT;
  const computeTime = TIMING_ESTIMATES.BASE_COMPUTE * computeMultiplier;
  const sceneMultiplier = preset.atmosphere.enabled ? TIMING_ESTIMATES.SCENE_ATMOSPHERE_MULT : 1.0;
  const sceneTime = TIMING_ESTIMATES.BASE_SCENE * sceneMultiplier;
  const bloomTime = effectiveTrail.enabled
    ? TIMING_ESTIMATES.BASE_BLOOM
    : TIMING_ESTIMATES.BLOOM_DISABLED;
  const postProcessTime = rt.postProcessStack
    ? TIMING_ESTIMATES.BASE_POST
    : TIMING_ESTIMATES.POST_DISABLED;

  rt.profiler.recordComputeTime(computeTime);
  rt.profiler.recordSceneTime(sceneTime);
  rt.profiler.recordBloomTime(bloomTime);
  rt.profiler.recordPostProcessTime(postProcessTime);
}

export function estimateVisibleSatellites(rt: AppRuntime): number {
  const mode = rt.camera.getViewModeIndex();
  if (mode === 0) {
    return Math.floor(CONSTANTS.NUM_SATELLITES * 0.12);
  }
  if (mode === 2) {
    return Math.floor(CONSTANTS.NUM_SATELLITES * 0.001);
  }
  if (mode === 3) {
    return Math.floor(CONSTANTS.NUM_SATELLITES * 0.15);
  }
  if (mode === 4) {
    return Math.floor(CONSTANTS.NUM_SATELLITES * 0.45);
  }
  return Math.floor(CONSTANTS.NUM_SATELLITES * 0.25);
}
