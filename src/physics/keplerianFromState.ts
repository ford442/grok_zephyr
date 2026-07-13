/**
 * Convert ECI position/velocity (km, km/s) to osculating Keplerian elements.
 */

export const EARTH_MU_KM3_S2 = 398600.4418;

export interface KeplerianState {
  a: number;
  e: number;
  inc: number;
  raan: number;
  argp: number;
  M0: number;
  n: number;
}

export interface EciVector {
  x: number;
  y: number;
  z: number;
}

function norm3(x: number, y: number, z: number): number {
  return Math.hypot(x, y, z);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Mean anomaly from eccentric anomaly. */
export function meanAnomalyFromEccentric(E: number, e: number): number {
  return E - e * Math.sin(E);
}

/** Eccentric anomaly from true anomaly. */
export function eccentricFromTrueAnomaly(nu: number, e: number): number {
  const tanHalf = Math.tan(nu * 0.5);
  const root = Math.sqrt((1 - e) / (1 + e));
  return 2 * Math.atan(tanHalf / (e < 1e-8 ? 1 : root));
}

/**
 * Osculating Keplerian elements at the instant of the supplied state vectors.
 */
export function eciStateToKeplerian(
  position: EciVector,
  velocity: EciVector,
  mu = EARTH_MU_KM3_S2,
): KeplerianState {
  const rx = position.x;
  const ry = position.y;
  const rz = position.z;
  const vx = velocity.x;
  const vy = velocity.y;
  const vz = velocity.z;

  const rMag = norm3(rx, ry, rz);
  const vMag = norm3(vx, vy, vz);
  const rDotV = rx * vx + ry * vy + rz * vz;

  const hx = ry * vz - rz * vy;
  const hy = rz * vx - rx * vz;
  const hz = rx * vy - ry * vx;
  const hMag = norm3(hx, hy, hz);

  const inc = hMag > 1e-9 ? Math.acos(clamp(hz / hMag, -1, 1)) : 0;

  const nx = -hy;
  const ny = hx;
  const nMag = Math.hypot(nx, ny);

  let raan = 0;
  if (nMag > 1e-9) {
    raan = Math.acos(clamp(nx / nMag, -1, 1));
    if (ny < 0) raan = 2 * Math.PI - raan;
  }

  const a = 1 / (2 / rMag - (vMag * vMag) / mu);
  const n = Math.sqrt(mu / (a * a * a));

  const eCoeff = (vMag * vMag - mu / rMag) / mu;
  const eVecX = eCoeff * rx - (rDotV / mu) * vx;
  const eVecY = eCoeff * ry - (rDotV / mu) * vy;
  const eVecZ = eCoeff * rz - (rDotV / mu) * vz;
  const e = norm3(eVecX, eVecY, eVecZ);

  let argp = 0;
  if (e > 1e-8 && nMag > 1e-9) {
    argp = Math.acos(clamp((eVecX * nx + eVecY * ny) / (e * nMag), -1, 1));
    if (eVecZ < 0) argp = 2 * Math.PI - argp;
  }

  let nu = 0;
  if (e > 1e-8) {
    nu = Math.acos(clamp((eVecX * rx + eVecY * ry + eVecZ * rz) / (e * rMag), -1, 1));
    if (rDotV < 0) nu = 2 * Math.PI - nu;
  } else if (nMag > 1e-9) {
    nu = Math.acos(clamp((nx * rx + ny * ry) / (nMag * rMag), -1, 1));
    if (rz < 0) nu = 2 * Math.PI - nu;
    argp = 0;
  }

  const E = eccentricFromTrueAnomaly(nu, e);
  const M0 = meanAnomalyFromEccentric(E, e);

  return { a, e, inc, raan, argp, M0, n };
}
