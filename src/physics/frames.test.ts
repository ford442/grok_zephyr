import { describe, expect, it } from 'vitest';
import { gmstRad, unixMsToJulianDate, eciToEcef, ecefToEci } from './frames.js';

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
});
