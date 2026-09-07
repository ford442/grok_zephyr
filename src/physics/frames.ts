/**
 * Time and Earth-orientation helpers (low precision).
 * See docs/FRAMES.md — TEME is treated as the render ECI; GMST is for ECEF↔ECI later.
 */

export const JD_UNIX_EPOCH = 2440587.5;
export const JD_J2000 = 2451545.0;
export const SECONDS_PER_DAY = 86400;
export const AU_KM = 149597870.7;

export function unixMsToJulianDate(unixMs: number): number {
  return unixMs / 86400000 + JD_UNIX_EPOCH;
}

export function julianDateToCentury(jd: number): number {
  return (jd - JD_J2000) / 36525;
}

/** Greenwich Mean Sidereal Time (IAU 1982 / Vallado), radians in [0, 2π). */
export function gmstRad(jd: number): number {
  const t = julianDateToCentury(jd);
  const seconds =
    67310.54841 + (876600 * 3600 + 8640184.812866) * t + 0.093104 * t * t - 6.2e-6 * t * t * t;
  const turns = seconds / 86400;
  const frac = turns - Math.floor(turns);
  return ((frac % 1) + 1) % 1 * Math.PI * 2;
}

export function rotateZ(
  v: readonly [number, number, number],
  angleRad: number,
): [number, number, number] {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return [c * v[0] + s * v[1], -s * v[0] + c * v[1], v[2]];
}

/** Approximate TEME/ECI → ECEF using GMST only (no polar motion). */
export function eciToEcef(
  eci: readonly [number, number, number],
  jd: number,
): [number, number, number] {
  return rotateZ(eci, gmstRad(jd));
}

export function ecefToEci(
  ecef: readonly [number, number, number],
  jd: number,
): [number, number, number] {
  return rotateZ(ecef, -gmstRad(jd));
}

/** Legacy WGSL earth-spin period (seconds); kept only for ART-mode bit-parity, see below. */
const ART_EARTH_SIDEREAL_PERIOD_SEC = 86164.0;

export type EarthRotationMode = 'art' | 'gmst';

/**
 * Earth-fixed rotation angle for the render-frame ECI→body transform shared by
 * the Earth surface and Ground View shaders (`wp_rot = rotateZ(wp_norm, angle)`,
 * matching the `eciToEcef` convention above). See docs/FRAMES.md.
 *
 * - `'art'`  — legacy sim-time-only spin with no UTC anchor. Deliberately the
 *   negative of the old (pre-unification) WGSL formula: the shaders used to
 *   compute `wp_rot` as `rotateZ(wp_norm, -legacyAngle)`, so emitting
 *   `-legacyAngle` here and having shaders rotate by `+angle` reproduces the
 *   exact pixels of every existing ART-mode visual baseline.
 * - `'gmst'` — true Greenwich Mean Sidereal Time from simulated UTC, i.e. the
 *   same angle `GroundStation.ts` uses for ECEF↔ECI, so a station's zenith
 *   and the sampled surface agree.
 */
export function earthRotationRad(mode: EarthRotationMode, simTimeSec: number, utcMs: number): number {
  if (mode === 'gmst') return gmstRad(unixMsToJulianDate(utcMs));
  return -((simTimeSec / ART_EARTH_SIDEREAL_PERIOD_SEC) * Math.PI * 2);
}
