import { readFile } from 'node:fs/promises';
import { describe, it, expect, beforeAll } from 'vitest';
import { TLELoader } from '@/data/TLELoader.js';
import { TlePropagator } from './TlePropagator.js';
import { runSgp4Benchmark } from './Sgp4Benchmark.js';

describe('Sgp4Benchmark', () => {
  let propagator: TlePropagator;

  beforeAll(async () => {
    const sample = await readFile('public/tle/starlink_sample.txt', 'utf8');
    const tles = TLELoader.parse(sample);
    propagator = new TlePropagator();
    propagator.load(tles);
    await propagator.initWasm();
  });

  it('reports WASM speedup over satellite.js for the sample catalog', async () => {
    if (!propagator.isWasmActive()) {
      return;
    }

    const result = await runSgp4Benchmark(propagator, Date.now(), 5);
    expect(result).not.toBeNull();
    expect(result!.speedup).toBeGreaterThan(1.5);
  });
});
