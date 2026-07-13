/**
 * Benchmark WASM vs satellite.js batch SGP4 propagation.
 */

import type { TlePropagator } from './TlePropagator.js';

export interface Sgp4BenchmarkResult {
  catalogCount: number;
  jsMs: number;
  wasmMs: number;
  speedup: number;
  activeBackend: 'wasm' | 'js';
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Run paired JS/WASM full-catalog propagation benchmarks. */
export async function runSgp4Benchmark(
  propagator: TlePropagator,
  dateMs: number,
  iterations = 3,
): Promise<Sgp4BenchmarkResult | null> {
  const catalogCount = propagator.count;
  if (catalogCount === 0) {
    return null;
  }

  await propagator.initWasm();

  const jsSamples: number[] = [];
  const wasmSamples: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const jsStart = performance.now();
    propagator.propagateBatchEci(dateMs, 0, catalogCount, 'js');
    jsSamples.push(performance.now() - jsStart);

    if (propagator.isWasmActive()) {
      const wasmStart = performance.now();
      propagator.propagateBatchEci(dateMs, 0, catalogCount, 'wasm');
      wasmSamples.push(performance.now() - wasmStart);
    }
  }

  const jsMs = median(jsSamples);
  const wasmMs = wasmSamples.length > 0 ? median(wasmSamples) : jsMs;
  const speedup = wasmMs > 0 ? jsMs / wasmMs : 1;

  return {
    catalogCount,
    jsMs,
    wasmMs,
    speedup,
    activeBackend: propagator.isWasmActive() ? 'wasm' : 'js',
  };
}
