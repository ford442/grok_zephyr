import { describe, expect, it } from 'vitest';
import { MAX_SAFE_BUFFER_SIZE } from './bufferTypes.js';
import { calculateSatelliteBufferBudget } from './BufferAllocator.js';

describe('calculateSatelliteBufferBudget', () => {
  it('stays under the Pascal 128 MB cap for 1,048,576 satellites', () => {
    const { total, breakdown } = calculateSatelliteBufferBudget(1_048_576);
    expect(total - breakdown.uniforms).toBeLessThanOrEqual(MAX_SAFE_BUFFER_SIZE);
    expect(breakdown.position).toBe(1_048_576 * 16);
    expect(breakdown.extended).toBe(1_048_576 * 32);
    expect(breakdown.trails).toBe(1_048_576 * 16 * 2);
    expect(total / 1024 / 1024).toBeGreaterThan(100);
    expect(total / 1024 / 1024).toBeLessThan(128.01);
  });
});
