/**
 * Extended orbital element buffer layout (32 bytes / satellite).
 *
 *   [0] a    semi-major axis (km)
 *   [1] e    eccentricity
 *   [2] inc  inclination (rad)
 *   [3] raan right ascension of ascending node (rad)
 *   [4] argp argument of perigee (rad)
 *   [5] M0   mean anomaly at anchor (rad)
 *   [6] n    mean motion (rad/s)
 *   [7] flag 1.0 = SGP4-derived Keplerian, 0.0 = simple-shell fallback
 */

import { SHELL_RADII_KM } from '@/core/OrbitalElements.js';
import type { KeplerianState } from './keplerianFromState.js';
import { meanMotionFromSemiMajorAxis } from './keplerianPropagation.js';

export const EXTENDED_FLOATS_PER_SATELLITE = 8;
export const REALISM_FLAG_SGP4 = 1.0;
export const REALISM_FLAG_SHELL = 0.0;

export function writeKeplerianExtended(
  data: Float32Array,
  index: number,
  state: KeplerianState,
  realismFlag = REALISM_FLAG_SGP4,
): void {
  const base = index * EXTENDED_FLOATS_PER_SATELLITE;
  data[base + 0] = state.a;
  data[base + 1] = state.e;
  data[base + 2] = state.inc;
  data[base + 3] = state.raan;
  data[base + 4] = state.argp;
  data[base + 5] = state.M0;
  data[base + 6] = state.n;
  data[base + 7] = realismFlag;
}

export function writeShellExtended(
  data: Float32Array,
  index: number,
  raan: number,
  inc: number,
  meanAnomaly: number,
  shellIndex: number,
): void {
  const a = SHELL_RADII_KM[shellIndex] || SHELL_RADII_KM[1];
  const base = index * EXTENDED_FLOATS_PER_SATELLITE;
  data[base + 0] = a;
  data[base + 1] = 0.001;
  data[base + 2] = inc;
  data[base + 3] = raan;
  data[base + 4] = 0;
  data[base + 5] = meanAnomaly;
  data[base + 6] = meanMotionFromSemiMajorAxis(a);
  data[base + 7] = REALISM_FLAG_SHELL;
}

export function readKeplerianExtended(
  data: Float32Array,
  index: number,
): {
  a: number;
  e: number;
  inc: number;
  raan: number;
  argp: number;
  M0: number;
  n: number;
  realismFlag: number;
} {
  const base = index * EXTENDED_FLOATS_PER_SATELLITE;
  return {
    a: data[base + 0],
    e: data[base + 1],
    inc: data[base + 2],
    raan: data[base + 3],
    argp: data[base + 4],
    M0: data[base + 5],
    n: data[base + 6],
    realismFlag: data[base + 7],
  };
}
