import { describe, expect, it, vi } from 'vitest';
import { SimClock, SIM_STEP_SEC } from './SimClock.js';

describe('SimClock', () => {
  it('advances sim time when playing', () => {
    const clock = new SimClock(1_000_000);
    clock.setRate(60);
    clock.tick(1);
    expect(clock.simTime).toBe(60);
  });

  it('does not advance while paused', () => {
    const clock = new SimClock(1_000_000);
    clock.setRate(0);
    clock.tick(1);
    expect(clock.simTime).toBe(0);
  });

  it('syncs simulated UTC to wall now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-12-22T12:00:00Z'));
    const clock = new SimClock(Date.parse('2024-12-20T00:00:00Z'));
    clock.jumpToNow();
    expect(clock.simUtc.toISOString()).toBe('2024-12-22T12:00:00.000Z');
    vi.useRealTimers();
  });

  it('steps by a fixed interval', () => {
    const clock = new SimClock();
    clock.stepSimTime(SIM_STEP_SEC);
    expect(clock.simTime).toBe(SIM_STEP_SEC);
  });

  it('notifies listeners on scrub', () => {
    const clock = new SimClock(0);
    const deltas: number[] = [];
    clock.subscribe((_c, _k, delta) => deltas.push(delta));
    clock.setSimTime(120, 'scrub');
    expect(deltas).toEqual([120]);
  });
});
