import { describe, expect, it } from 'vitest';
import {
  artSunPositionEci,
  astroSunPositionEci,
  resolveSunPosition,
  SUN_DISTANCE_KM,
} from './sun.js';

function declinationDeg(v: readonly [number, number, number]): number {
  const r = Math.hypot(v[0], v[1], v[2]);
  return (Math.asin(v[2] / r) * 180) / Math.PI;
}

describe('sun lighting', () => {
  it('art mode stays in the XY plane and ignores calendar date', () => {
    const a = artSunPositionEci(0);
    expect(a[2]).toBe(0);
    const june = resolveSunPosition({
      mode: 'art',
      simTimeSec: 1000,
      utcMs: Date.UTC(2024, 5, 21, 12, 0, 0),
    });
    const dec = resolveSunPosition({
      mode: 'art',
      simTimeSec: 1000,
      utcMs: Date.UTC(2024, 11, 21, 12, 0, 0),
    });
    expect(june).toEqual(dec);
    expect(Math.hypot(...june)).toBeCloseTo(SUN_DISTANCE_KM, 0);
  });

  it('astro mode terminator follows day-of-year at a fixed clock time', () => {
    const noon = { hour: 12, minute: 0, second: 0 };
    const june = astroSunPositionEci(Date.UTC(2024, 5, 21, noon.hour));
    const dec = astroSunPositionEci(Date.UTC(2024, 11, 21, noon.hour));
    const march = astroSunPositionEci(Date.UTC(2024, 2, 20, noon.hour));

    expect(declinationDeg(june)).toBeGreaterThan(20);
    expect(declinationDeg(dec)).toBeLessThan(-20);
    expect(Math.abs(declinationDeg(march))).toBeLessThan(3);
    expect(june[2]).not.toBeCloseTo(dec[2], 0);
  });

  it('calculateSunPosition-compatible art path matches the historic XY circle', () => {
    const t = 86400 * 10;
    const pos = artSunPositionEci(t);
    const angle = (t / 31557600) * Math.PI * 2;
    expect(pos[0]).toBeCloseTo(Math.cos(angle) * SUN_DISTANCE_KM, 3);
    expect(pos[1]).toBeCloseTo(Math.sin(angle) * SUN_DISTANCE_KM, 3);
    expect(pos[2]).toBe(0);
  });
});
