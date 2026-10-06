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

/** Row-major 3×3 rotation, `out = m · v` (same layout as native/wasm/teme_gcrf.hpp). */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

const ARCSEC_TO_RAD = Math.PI / (180 * 3600);
const DEG_TO_RAD = Math.PI / 180;

function rotX3(a: number): Mat3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [1, 0, 0, 0, c, s, 0, -s, c];
}

function rotY3(a: number): Mat3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, -s, 0, 1, 0, s, 0, c];
}

function rotZ3(a: number): Mat3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, s, 0, -s, c, 0, 0, 0, 1];
}

export function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9) as Mat3;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
  }
  return out;
}

export function mat3Transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

export function mat3MulVec(m: Mat3, v: readonly [number, number, number]): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/**
 * TEME → GCRF (≈ J2000/ICRS) at Julian date: IAU-76 precession, truncated
 * IAU-1980 nutation (Ω and 2L terms) and the equation of the equinoxes.
 * Line-for-line port of `temeToGcrfMatrix` in native/wasm/teme_gcrf.hpp, so the
 * star catalog and `?frame=gcrf` satellite re-anchors share one rotation.
 */
export function temeToGcrfMatrix(jd: number): Mat3 {
  const t = (jd - JD_J2000) / 36525;
  const t2 = t * t;
  const t3 = t2 * t;

  const zeta = (2306.2181 * t + 0.30188 * t2 + 0.017998 * t3) * ARCSEC_TO_RAD;
  const z = (2306.2181 * t + 1.09468 * t2 + 0.018203 * t3) * ARCSEC_TO_RAD;
  const theta = (2004.3109 * t - 0.42665 * t2 - 0.041833 * t3) * ARCSEC_TO_RAD;
  const precession = mat3Mul(rotZ3(-z), mat3Mul(rotY3(theta), rotZ3(-zeta)));

  const omega = (125.04452 - 1934.136261 * t) * DEG_TO_RAD;
  const lSun = (280.4665 + 36000.7698 * t) * DEG_TO_RAD;
  const dpsi = (-17.1996 * Math.sin(omega) - 1.3187 * Math.sin(2 * lSun)) * ARCSEC_TO_RAD;
  const deps = (9.2025 * Math.cos(omega) + 0.5736 * Math.cos(2 * lSun)) * ARCSEC_TO_RAD;
  const eps0 = (23.439291 - 0.0130042 * t) * DEG_TO_RAD;
  const eps = eps0 + deps;
  const nutation = mat3Mul(rotX3(-eps), mat3Mul(rotZ3(-dpsi), rotX3(eps0)));

  const eqRot = rotZ3(dpsi * Math.cos(eps));
  return mat3Mul(mat3Mul(mat3Transpose(precession), mat3Transpose(nutation)), eqRot);
}

/** GCRF (≈ ICRS) → TEME of date: the inverse (transpose) of `temeToGcrfMatrix`. */
export function gcrfToTemeMatrix(jd: number): Mat3 {
  return mat3Transpose(temeToGcrfMatrix(jd));
}
