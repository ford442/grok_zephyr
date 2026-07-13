import { describe, it, expect } from 'vitest';
import { eciStateToKeplerian, EARTH_MU_KM3_S2 } from './keplerianFromState.js';
import { propagateKeplerian } from './keplerianPropagation.js';

describe('keplerianFromState', () => {
  it('round-trips a circular LEO orbit', () => {
    const a = 6921;
    const n = Math.sqrt(EARTH_MU_KM3_S2 / (a * a * a));
    const v = a * n;
    const state = eciStateToKeplerian({ x: a, y: 0, z: 0 }, { x: 0, y: v, z: 0 });
    expect(state.a).toBeCloseTo(a, 0);
    expect(state.e).toBeLessThan(0.01);

    const [x, y, z] = propagateKeplerian(state, 0);
    expect(Math.hypot(x, y, z)).toBeCloseTo(a, 0);
  });
});
