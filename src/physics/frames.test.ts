import { describe, expect, it } from 'vitest';
import {
  gmstRad,
  unixMsToJulianDate,
  eciToEcef,
  ecefToEci,
  earthRotationRad,
  gcrfToTemeMatrix,
  mat3Mul,
  mat3MulVec,
  temeToGcrfMatrix,
  JD_J2000,
} from './frames.js';

/**
 * The Meeus-degree GMST polynomial that used to live in `GroundStation.ts`
 * (`gmstRadians`), inlined here only to lock its agreement with the Vallado
 * seconds form (`gmstRad`) now that `GroundStation.ts` delegates to it. See
 * docs/FRAMES.md "Single time/orientation module".
 */
function legacyMeeusGmstRad(utcMs: number): number {
  const jd = utcMs / 86400000 + 2440587.5;
  const t = (jd - 2451545.0) / 36525;
  const deg = 280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * t * t - t * t * t / 38710000;
  const norm = ((deg + 180) % 360 + 360) % 360 - 180;
  return norm * Math.PI / 180;
}

function angularDiffRad(a: number, b: number): number {
  const d = ((a - b + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return Math.abs(d);
}

describe('frames', () => {
  it('converts Unix epoch to JD 2440587.5', () => {
    expect(unixMsToJulianDate(0)).toBeCloseTo(2440587.5, 8);
  });

  it('GMST is 2π-periodic and finite', () => {
    const g = gmstRad(2451545.0);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThan(Math.PI * 2);
  });

  it('ECEF↔ECI is an inverse rotation', () => {
    const jd = unixMsToJulianDate(Date.UTC(2024, 5, 21, 12, 0, 0));
    const eci: [number, number, number] = [6378, 100, 50];
    const ecef = eciToEcef(eci, jd);
    const back = ecefToEci(ecef, jd);
    expect(back[0]).toBeCloseTo(eci[0], 6);
    expect(back[1]).toBeCloseTo(eci[1], 6);
    expect(back[2]).toBeCloseTo(eci[2], 6);
  });

  it('agrees with the retired Meeus-degree GMST form to ~1e-6 rad at J2000 and a 2026 date', () => {
    for (const utcMs of [Date.UTC(2000, 0, 1, 12, 0, 0), Date.UTC(2026, 8, 7, 0, 0, 0)]) {
      const jd = unixMsToJulianDate(utcMs);
      expect(angularDiffRad(gmstRad(jd), legacyMeeusGmstRad(utcMs))).toBeLessThan(1e-6);
    }
  });

  it('earthRotationRad art mode reproduces the legacy sim-time-only spin (negated)', () => {
    const simTimeSec = 1234.5;
    const legacyAngle = (simTimeSec / 86164.0) * Math.PI * 2;
    expect(earthRotationRad('art', simTimeSec, 0)).toBeCloseTo(-legacyAngle, 10);
  });

  it('earthRotationRad gmst mode matches gmstRad(simUtcMs)', () => {
    const utcMs = Date.UTC(2026, 8, 7, 6, 0, 0);
    expect(earthRotationRad('gmst', 0, utcMs)).toBeCloseTo(gmstRad(unixMsToJulianDate(utcMs)), 10);
  });
});

describe('temeToGcrfMatrix', () => {
  const angleArcsec = (a: [number, number, number], b: [number, number, number]): number =>
    (Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180 * 3600) / Math.PI;

  it('is orthonormal and inverted by gcrfToTemeMatrix', () => {
    const jd = unixMsToJulianDate(Date.UTC(2026, 9, 5));
    const id = mat3Mul(temeToGcrfMatrix(jd), gcrfToTemeMatrix(jd));
    for (let i = 0; i < 9; i++) expect(id[i]).toBeCloseTo(i % 4 === 0 ? 1 : 0, 12);
  });

  it('is only nutation-sized at J2000 and precession-sized in 2026', () => {
    const x: [number, number, number] = [1, 0, 0];
    // Truncated nutation + equation of equinoxes alone: tens of arcsec.
    expect(angleArcsec(x, mat3MulVec(temeToGcrfMatrix(JD_J2000), x))).toBeLessThan(40);
    // ~50.3 arcsec/yr general precession → ~0.37° by late 2026.
    const deg2026 = angleArcsec(x, mat3MulVec(temeToGcrfMatrix(unixMsToJulianDate(Date.UTC(2026, 9, 5))), x)) / 3600;
    expect(deg2026).toBeGreaterThan(0.3);
    expect(deg2026).toBeLessThan(0.42);
  });
});
