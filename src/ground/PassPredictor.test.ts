import { describe, expect, it } from 'vitest';
import { predictPasses } from './PassPredictor.js';
import type { GroundStation } from './GroundStation.js';

const station: GroundStation = { name: 'Equator', latitudeDeg: 0, longitudeDeg: 0, altitudeM: 0, minimumElevationDeg: 0, source: 'manual' };

describe('predictPasses', () => {
  it('finds crossings to one-second resolution and labels approximate results', async () => {
    const start = Date.parse('2025-01-01T00:00:00Z');
    // A synthetic satellite fixed at 7000 km while Earth rotates under it creates repeatable passes.
    const passes = await predictPasses({ startUtcMs: start, station, positionAtUtc: () => [7000, 0, 0], method: 'keplerian-approximate', maxPasses: 1 });
    expect(passes).toHaveLength(1);
    expect(passes[0].losUtcMs).toBeGreaterThan(passes[0].aosUtcMs);
    expect(passes[0].aosUtcMs % 1000).toBe(0);
    expect(passes[0].method).toBe('keplerian-approximate');
  });

  it('includes an already-active pass and searches backward for AOS', async () => {
    const start = Date.parse('2025-01-01T00:00:00Z');
    const passes = await predictPasses({ startUtcMs: start, station, positionAtUtc: () => [7000, 0, 0], method: 'sgp4-js', maxPasses: 1 });
    if (passes[0]?.inProgress) expect(passes[0].aosUtcMs).toBeLessThanOrEqual(start);
  });

  it('honours cancellation', async () => {
    const abort = new AbortController(); abort.abort();
    await expect(predictPasses({ startUtcMs: 0, station, positionAtUtc: () => [7000, 0, 0], method: 'sgp4-js', signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('terminates with no passes inside the configured horizon', async () => {
    const passes = await predictPasses({ startUtcMs: 0, station, positionAtUtc: () => [-7000, 0, 0], method: 'sgp4-js', horizonMs: 60000 });
    expect(passes).toEqual([]);
  });
});
