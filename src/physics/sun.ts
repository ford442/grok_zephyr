/**
 * Sun direction for lighting / eclipse.
 * Art: cinematic XY-plane circle (visual default).
 * Astro: low-precision geometric sun from UTC (Meeus, mean equator of date).
 */

import { AU_KM, unixMsToJulianDate } from './frames.js';

export type SunLightingMode = 'art' | 'astro';

export const ART_SUN_PERIOD_SEC = 31557600;
export const SUN_DISTANCE_KM = AU_KM;

const DEG = Math.PI / 180;

export function parseSunLightingMode(raw: string | null | undefined): SunLightingMode | null {
  const v = raw?.toLowerCase();
  if (v === 'art' || v === 'astro') return v;
  return null;
}

/** Historic cinematic sun: 1 AU in the XY plane, phase from sim seconds only. */
export function artSunPositionEci(simTimeSec: number): [number, number, number] {
  const angle = (simTimeSec / ART_SUN_PERIOD_SEC) * Math.PI * 2;
  return [Math.cos(angle) * SUN_DISTANCE_KM, Math.sin(angle) * SUN_DISTANCE_KM, 0];
}

/**
 * Geometric sun in the mean equator of date (Meeus Astronomical Algorithms, low precision).
 * Declination error is typically < 0.02°. Not a full VSOP87 / aberration solution.
 */
export function astroSunPositionEci(utcMs: number): [number, number, number] {
  const n = unixMsToJulianDate(utcMs) - 2451545.0;
  const L = (280.46 + 0.9856474 * n) * DEG;
  const g = (357.528 + 0.9856003 * n) * DEG;
  const lambda = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const epsilon = (23.439 - 0.0000004 * n) * DEG;
  const x = Math.cos(lambda);
  const y = Math.cos(epsilon) * Math.sin(lambda);
  const z = Math.sin(epsilon) * Math.sin(lambda);
  return [x * SUN_DISTANCE_KM, y * SUN_DISTANCE_KM, z * SUN_DISTANCE_KM];
}

export function resolveSunPosition(options: {
  mode: SunLightingMode;
  simTimeSec: number;
  utcMs: number;
}): [number, number, number] {
  if (options.mode === 'astro') {
    return astroSunPositionEci(options.utcMs);
  }
  return artSunPositionEci(options.simTimeSec);
}

const STORAGE_KEY = 'zephyr.sunMode';

export function readStoredSunMode(): SunLightingMode | null {
  try {
    return parseSunLightingMode(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function persistSunMode(mode: SunLightingMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}
