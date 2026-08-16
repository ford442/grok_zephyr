import { describe, expect, it } from 'vitest';
import { SHELL_MEAN_MOTIONS, SHELL_RADII_KM } from '@/core/OrbitalElements.js';
import { writeShellExtended } from './extendedElements.js';
import {
  j2SecularRates,
  meanMotionFromSemiMajorAxis,
  propagateKeplerian,
  propagateKeplerianJ2,
  type KeplerianElements,
} from './keplerianPropagation.js';
import { PHYSICS_MODE, packPhysicsBits, unpackPhysicsMode } from './physicsMode.js';

function sampleElements(): KeplerianElements {
  const a = 6921;
  return {
    a,
    e: 0.05,
    inc: 0.93,
    raan: 0.4,
    argp: 0.7,
    M0: 0.2,
    n: meanMotionFromSemiMajorAxis(a),
  };
}

function dist(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

describe('physics modes', () => {
  it('packs physics mode into view_mode bits 17–19', () => {
    const flags = packPhysicsBits(PHYSICS_MODE.J2) | (1 << 16);
    expect(unpackPhysicsMode(flags)).toBe(PHYSICS_MODE.J2);
    expect((flags >> 17) & 7).toBe(2);
  });

  it('mode 0 vs 1 diverge for a known shell element set', () => {
    const orb = new Float32Array(4);
    orb[0] = 0.3;
    orb[1] = 0.9;
    orb[2] = 0.1;
    orb[3] = (1 << 8) | 6;
    const ext = new Float32Array(8);
    writeShellExtended(ext, 0, orb[0], orb[1], orb[2], 1);

    const t = 3600;
    const shellR = SHELL_RADII_KM[1];
    const nSimple = SHELL_MEAN_MOTIONS[1];
    const M = orb[2] + nSimple * t;
    const cM = Math.cos(M);
    const sM = Math.sin(M);
    const cR = Math.cos(orb[0]);
    const sR = Math.sin(orb[0]);
    const cI = Math.cos(orb[1]);
    const sI = Math.sin(orb[1]);
    const simple: [number, number, number] = [
      shellR * (cR * cM - sR * sM * cI),
      shellR * (sR * cM + cR * sM * cI),
      shellR * sM * sI,
    ];
    const kepler = propagateKeplerian(
      {
        a: ext[0],
        e: ext[1],
        inc: ext[2],
        raan: ext[3],
        argp: ext[4],
        M0: ext[5],
        n: ext[6],
      },
      t,
    );
    expect(dist(simple, kepler)).toBeGreaterThan(1);
  });

  it('J2 matches Keplerian at t=0 and diverges after a day', () => {
    const el = sampleElements();
    const k0 = propagateKeplerian(el, 0);
    const j0 = propagateKeplerianJ2(el, 0);
    expect(dist(k0, j0)).toBeLessThan(1e-6);

    const day = 86400;
    const k1 = propagateKeplerian(el, day);
    const j1 = propagateKeplerianJ2(el, day);
    expect(dist(k1, j1)).toBeGreaterThan(10);

    const rates = j2SecularRates(el);
    expect(rates.raanDot).toBeLessThan(0);
    expect(Math.abs(rates.raanDot * day)).toBeGreaterThan(1e-4);
  });
});
