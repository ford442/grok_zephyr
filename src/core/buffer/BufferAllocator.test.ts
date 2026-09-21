import { describe, expect, it } from 'vitest';
import {
  MAX_SAFE_BUFFER_SIZE,
  TRAIL_HISTORY_FRAMES,
  TRAIL_MAX_RENDERED,
  TRAIL_MAX_SEGMENTS,
  TRAIL_MAX_TRACKED_SATS,
  TRAIL_VERTEX_STRIDE_FLOATS,
} from './bufferTypes.js';
import { calculateSatelliteBufferBudget, memoryUsageBytes } from './BufferAllocator.js';

const N = 1_048_576;
const MB = 1024 * 1024;

// Trail history + ribbon buffers are a fixed, budget-bounded strided subset
// of the fleet (see bufferTypes.ts), not per-satellite, so their size doesn't
// scale with N — mirrors the formula in BufferAllocator.ts's trail*Bytes().
const TRAIL_HISTORY_BYTES_ON = TRAIL_MAX_TRACKED_SATS * TRAIL_HISTORY_FRAMES * 16;
const TRAIL_VERTEX_BYTES_ON =
  TRAIL_MAX_RENDERED * TRAIL_MAX_SEGMENTS * 2 * TRAIL_VERTEX_STRIDE_FLOATS * 4;
const TRAIL_INDEX_BYTES_ON = TRAIL_MAX_RENDERED * TRAIL_MAX_SEGMENTS * 6 * 4;
const TRAIL_PARAMS_BYTES = 48;
const TRAIL_INDIRECT_BYTES = 32;
const TRAIL_COUNTERS_BYTES = 16;
const TRAIL_BYTES_ON =
  TRAIL_HISTORY_BYTES_ON +
  TRAIL_PARAMS_BYTES +
  TRAIL_VERTEX_BYTES_ON +
  TRAIL_INDEX_BYTES_ON +
  TRAIL_INDIRECT_BYTES +
  TRAIL_COUNTERS_BYTES;
const TRAIL_BYTES_OFF =
  16 + TRAIL_PARAMS_BYTES + TRAIL_VERTEX_STRIDE_FLOATS * 4 + 24 + TRAIL_INDIRECT_BYTES + TRAIL_COUNTERS_BYTES;

describe('calculateSatelliteBufferBudget', () => {
  it('fits the full total, uniforms included, under the Pascal cap at 1M (high)', () => {
    const { total, breakdown } = calculateSatelliteBufferBudget(N);
    expect(total).toBeLessThanOrEqual(MAX_SAFE_BUFFER_SIZE);
    expect(breakdown.uniforms).toBeGreaterThan(0);
    expect(breakdown.position).toBe(N * 16);
    expect(breakdown.extended).toBe(N * 32);
    expect(breakdown.animScratch).toBe(N * 4);
    // Off: still the tiny placeholder the orbital compute bind group needs.
    expect(breakdown.trails).toBe(TRAIL_BYTES_OFF);
    expect(breakdown.activeFrom).toBe(Math.ceil(N / 2) * 4);
    expect(Math.floor(total / MB)).toBe(84);
  });

  it('fits cinematic trail history at 1M with a fixed, fleet-size-independent budget', () => {
    const { total, breakdown } = calculateSatelliteBufferBudget(N, {
      doubleBuffer: false,
      trailHistory: true,
    });
    expect(breakdown.trails).toBe(TRAIL_BYTES_ON);
    // A bounded tracked subset, not 2 history frames × every satellite — far
    // below the old numSats-scaled allocation (~32 MB at 1M).
    expect(breakdown.trails).toBeLessThan(16 * 1024 * 1024);
    expect(total).toBeLessThanOrEqual(MAX_SAFE_BUFFER_SIZE);

    // Unchanged by fleet size: the tracked-satellite cap dominates, not N.
    const half = calculateSatelliteBufferBudget(N / 2, { doubleBuffer: false, trailHistory: true });
    expect(half.breakdown.trails).toBe(breakdown.trails);
  });

  it('doubleBuffer + trailHistory now both fit under the Pascal cap at 1M', () => {
    // The old per-satellite trail buffer (2 frames × every satellite, ~32 MB)
    // made this combination exceed 128 MB; the fixed, bounded trail budget
    // (~12 MB) removes that conflict.
    const on = calculateSatelliteBufferBudget(N, { doubleBuffer: true, trailHistory: true });
    expect(on.breakdown.position).toBe(N * 32);
    expect(on.total).toBeLessThanOrEqual(MAX_SAFE_BUFFER_SIZE);
  });

  it('is the ledger getMemoryUsage reports', () => {
    const config = { doubleBuffer: false, trailHistory: true, usage: 0 };
    const sizes = { numSatellites: N, position: N * 16, elements: N * 16, extended: N * 32 };
    expect(memoryUsageBytes(sizes, config, true)).toBe(
      calculateSatelliteBufferBudget(N, config).total,
    );
  });
});
