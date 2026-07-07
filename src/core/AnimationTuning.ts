/**
 * Per-view animation brightness tuning and documented HDR luminance targets.
 *
 * Animation patterns (SMILE, DIGITAL RAIN, HEARTBEAT) drive satellite colors in
 * the vertex shader. View-mode profiles scale intensity/contrast so patterns stay
 * readable after the sharp point-kernel recalibration (#81).
 */

import type { ViewTuningProfile } from '@/core/ViewTuningProfile.js';

/** Animation pattern IDs — matches patternParams.pattern_mode in satellites.ts */
export type AnimationPatternId = 'smile' | 'digital_rain' | 'heartbeat';

/** Documented target mean HDR luminance at billboard core (pre-tonemap). */
export interface AnimationLuminanceTarget {
  /** View mode index 0–5 */
  viewModeIndex: number;
  viewName: string;
  pattern: AnimationPatternId;
  /** Target mean luminance for hero/feature pixels (HDR, ~1.5–2.8) */
  featureLuminance: number;
  /** Target mean luminance for background tier pixels (HDR, ~0.8–1.4) */
  backgroundLuminance: number;
  notes: string;
}

/**
 * Shipping luminance targets per pattern per view mode.
 * Used in unit-test annotations and visual regression documentation.
 *
 * Effective HDR ≈ tier × strength × animationIntensity × (1 + coreBoost) at core.
 */
export const ANIMATION_LUMINANCE_TARGETS: readonly AnimationLuminanceTarget[] = [
  // SMILE — face outline readable at Ground; reduced halo in God
  { viewModeIndex: 0, viewName: 'Horizon', pattern: 'smile', featureLuminance: 2.2, backgroundLuminance: 1.0, notes: 'Balanced emerge/glow phases' },
  { viewModeIndex: 1, viewName: 'God', pattern: 'smile', featureLuminance: 1.9, backgroundLuminance: 0.85, notes: 'Tight kernel + higher contrast resists bloom soup' },
  { viewModeIndex: 2, viewName: 'Fleet POV', pattern: 'smile', featureLuminance: 1.7, backgroundLuminance: 0.80, notes: 'Micro billboards; restrained hero tier' },
  { viewModeIndex: 3, viewName: 'Ground', pattern: 'smile', featureLuminance: 2.5, backgroundLuminance: 1.15, notes: 'Boosted intensity for sparse visible sats' },
  { viewModeIndex: 4, viewName: 'Moon', pattern: 'smile', featureLuminance: 2.4, backgroundLuminance: 1.05, notes: 'Distance attenuation compensated by profile' },
  { viewModeIndex: 5, viewName: 'Skyline', pattern: 'smile', featureLuminance: 2.1, backgroundLuminance: 0.95, notes: 'Moderate vs city window emissives' },

  // DIGITAL RAIN — Moon faint columns, Horizon medium
  { viewModeIndex: 0, viewName: 'Horizon', pattern: 'digital_rain', featureLuminance: 2.0, backgroundLuminance: 0.95, notes: 'Medium column brightness' },
  { viewModeIndex: 1, viewName: 'God', pattern: 'digital_rain', featureLuminance: 1.75, backgroundLuminance: 0.82, notes: 'Reduced trail bleed in clutter' },
  { viewModeIndex: 2, viewName: 'Fleet POV', pattern: 'digital_rain', featureLuminance: 1.65, backgroundLuminance: 0.78, notes: 'High bloom threshold headroom' },
  { viewModeIndex: 3, viewName: 'Ground', pattern: 'digital_rain', featureLuminance: 2.1, backgroundLuminance: 1.0, notes: 'Sparse sky — columns pop' },
  { viewModeIndex: 4, viewName: 'Moon', pattern: 'digital_rain', featureLuminance: 1.5, backgroundLuminance: 0.72, notes: 'Faint columns against earthshine' },
  { viewModeIndex: 5, viewName: 'Skyline', pattern: 'digital_rain', featureLuminance: 1.85, backgroundLuminance: 0.88, notes: 'Background rain behind city glow' },

  // HEARTBEAT — diastole visible under high bloom threshold (Fleet/God)
  { viewModeIndex: 0, viewName: 'Horizon', pattern: 'heartbeat', featureLuminance: 2.1, backgroundLuminance: 0.95, notes: 'Dual-beat pulse readable' },
  { viewModeIndex: 1, viewName: 'God', pattern: 'heartbeat', featureLuminance: 1.8, backgroundLuminance: 0.88, notes: 'Low contrast gamma lifts diastole floor' },
  { viewModeIndex: 2, viewName: 'Fleet POV', pattern: 'heartbeat', featureLuminance: 1.7, backgroundLuminance: 0.90, notes: 'Diastole floor preserved at bloom 1.65' },
  { viewModeIndex: 3, viewName: 'Ground', pattern: 'heartbeat', featureLuminance: 2.3, backgroundLuminance: 1.05, notes: 'Sparse constellation pulse' },
  { viewModeIndex: 4, viewName: 'Moon', pattern: 'heartbeat', featureLuminance: 2.0, backgroundLuminance: 0.92, notes: 'Ring-wide wave visible' },
  { viewModeIndex: 5, viewName: 'Skyline', pattern: 'heartbeat', featureLuminance: 1.95, backgroundLuminance: 0.90, notes: 'Moderate pulse vs emissives' },
] as const;

export const ANIMATION_MASTER_INTENSITY_DEFAULT = 1.0;
export const ANIMATION_MASTER_INTENSITY_MIN = 0.25;
export const ANIMATION_MASTER_INTENSITY_MAX = 2.0;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Combine per-view profile animation tuning with the dev master-intensity slider. */
export function resolveEffectiveAnimationTuning(
  profile: Pick<ViewTuningProfile, 'animationIntensity' | 'animationContrast'>,
  masterIntensity = ANIMATION_MASTER_INTENSITY_DEFAULT,
): { animationIntensity: number; animationContrast: number } {
  const master = clamp(
    masterIntensity,
    ANIMATION_MASTER_INTENSITY_MIN,
    ANIMATION_MASTER_INTENSITY_MAX,
  );
  return {
    animationIntensity: clamp(profile.animationIntensity * master, 0.25, 2.5),
    animationContrast: clamp(profile.animationContrast, 0.5, 1.5),
  };
}

/** Format luminance targets for test annotations. */
export function formatLuminanceTargetAnnotation(
  viewModeIndex: number,
  pattern: AnimationPatternId,
): string {
  const t = ANIMATION_LUMINANCE_TARGETS.find(
    (e) => e.viewModeIndex === viewModeIndex && e.pattern === pattern,
  );
  if (!t) return `${pattern} @ mode ${viewModeIndex}: no target`;
  return (
    `${t.pattern} ${t.viewName}: feature≈${t.featureLuminance.toFixed(1)} HDR, ` +
    `bg≈${t.backgroundLuminance.toFixed(2)} HDR — ${t.notes}`
  );
}
