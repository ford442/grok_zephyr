/**
 * Earth photometric map configuration — quality tiers, URL parsing, and the
 * optional GPU features the KTX2 loader needs at device-creation time.
 *
 * Textures are opt-in (`?earthmap=`). With no param the Earth stays procedural
 * FBM, so every existing visual baseline renders the same pixels.
 */

import type { QualityLevel } from '@/core/QualityPresets.js';

export type EarthMapTier = 'off' | 'low' | 'balanced' | 'high';

/** Turns of longitude per second of sim time for the cloud sheet. */
export const EARTH_MAP_CLOUD_SPEED = 1 / 600000;
/** Scales the squared VIIRS DNB sample into the shader's emissive term. */
export const EARTH_MAP_NIGHT_GAIN = 1.6;
/** Lifts MODIS cloud fraction into the shader's 0.44-0.62 coverage window. */
export const EARTH_MAP_CLOUD_GAIN = 1.35;

export interface EarthMapPlan {
  tier: EarthMapTier;
  /** Equirect albedo (Blue Marble). Absent only when the tier is 'off'. */
  albedo: string | null;
  /** VIIRS DNB night lights, multiplied by the shader's night-side term. */
  night: string | null;
  /** MODIS cloud fraction, scrolled in longitude. */
  clouds: string | null;
}

/**
 * Compressed formats the transcoder can target. These live in
 * DEFERRED_OPTIONAL_FEATURES until a tier other than 'off' is selected —
 * device features are frozen at creation, so the decision has to be made from
 * the URL before `requestDevice`, not when the first texture arrives.
 */
export const EARTH_MAP_OPTIONAL_FEATURES = [
  'texture-compression-bc',
  'texture-compression-etc2',
  'texture-compression-astc',
] as const satisfies readonly GPUFeatureName[];

const PLANS: Record<EarthMapTier, EarthMapPlan> = {
  off: { tier: 'off', albedo: null, night: null, clouds: null },
  low: { tier: 'low', albedo: 'albedo_1k', night: null, clouds: null },
  balanced: { tier: 'balanced', albedo: 'albedo_2k', night: 'night_1k', clouds: null },
  high: { tier: 'high', albedo: 'albedo_4k', night: 'night_2k', clouds: 'clouds_2k' },
};

export function earthMapPlan(tier: EarthMapTier): EarthMapPlan {
  return PLANS[tier];
}

/** Tier implied by the render quality preset, for `?earthmap=on`. */
export function earthMapTierForQuality(quality: QualityLevel): EarthMapTier {
  switch (quality) {
    case 'low':
      return 'low';
    case 'balanced':
      return 'balanced';
    default:
      return 'high';
  }
}

/**
 * Parse `?earthmap=`. Also honours `?earth=proc` — the spelling the plan used
 * for the procedural fallback — without disturbing `?earth=0|1`, which is the
 * unrelated GMST rotation switch (see docs/FRAMES.md).
 */
export function parseEarthMapTier(
  search: string,
  quality: QualityLevel,
): EarthMapTier {
  const params = new URLSearchParams(search);
  if (params.get('earth')?.toLowerCase() === 'proc') return 'off';

  const raw = params.get('earthmap')?.toLowerCase();
  if (!raw) return 'off';
  switch (raw) {
    case 'off':
    case '0':
    case 'false':
    case 'proc':
      return 'off';
    case 'low':
      return 'low';
    case 'balanced':
      return 'balanced';
    case 'high':
    case 'cinematic':
      return 'high';
    case 'on':
    case '1':
    case 'true':
    case 'auto':
      return earthMapTierForQuality(quality);
    default:
      return 'off';
  }
}

/**
 * Tier resolved at boot. It has to be settled before `requestDevice` so the
 * compression features can be requested, and the render pipeline reads it back
 * when it loads the plates — mirroring how the fleet size is resolved once and
 * published (see FleetScale).
 */
let activeTier: EarthMapTier = 'off';

export function setActiveEarthMapTier(tier: EarthMapTier): void {
  activeTier = tier;
}

export function getActiveEarthMapTier(): EarthMapTier {
  return activeTier;
}
