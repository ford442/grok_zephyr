import { describe, expect, it } from 'vitest';
import { MAX_SAFE_BUFFER_SIZE } from './bufferTypes.js';
import { calculateSatelliteBufferBudget, memoryUsageBytes } from './BufferAllocator.js';

const N = 1_048_576;
const MB = 1024 * 1024;

describe('calculateSatelliteBufferBudget', () => {
  it('fits the full total, uniforms included, under the Pascal cap at 1M (high)', () => {
    const { total, breakdown } = calculateSatelliteBufferBudget(N);
    expect(total).toBeLessThanOrEqual(MAX_SAFE_BUFFER_SIZE);
    expect(breakdown.uniforms).toBeGreaterThan(0);
    expect(breakdown.position).toBe(N * 16);
    expect(breakdown.extended).toBe(N * 32);
    expect(breakdown.animScratch).toBe(N * 4);
    expect(breakdown.trails).toBe(0);
    expect(breakdown.activeFrom).toBe(Math.ceil(N / 2) * 4);
    expect(Math.floor(total / MB)).toBe(84);
  });

  it('fits cinematic trail history at 1M', () => {
    const { total, breakdown } = calculateSatelliteBufferBudget(N, {
      doubleBuffer: false,
      trailHistory: true,
    });
    expect(breakdown.trails).toBe(N * 16 * 2);
    expect(total).toBeLessThanOrEqual(MAX_SAFE_BUFFER_SIZE);
  });

  it('counts ping-pong positions only when doubleBuffer is on, and rejects it with trails at 1M', () => {
    const on = calculateSatelliteBufferBudget(N, { doubleBuffer: true, trailHistory: true });
    expect(on.breakdown.position).toBe(N * 32);
    expect(on.total).toBeGreaterThan(MAX_SAFE_BUFFER_SIZE);
  });

  it('is the ledger getMemoryUsage reports', () => {
    const config = { doubleBuffer: false, trailHistory: true, usage: 0 };
    const sizes = { numSatellites: N, position: N * 16, elements: N * 16, extended: N * 32 };
    expect(memoryUsageBytes(sizes, config, true)).toBe(
      calculateSatelliteBufferBudget(N, config).total,
    );
  });
});
