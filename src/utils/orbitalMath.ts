/**
 * Orbital utilities for satellite metadata display.
 */

import type { Vec3 } from '@/types/index.js';
import { CONSTANTS } from '@/types/constants.js';
import { earthRotationRad } from '@/physics/frames.js';

const MU = 398600.4418;
const EARTH_RADIUS_KM = CONSTANTS.EARTH_RADIUS_KM;

/**
 * ECI position → body-fixed lat/lon, for the satellite HUD readout ("over Seattle").
 * Uses the ART-mode rotation angle from `earthRotationRad()` (src/physics/frames.ts)
 * so this agrees with what the Earth/Ground View shaders sample at the same
 * `simTimeSec` — see docs/FRAMES.md. Under `?sun=astro` / `?earth=1` the shaders
 * switch to true GMST; this HUD readout intentionally stays ART-only since it
 * has no UTC available at the call site (SatelliteCatalog.buildLiveMetadata).
 */
export function eciPositionToLatLon(position: Vec3, simTimeSec: number): { lat: number; lon: number } {
  const angle = earthRotationRad('art', simTimeSec, 0);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = position[0] * c + position[1] * s;
  const y = -position[0] * s + position[1] * c;
  const z = position[2];
  const r = Math.hypot(x, y, z) || 1;
  const lat = (Math.asin(z / r) * 180) / Math.PI;
  const lon = (Math.atan2(y, x) * 180) / Math.PI;
  return { lat, lon };
}

export function orbitalPeriodSec(meanMotionRadPerSec: number): number {
  if (meanMotionRadPerSec <= 0) return 0;
  return (Math.PI * 2) / meanMotionRadPerSec;
}

export function meanMotionFromAltitudeKm(altitudeKm: number): number {
  const a = EARTH_RADIUS_KM + altitudeKm;
  return Math.sqrt(MU / (a * a * a));
}

export function proceduralPlaneSlot(index: number): { plane: number; slot: number } {
  const plane = Math.floor(index / CONSTANTS.SATELLITES_PER_PLANE);
  const slot = index % CONSTANTS.SATELLITES_PER_PLANE;
  return { plane, slot };
}

export function formatLatLon(lat: number, lon: number): string {
  const latHem = lat >= 0 ? 'N' : 'S';
  const lonHem = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}°${latHem}, ${Math.abs(lon).toFixed(2)}°${lonHem}`;
}
