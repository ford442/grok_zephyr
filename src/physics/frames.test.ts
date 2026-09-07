import { describe, expect, it } from 'vitest';
import { gmstRad, unixMsToJulianDate, eciToEcef, ecefToEci, earthRotationRad } from './frames.js';

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
