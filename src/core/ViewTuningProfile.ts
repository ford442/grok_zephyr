/**
 * Per-view-mode image tuning profiles.
 *
 * Each camera mode has different visible satellite density and dynamic range.
 * Profiles are blended smoothly during mode transitions so bloom/saturation
 * does not flash when switching views.
 */

import { CULLING } from '@/types/constants.js';
import type { ImageTuningSettings } from '@/core/ImageTuning.js';
import {
  ANIMATION_MASTER_INTENSITY_DEFAULT,
  resolveEffectiveAnimationTuning,
} from '@/core/AnimationTuning.js';
import { SHIPPING_IMAGE_TUNING } from '@/core/ImageTuning.js';

/** Bloom + satellite kernel + cull distances keyed by view_mode (0–5). */
export interface ViewTuningProfile {
  /** View mode index — matches VIEW_MODES / CameraController.modeIndex */
  viewModeIndex: number;
  /** Short HUD label */
  shortName: string;
  /** Documented tuning rationale (shown in dev docs / tests) */
  rationale: string;
  bloomThreshold: number;
  bloomKnee: number;
  bloomIntensity: number;
  satCoreOuter: number;
  satCoreInner: number;
  haloStrength: number;
  coreBoost: number;
  distanceCullKm: number;
  /** Animation pattern amplitude multiplier (0.5–1.6) — blended on view transitions */
  animationIntensity: number;
  /** Animation contrast / gamma (>1 crushes lows, <1 lifts diastole floor) */
  animationContrast: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/**
 * Shipping per-view profiles (#73).
 *
 * Rationale summary:
 * - Horizon 720km: balanced — Earth limb is bright but constellation fills mid-frame.
 * - God View: maximum clutter; tight kernel + higher threshold prevents bloom soup.
 * - Fleet POV: micro billboards + motion stretch; very tight kernel, high threshold.
 * - Ground View: few sats, bright limb; restrained bloom keeps stars distinct.
 * - Moon View: extreme range; softer kernel + lower threshold for ring visibility.
 * - Skyline: night-city emissives in foreground; moderate bloom extracts window glow
 *   without soup while background constellation stays restrained.
 */
export const VIEW_TUNING_PROFILES: readonly ViewTuningProfile[] = [
  {
    viewModeIndex: 0,
    shortName: 'Horizon',
    rationale:
      '720 km flagship establishing shot: Earth limb on the lower third, constellation ' +
      'in the upper two-thirds. Slightly elevated bloom threshold + warm post grade keep ' +
      'stars distinct above limb glow.',
    bloomThreshold: 1.48,
    bloomKnee: 0.05,
    bloomIntensity: 2.05,
    satCoreOuter: 0.38,
    satCoreInner: 0.11,
    haloStrength: 0.18,
    coreBoost: 2.4,
    distanceCullKm: CULLING.MAX_DISTANCE,
    animationIntensity: 1.0,
    animationContrast: 1.0,
  },
  {
    viewModeIndex: 1,
    shortName: 'God',
    rationale:
      'Maximum orbital clutter at ~25k km. Hero pose showcases the 53° shell edge-on; ' +
      'God-only LOD bands (15k / 40k) + zoom-dependent bloom keep shells readable without soup.',
    bloomThreshold: 1.58,
    bloomKnee: 0.04,
    bloomIntensity: 2.3,
    satCoreOuter: 0.36,
    satCoreInner: 0.08,
    haloStrength: 0.15,
    coreBoost: 2.5,
    distanceCullKm: CULLING.MAX_DISTANCE,
    animationIntensity: 0.80,
    animationContrast: 1.15,
  },
  {
    viewModeIndex: 2,
    shortName: 'Fleet POV',
    rationale:
      'First-person micro-scale billboards with motion-blur stretch trails. ' +
      'Very tight core, low halo, elevated bloom threshold, Fleet near-field LOD (<50 km), ' +
      'and velocity-aligned stretch keep neighbors distinguishable at 1× time scale.',
    bloomThreshold: 1.65,
    bloomKnee: 0.04,
    bloomIntensity: 1.85,
    satCoreOuter: 0.34,
    satCoreInner: 0.06,
    haloStrength: 0.10,
    coreBoost: 2.2,
    distanceCullKm: 80_000,
    animationIntensity: 0.72,
    animationContrast: 0.82,
  },
  {
    viewModeIndex: 3,
    shortName: 'Ground',
    rationale:
      'Surface observer: few visible satellites against a bright Earth limb. ' +
      'Higher bloom threshold and lower composite intensity keep the limb from ' +
      'blowing out; slightly softer kernel separates star-like points.',
    bloomThreshold: 1.75,
    bloomKnee: 0.06,
    bloomIntensity: 1.70,
    satCoreOuter: 0.42,
    satCoreInner: 0.12,
    haloStrength: 0.22,
    coreBoost: 2.3,
    distanceCullKm: 120_000,
    animationIntensity: 1.38,
    animationContrast: 1.08,
  },
  {
    viewModeIndex: 4,
    shortName: 'Moon',
    rationale:
      '384,400 km lunar vista: Earth blue marble at ~1.9° with earthshine, star ' +
      'dimming near the disk, regolith foreground, and ring emphasis. Lower threshold ' +
      'and moderate bloom extract the constellation halo against Earth limb glow.',
    bloomThreshold: 1.35,
    bloomKnee: 0.07,
    bloomIntensity: 2.1,
    satCoreOuter: 0.44,
    satCoreInner: 0.14,
    haloStrength: 0.28,
    coreBoost: 2.6,
    distanceCullKm: 500_000,
    animationIntensity: 1.55,
    animationContrast: 0.90,
  },
  {
    viewModeIndex: 5,
    shortName: 'Skyline',
    rationale:
      'Surface night-city vantage: HDR window cores (>2.0) in the near field bloom ' +
      'into cohesive city glow halos with the constellation as background. Bloom ' +
      'threshold sits below Ground View; coreBoost scales per-floor emissive output.',
    bloomThreshold: 1.62,
    bloomKnee: 0.055,
    bloomIntensity: 1.88,
    satCoreOuter: 0.40,
    satCoreInner: 0.11,
    haloStrength: 0.20,
    coreBoost: 2.55,
    distanceCullKm: 100_000,
    animationIntensity: 1.12,
    animationContrast: 1.0,
  },
] as const;

/** Reference coreBoost used to normalize skyline window emissive scale (Horizon baseline). */
export const SKYLINE_EMISSIVE_CORE_REF = 2.4;

const PROFILE_BY_INDEX = new Map(
  VIEW_TUNING_PROFILES.map((p) => [p.viewModeIndex, p] as const),
);

const MAX_VIEW_MODE_INDEX = VIEW_TUNING_PROFILES.length - 1;

/** Lookup profile for a view mode index (clamped to valid range). */
export function getViewTuningProfile(viewModeIndex: number): ViewTuningProfile {
  const clamped = Math.max(0, Math.min(MAX_VIEW_MODE_INDEX, viewModeIndex | 0));
  return PROFILE_BY_INDEX.get(clamped) ?? VIEW_TUNING_PROFILES[0]!;
}

/** Window emissive multiplier for the skyline city pass from active coreBoost. */
export function skylineEmissiveScale(coreBoost: number): number {
  return coreBoost / SKYLINE_EMISSIVE_CORE_REF;
}

/** Linearly interpolate numeric fields between two profiles. */
export function interpolateViewTuningProfiles(
  from: ViewTuningProfile,
  to: ViewTuningProfile,
  t: number,
): ViewTuningProfile {
  const s = smoothstep(t);
  return {
    viewModeIndex: s < 0.5 ? from.viewModeIndex : to.viewModeIndex,
    shortName: s < 0.5 ? from.shortName : to.shortName,
    rationale: s < 0.5 ? from.rationale : to.rationale,
    bloomThreshold: lerp(from.bloomThreshold, to.bloomThreshold, s),
    bloomKnee: lerp(from.bloomKnee, to.bloomKnee, s),
    bloomIntensity: lerp(from.bloomIntensity, to.bloomIntensity, s),
    satCoreOuter: lerp(from.satCoreOuter, to.satCoreOuter, s),
    satCoreInner: lerp(from.satCoreInner, to.satCoreInner, s),
    haloStrength: lerp(from.haloStrength, to.haloStrength, s),
    coreBoost: lerp(from.coreBoost, to.coreBoost, s),
    distanceCullKm: lerp(from.distanceCullKm, to.distanceCullKm, s),
    animationIntensity: lerp(from.animationIntensity, to.animationIntensity, s),
    animationContrast: lerp(from.animationContrast, to.animationContrast, s),
  };
}

/** Blend profiles for a mode transition (uses smoothstep on t). */
export function blendViewTuningProfiles(
  fromIndex: number,
  toIndex: number,
  t: number,
): ViewTuningProfile {
  const from = getViewTuningProfile(fromIndex);
  const to = getViewTuningProfile(toIndex);
  if (fromIndex === toIndex || t >= 1) return to;
  if (t <= 0) return from;
  return interpolateViewTuningProfiles(from, to, t);
}

/** HUD label during a transition. */
export function formatTuningProfileLabel(
  fromIndex: number,
  toIndex: number,
  t: number,
): string {
  const from = getViewTuningProfile(fromIndex);
  const to = getViewTuningProfile(toIndex);
  if (fromIndex === toIndex || t >= 0.99) return to.shortName;
  if (t <= 0.01) return from.shortName;
  return `${from.shortName} → ${to.shortName}`;
}

export interface ResolvedViewTuning {
  settings: ImageTuningSettings;
  profileLabel: string;
  activeProfile: ViewTuningProfile;
}

/** Convert a blended profile into ImageTuningSettings for the render pipeline. */
export function profileToImageTuning(
  profile: ViewTuningProfile,
  enforceFloors: boolean,
  animationMasterIntensity = ANIMATION_MASTER_INTENSITY_DEFAULT,
): ImageTuningSettings {
  const anim = resolveEffectiveAnimationTuning(profile, animationMasterIntensity);
  return {
    bloomThreshold: profile.bloomThreshold,
    bloomKnee: profile.bloomKnee,
    bloomIntensity: profile.bloomIntensity,
    satCoreOuter: profile.satCoreOuter,
    satCoreInner: profile.satCoreInner,
    haloStrength: profile.haloStrength,
    coreBoost: profile.coreBoost,
    distanceCullKm: profile.distanceCullKm,
    animationIntensity: anim.animationIntensity,
    animationContrast: anim.animationContrast,
    animationMasterIntensity,
    enforceFloors,
  };
}

/** Resolve effective tuning from a mode-transition blend state. */
export function resolveViewTuning(
  fromIndex: number,
  toIndex: number,
  t: number,
  enforceFloors = SHIPPING_IMAGE_TUNING.enforceFloors,
  animationMasterIntensity = ANIMATION_MASTER_INTENSITY_DEFAULT,
): ResolvedViewTuning {
  const activeProfile = blendViewTuningProfiles(fromIndex, toIndex, t);
  return {
    settings: profileToImageTuning(activeProfile, enforceFloors, animationMasterIntensity),
    profileLabel: formatTuningProfileLabel(fromIndex, toIndex, t),
    activeProfile,
  };
}
