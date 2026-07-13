/**
 * Shared Keplerian orbit propagation (CPU mirror of GPU extended-element path).
 */

import { EARTH_MU_KM3_S2 } from './keplerianFromState.js';

export interface KeplerianElements {
  a: number;
  e: number;
  inc: number;
  raan: number;
  argp: number;
  M0: number;
  n: number;
}

/** Solve Kepler's equation M = E - e sin(E) with Newton-Raphson. */
export function solveKepler(meanAnomaly: number, eccentricity: number, iterations = 8): number {
  let M = meanAnomaly % (2 * Math.PI);
  if (M < 0) M += 2 * Math.PI;

  let E = eccentricity > 0.8 ? Math.PI : M;
  for (let i = 0; i < iterations; i++) {
    const f = E - eccentricity * Math.sin(E) - M;
    const fp = 1 - eccentricity * Math.cos(E);
    E -= f / fp;
  }
  return E;
}

/** Propagate osculating elements to an ECI position at simulation time `t` (seconds). */
export function propagateKeplerian(elements: KeplerianElements, t: number): [number, number, number] {
  const { a, e, inc, raan, argp, M0, n } = elements;
  const M = M0 + n * t;
  const E = solveKepler(M, e);
  const cE = Math.cos(E);
  const sE = Math.sin(E);
  const nu = Math.atan2(Math.sqrt(Math.max(0, 1 - e * e)) * sE, cE - e);
  const r = a * (1 - e * cE);

  const xOrb = r * Math.cos(nu);
  const yOrb = r * Math.sin(nu);

  const cO = Math.cos(raan);
  const sO = Math.sin(raan);
  const ci = Math.cos(inc);
  const si = Math.sin(inc);
  const cw = Math.cos(argp);
  const sw = Math.sin(argp);

  const x = (cO * cw - sO * sw * ci) * xOrb + (-cO * sw - sO * cw * ci) * yOrb;
  const y = (sO * cw + cO * sw * ci) * xOrb + (-sO * sw + cO * cw * ci) * yOrb;
  const z = sw * si * xOrb + cw * si * yOrb;
  return [x, y, z];
}

/** Mean motion from semi-major axis. */
export function meanMotionFromSemiMajorAxis(aKm: number, mu = EARTH_MU_KM3_S2): number {
  return Math.sqrt(mu / (aKm * aKm * aKm));
}
