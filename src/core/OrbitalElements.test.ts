import { describe, it, expect } from 'vitest';
import { OrbitalElements, SHELL_RADII_KM } from './OrbitalElements.js';

describe('OrbitalElements', () => {
  it('generates one vec4 per satellite with in-range shell indices', () => {
    const orb = new OrbitalElements(4096);
    const data = orb.generate();
    expect(data.length).toBe(4096 * 4);
    for (let i = 0; i < 4096; i++) {
      const shellData = data[i * 4 + 3];
      const shellIndex = (shellData >> 8) & 0xff;
      expect(shellIndex).toBeGreaterThanOrEqual(0);
      expect(shellIndex).toBeLessThanOrEqual(2);
    }
  });

  it('keeps satellites on their shell radius (circular-orbit invariant)', () => {
    // |position| must equal the shell radius for all indices/times because the
    // simple-mode propagation is a pure circular orbit. This is the exact
    // invariant the WebGL vertex shader relies on for parity.
    const orb = new OrbitalElements(2048);
    orb.generate();
    for (const idx of [0, 1, 17, 511, 1234, 2047]) {
      for (const t of [0, 1000, 86400]) {
        const [x, y, z] = orb.calculatePosition(idx, t);
        const r = Math.hypot(x, y, z);
        const shellIndex = (orb.data[idx * 4 + 3] >> 8) & 0xff;
        expect(r).toBeCloseTo(SHELL_RADII_KM[shellIndex], 2);
      }
    }
  });

  it('position is deterministic and time-varying', () => {
    const orb = new OrbitalElements(64);
    orb.generate();
    const a = orb.calculatePosition(10, 0);
    const aAgain = orb.calculatePosition(10, 0);
    const b = orb.calculatePosition(10, 500);
    expect(a).toEqual(aAgain);
    expect(a).not.toEqual(b);
  });

  it('velocity direction is unit length', () => {
    const orb = new OrbitalElements(64);
    orb.generate();
    const [vx, vy, vz] = orb.calculateVelocity(5, 1234);
    expect(Math.hypot(vx, vy, vz)).toBeCloseTo(1.0, 5);
  });
});
