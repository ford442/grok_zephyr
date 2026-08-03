import { describe, expect, it } from 'vitest';
import { elevationDeg, type GroundStation } from './GroundStation.js';
import { predictPasses } from './PassPredictor.js';
import { TlePropagator } from '@/physics/TlePropagator.js';

/**
 * Frozen ISS TLE fixture (epoch 2024-001.5). Held constant so the expected
 * pass geometry below stays reproducible; refreshing it means refreshing the
 * brute-force expectations with it.
 */
const ISS_TLE = {
  name: 'ISS (ZARYA)',
  line1: '1 25544U 98067A   24001.50000000  .00016717  00000-0  30777-3 0  9993',
  line2: '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49514464 32999',
};

const BERLIN: GroundStation = {
  name: 'Berlin',
  latitudeDeg: 52.52,
  longitudeDeg: 13.405,
  altitudeM: 35,
  minimumElevationDeg: 10,
  source: 'preset',
};

const START = Date.parse('2024-01-01T12:00:00Z');
const WINDOW_MS = 6 * 3600 * 1000;

/**
 * Independent reference: exhaustive one-second scan of the same ephemeris.
 * The predictor uses 30 s sampling plus bisection/ternary refinement, so this
 * validates the search and refinement rather than SGP4 itself.
 */
function bruteForcePasses(
  positionAtUtc: (utcMs: number) => [number, number, number] | null,
): { aosUtcMs: number; losUtcMs: number; maxUtcMs: number; maxElevationDeg: number }[] {
  const passes: { aosUtcMs: number; losUtcMs: number; maxUtcMs: number; maxElevationDeg: number }[] = [];
  let aos: number | null = null;
  let maxUtcMs = START;
  let maxElevationDeg = -90;

  for (let t = START; t <= START + WINDOW_MS; t += 1000) {
    const position = positionAtUtc(t);
    if (!position) continue;
    const elevation = elevationDeg(BERLIN, position, t);
    const above = elevation >= BERLIN.minimumElevationDeg;

    if (above && aos === null) {
      aos = t;
      maxUtcMs = t;
      maxElevationDeg = elevation;
    } else if (above && elevation > maxElevationDeg) {
      maxUtcMs = t;
      maxElevationDeg = elevation;
    } else if (!above && aos !== null) {
      passes.push({ aosUtcMs: aos, losUtcMs: t - 1000, maxUtcMs, maxElevationDeg });
      aos = null;
      maxElevationDeg = -90;
    }
  }
  return passes;
}

describe('predictPasses over a real SGP4 ephemeris', () => {
  const propagator = new TlePropagator();
  expect(propagator.load([ISS_TLE])).toBe(1);
  const positionAtUtc = (utcMs: number): [number, number, number] | null => propagator.propagatePositionEci(0, utcMs);

  it('agrees with an exhaustive one-second scan well inside the one-minute budget', async () => {
    const reference = bruteForcePasses(positionAtUtc);
    expect(reference.length).toBeGreaterThanOrEqual(3);

    const predicted = await predictPasses({
      startUtcMs: START,
      station: BERLIN,
      positionAtUtc,
      method: 'sgp4-js',
      maxPasses: reference.length,
      horizonMs: WINDOW_MS,
    });
    expect(predicted).toHaveLength(reference.length);

    for (const [index, expected] of reference.entries()) {
      const actual = predicted[index];
      // Acceptance criterion is ~1 minute; the refinement should land within seconds.
      expect(Math.abs(actual.aosUtcMs - expected.aosUtcMs)).toBeLessThanOrEqual(2000);
      expect(Math.abs(actual.losUtcMs - expected.losUtcMs)).toBeLessThanOrEqual(2000);
      expect(Math.abs(actual.maxUtcMs - expected.maxUtcMs)).toBeLessThanOrEqual(2000);
      expect(actual.maxElevationDeg).toBeCloseTo(expected.maxElevationDeg, 1);
    }
  });

  it('reports AOS and LOS on the horizon threshold and a plausible ISS pass geometry', async () => {
    const passes = await predictPasses({
      startUtcMs: START,
      station: BERLIN,
      positionAtUtc,
      method: 'sgp4-js',
      maxPasses: 3,
      horizonMs: WINDOW_MS,
    });
    expect(passes).toHaveLength(3);

    for (const pass of passes) {
      // Crossings resolve to one second, so elevation there sits on the threshold.
      for (const utcMs of [pass.aosUtcMs, pass.losUtcMs]) {
        expect(elevationDeg(BERLIN, positionAtUtc(utcMs)!, utcMs)).toBeCloseTo(BERLIN.minimumElevationDeg, 0);
      }
      expect(pass.maxElevationDeg).toBeGreaterThan(BERLIN.minimumElevationDeg);
      expect(pass.maxUtcMs).toBeGreaterThanOrEqual(pass.aosUtcMs);
      expect(pass.maxUtcMs).toBeLessThanOrEqual(pass.losUtcMs);
      // A 10-degree-threshold ISS pass runs a few minutes, never a full orbit.
      const durationSec = (pass.losUtcMs - pass.aosUtcMs) / 1000;
      expect(durationSec).toBeGreaterThan(120);
      expect(durationSec).toBeLessThan(700);
      expect(pass.method).toBe('sgp4-js');
    }

    // Successive ISS passes are separated by roughly one orbital period.
    for (let i = 1; i < passes.length; i++) {
      const gapMin = (passes[i].aosUtcMs - passes[i - 1].aosUtcMs) / 60000;
      expect(gapMin).toBeGreaterThan(85);
      expect(gapMin).toBeLessThan(110);
    }
  });

  it('keeps satellites below the configured minimum elevation out of the results', async () => {
    const strict: GroundStation = { ...BERLIN, minimumElevationDeg: 60 };
    const passes = await predictPasses({
      startUtcMs: START,
      station: strict,
      positionAtUtc,
      method: 'sgp4-js',
      horizonMs: WINDOW_MS,
    });
    for (const pass of passes) {
      expect(pass.maxElevationDeg).toBeGreaterThanOrEqual(60);
    }
    // The 10-degree horizon sees strictly more passes than a 60-degree one.
    const permissive = await predictPasses({
      startUtcMs: START,
      station: BERLIN,
      positionAtUtc,
      method: 'sgp4-js',
      horizonMs: WINDOW_MS,
    });
    expect(permissive.length).toBeGreaterThan(passes.length);
  });
});
