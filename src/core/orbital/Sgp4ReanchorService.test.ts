import { describe, expect, it } from 'vitest';
import type { KeplerianState } from '@/physics/index.js';
import { OrbitalDataStore } from './OrbitalDataStore.js';
import {
  REANCHOR_CHUNK_SIZE,
  REANCHOR_INTERVAL_SIM_SEC,
  Sgp4ReanchorService,
  type KeplerianBatchPropagator,
} from './Sgp4ReanchorService.js';

function fakeState(): KeplerianState {
  return { a: 7000, e: 0.001, inc: 0.9, raan: 0.2, argp: 0.1, M0: 0.3, n: 0.001 };
}

function fakePropagator(calls: number[]): KeplerianBatchPropagator {
  return {
    load: (tles) => tles.length,
    initWasm: async () => undefined,
    applyKeplerianBatch(_dateMs, start, count, write) {
      calls.push(count);
      for (let i = 0; i < count; i++) {
        write(start + i, fakeState());
      }
    },
  };
}

describe('Sgp4ReanchorService', () => {
  it('chunks re-anchor and waits for the interval after a full pass', () => {
    const store = new OrbitalDataStore(2048);
    store.orbital.generate(1);
    const sgp4 = new Sgp4ReanchorService(store);
    const calls: number[] = [];
    sgp4.propagator = fakePropagator(calls);
    sgp4.tleRealCount = 1200;
    sgp4.realismEnabled = true;
    sgp4.reanchorCursor = 1200;
    sgp4.lastReanchorCycleSimTime = 0;

    expect(sgp4.tick(10)).toBeNull();
    expect(calls).toEqual([]);

    const first = sgp4.tick(REANCHOR_INTERVAL_SIM_SEC);
    expect(first).toEqual({ start: 0, end: REANCHOR_CHUNK_SIZE });
    expect(sgp4.reanchorCursor).toBe(REANCHOR_CHUNK_SIZE);

    const second = sgp4.tick(REANCHOR_INTERVAL_SIM_SEC);
    expect(second).toEqual({ start: REANCHOR_CHUNK_SIZE, end: REANCHOR_CHUNK_SIZE * 2 });

    const third = sgp4.tick(REANCHOR_INTERVAL_SIM_SEC);
    expect(third).toEqual({ start: REANCHOR_CHUNK_SIZE * 2, end: 1200 });
    expect(sgp4.reanchorCursor).toBe(1200);

    expect(sgp4.tick(REANCHOR_INTERVAL_SIM_SEC + 1)).toBeNull();
    const wrap = sgp4.tick(REANCHOR_INTERVAL_SIM_SEC * 2);
    expect(wrap).toEqual({ start: 0, end: REANCHOR_CHUNK_SIZE });
  });

  it('force wraps the cursor to the catalog end', () => {
    const store = new OrbitalDataStore(256);
    store.orbital.generate(1);
    const sgp4 = new Sgp4ReanchorService(store);
    sgp4.propagator = fakePropagator([]);
    sgp4.tleRealCount = 100;
    sgp4.realismEnabled = true;
    sgp4.reanchorCursor = 10;
    expect(sgp4.force(50)).toBe(true);
    expect(sgp4.reanchorCursor).toBe(100);
    expect(sgp4.lastReanchorCycleSimTime).toBe(50);
  });

  it('tick is a no-op without realism or catalog', () => {
    const store = new OrbitalDataStore(64);
    const sgp4 = new Sgp4ReanchorService(store);
    expect(sgp4.tick(1000)).toBeNull();
    sgp4.realismEnabled = true;
    expect(sgp4.tick(1000)).toBeNull();
  });
});
