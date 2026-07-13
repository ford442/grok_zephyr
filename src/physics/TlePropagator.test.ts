import { describe, it, expect } from 'vitest';
import { TLELoader } from '@/data/TLELoader.js';
import { TlePropagator } from './TlePropagator.js';
import { propagateKeplerian } from './keplerianPropagation.js';

const SAMPLE_TLE = `STARLINK-1007
1 44713U 19074A   24356.50000000  .00001256  00000-0  11371-3 0  9991
2 44713  53.0000  85.0000 0001000  50.0000 310.0000 15.06397611123456
`;

describe('TlePropagator', () => {
  it('propagates sample Starlink TLEs via SGP4', () => {
    const tles = TLELoader.parse(SAMPLE_TLE);
    expect(tles.length).toBe(1);

    const propagator = new TlePropagator();
    const count = propagator.load(tles);
    expect(count).toBe(1);

    const pos = propagator.propagatePositionEci(0, Date.now());
    expect(pos).not.toBeNull();
    const r = Math.hypot(pos![0], pos![1], pos![2]);
    expect(r).toBeGreaterThan(6400);
    expect(r).toBeLessThan(8000);
  });

  it('derives Keplerian elements that reproduce SGP4 position at anchor time', () => {
    const tles = TLELoader.parse(SAMPLE_TLE);
    const propagator = new TlePropagator();
    propagator.load(tles);

    const dateMs = Date.now();
    const sgp4 = propagator.propagatePositionEci(0, dateMs);
    const kepler = propagator.keplerianAt(0, dateMs);
    expect(sgp4).not.toBeNull();
    expect(kepler).not.toBeNull();

    const [kx, ky, kz] = propagateKeplerian(kepler!, 0);
    const kr = Math.hypot(kx, ky, kz);
    const sr = Math.hypot(sgp4![0], sgp4![1], sgp4![2]);
    expect(Math.abs(kr - sr)).toBeLessThan(5);
  });
});
