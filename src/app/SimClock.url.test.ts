import { describe, expect, it } from 'vitest';
import { parseSimClockUrl, SIM_RATE_MAX } from './SimClock.js';

describe('parseSimClockUrl', () => {
  it('parses ISO time and rate params', () => {
    const result = parseSimClockUrl('?t=2024-12-22T12:00:00Z&rate=60');
    expect(result.simUtcMs).toBe(Date.parse('2024-12-22T12:00:00Z'));
    expect(result.rate).toBe(60);
  });

  it('rejects out-of-range rates', () => {
    expect(parseSimClockUrl('?rate=-1').rate).toBeNull();
    expect(parseSimClockUrl(`?rate=${SIM_RATE_MAX + 1}`).rate).toBeNull();
  });
});
