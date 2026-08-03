import { describe, expect, it, vi } from 'vitest';
import {
  PerformanceGovernor,
  QUALITY_LADDER,

  type QualityChange,
} from './PerformanceGovernor.js';
import type { QualityLevel } from './QualityPresets.js';

/** Frame time each quality level costs on a simulated device. */
type DeviceProfile = Record<QualityLevel, number>;

/** An iGPU: only the bottom of the ladder fits in budget. */
const THROTTLED: DeviceProfile = { low: 9, balanced: 15.5, high: 28, cinematic: 42 };
/** A 4090: everything is cheap. */
const FAST: DeviceProfile = { low: 3, balanced: 4.5, high: 7, cinematic: 10 };
/** Pathological: even the cheapest level misses budget. */
const HOPELESS: DeviceProfile = { low: 30, balanced: 48, high: 70, cinematic: 96 };

interface RunResult {
  elapsedSec: number;
  changes: QualityChange[];
  /** Level at the end of each simulated second. */
  timeline: QualityLevel[];
}

/**
 * Drive the governor with a device's real frame times, feeding back the level
 * it selects -- a closed loop, not a fixed trace.
 */
function run(
  governor: PerformanceGovernor,
  device: DeviceProfile,
  seconds: number,
  jitter = 0,
): RunResult {
  const changes: QualityChange[] = [];
  governor.subscribe((change) => changes.push(change));

  const timeline: QualityLevel[] = [];
  let elapsed = 0;
  let nextMark = 1;
  // Deterministic pseudo-jitter, so a failure is always reproducible.
  let seed = 12345;
  const noise = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return ((seed / 0x7fffffff) * 2 - 1) * jitter;
  };

  while (elapsed < seconds) {
    const frameMs = device[governor.level] + noise();
    const deltaSec = frameMs / 1000;
    governor.sample(frameMs, deltaSec);
    elapsed += deltaSec;
    while (nextMark <= elapsed && timeline.length < seconds) {
      timeline.push(governor.level);
      nextMark++;
    }
  }
  return { elapsedSec: elapsed, changes, timeline };
}

/** Seconds until the governor first reaches a level that holds the target. */
function convergenceSec(
  governor: PerformanceGovernor,
  device: DeviceProfile,
  targetFps: number,
  limitSec: number,
): number | null {
  const budgetMs = 1000 / targetFps;
  let elapsed = 0;
  while (elapsed < limitSec) {
    const frameMs = device[governor.level];
    if (frameMs <= budgetMs) return elapsed;
    const deltaSec = frameMs / 1000;
    governor.sample(frameMs, deltaSec);
    elapsed += deltaSec;
  }
  return null;
}

describe('PerformanceGovernor — acceptance criteria', () => {
  it('converges to >= 50 FPS within 10 seconds on a throttled GPU', () => {
    // Starts at cinematic (42ms ~= 24fps) and must find its way down unaided.
    const governor = new PerformanceGovernor('cinematic');
    const reachedAt = convergenceSec(governor, THROTTLED, 50, 10);

    expect(reachedAt).not.toBeNull();
    expect(reachedAt!).toBeLessThan(10);
    // balanced is 15.5ms ~= 64fps, comfortably past the 50fps bar.
    expect(governor.level).toBe('balanced');
  });

  it('does not oscillate once settled', () => {
    const governor = new PerformanceGovernor('cinematic');
    const { changes, timeline } = run(governor, THROTTLED, 120);

    // Descent is monotonic: cinematic -> high -> balanced, then nothing.
    expect(changes.map((c) => c.to)).toEqual(['high', 'balanced']);
    expect(changes.every((c) => c.reason === 'downshift')).toBe(true);
    // Two full minutes with no further movement.
    expect(new Set(timeline.slice(10))).toEqual(new Set(['balanced']));
  });

  it('does not oscillate on a device sitting right at the boundary', () => {
    // balanced lands inside the deadband (13 < 17.5 < 18) and high is just
    // over: the classic flapping setup.
    const boundary: DeviceProfile = { low: 8, balanced: 17.5, high: 18.4, cinematic: 25 };
    const governor = new PerformanceGovernor('high');
    const { changes } = run(governor, boundary, 300);

    expect(governor.level).toBe('balanced');
    // One decisive move, not a cycle.
    expect(changes).toHaveLength(1);
  });

  it('survives noisy frame times without thrashing', () => {
    const governor = new PerformanceGovernor('cinematic');
    const { changes } = run(governor, THROTTLED, 180, 3.5);

    expect(governor.level).toBe('balanced');
    // Some extra probing is tolerable; a flapping loop is not.
    expect(changes.length).toBeLessThanOrEqual(4);
  });

  it('manual selection fully disables the governor', () => {
    const governor = new PerformanceGovernor('cinematic');
    governor.setManual('cinematic');
    const { changes } = run(governor, THROTTLED, 120);

    // Pinned to a level this device cannot sustain, and left there.
    expect(governor.level).toBe('cinematic');
    expect(changes).toHaveLength(0);
  });

  it('resumes adapting when returned to auto', () => {
    const governor = new PerformanceGovernor('cinematic');
    governor.setManual('cinematic');
    run(governor, THROTTLED, 30);
    expect(governor.level).toBe('cinematic');

    governor.setAuto();
    run(governor, THROTTLED, 60);
    expect(governor.level).toBe('balanced');
  });
});

describe('PerformanceGovernor — climbing', () => {
  it('climbs to the top of the ladder on a fast GPU', () => {
    const governor = new PerformanceGovernor('low');
    const { changes } = run(governor, FAST, 120);

    expect(governor.level).toBe('cinematic');
    expect(changes.every((c) => c.reason === 'upshift')).toBe(true);
    expect(changes.map((c) => c.to)).toEqual(['balanced', 'high', 'cinematic']);
  });

  it('climbs cautiously — measurably slower than it drops', () => {
    /** Wall-clock seconds until the governor first changes level. */
    const timeToFirstChange = (
      governor: PerformanceGovernor,
      device: DeviceProfile,
    ): number => {
      let elapsed = 0;
      let at: number | null = null;
      governor.subscribe(() => {
        at ??= elapsed;
      });
      while (elapsed < 60 && at === null) {
        const frameMs = device[governor.level];
        governor.sample(frameMs, frameMs / 1000);
        elapsed += frameMs / 1000;
      }
      return at ?? Number.POSITIVE_INFINITY;
    };

    const downshiftSec = timeToFirstChange(new PerformanceGovernor('cinematic'), THROTTLED);
    const upshiftSec = timeToFirstChange(new PerformanceGovernor('low'), FAST);

    // React fast to pain, slow to comfort — at least 3x more patient climbing.
    expect(downshiftSec).toBeLessThan(1.5);
    expect(upshiftSec).toBeGreaterThan(downshiftSec * 3);
  });

  it('backs off from a level that keeps failing', () => {
    // Cheap enough to tempt an upshift, too slow to hold it.
    const marginal: DeviceProfile = { low: 12.5, balanced: 21, high: 30, cinematic: 40 };
    const governor = new PerformanceGovernor('low');
    run(governor, marginal, 200);

    const snapshot = governor.snapshot();
    expect(snapshot.level).toBe('low');
    // Each failed attempt at 'balanced' raises the bar for retrying it.
    expect(snapshot.upshiftPenalties[1]).toBeGreaterThan(0);
  });

  it('settles at the bottom when nothing fits, without churning', () => {
    const governor = new PerformanceGovernor('cinematic');
    const { changes } = run(governor, HOPELESS, 120);

    expect(governor.level).toBe('low');
    // Exactly one step per rung down, then it stops trying.
    expect(changes.map((c) => c.to)).toEqual(['high', 'balanced', 'low']);
  });
});

describe('PerformanceGovernor — input handling', () => {
  it('ignores hitches rather than treating them as a trend', () => {
    const governor = new PerformanceGovernor('high');
    for (let i = 0; i < 60; i++) governor.sample(10, 0.01);
    const before = governor.averageFrameTimeMs;

    // A 2-second stall: tab restore, shader compile.
    expect(governor.sample(2000, 2)).toBeNull();
    expect(governor.averageFrameTimeMs).toBe(before);
    expect(governor.level).toBe('high');
  });

  it('rejects malformed samples', () => {
    const governor = new PerformanceGovernor('high');
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(governor.sample(bad, 0.016)).toBeNull();
    }
    expect(governor.sample(16, 0)).toBeNull();
    expect(governor.sample(16, Number.NaN)).toBeNull();
  });

  it('measures sustain in seconds, so slow devices are not penalised twice', () => {
    // Same wall time, wildly different sample counts.
    const coarse = new PerformanceGovernor('cinematic');
    let coarseElapsed = 0;
    while (coarseElapsed < 3 && coarse.level === 'cinematic') {
      coarse.sample(50, 0.05);
      coarseElapsed += 0.05;
    }

    const fine = new PerformanceGovernor('cinematic');
    let fineElapsed = 0;
    while (fineElapsed < 3 && fine.level === 'cinematic') {
      fine.sample(50, 0.005);
      fineElapsed += 0.005;
    }

    // Both step down at about the same wall-clock moment.
    expect(Math.abs(coarseElapsed - fineElapsed)).toBeLessThan(0.5);
  });

  it('notifies subscribers and stops after unsubscribe', () => {
    const governor = new PerformanceGovernor('cinematic');
    const listener = vi.fn();
    const unsubscribe = governor.subscribe(listener);

    run(governor, THROTTLED, 20);
    expect(listener).toHaveBeenCalled();
    const callCount = listener.mock.calls.length;
    const change = listener.mock.calls[0][0] as QualityChange;
    expect(change.from).toBe('cinematic');
    expect(change.to).toBe('high');
    expect(change.frameTimeMs).toBeGreaterThan(0);

    unsubscribe();
    run(governor, FAST, 60);
    expect(listener).toHaveBeenCalledTimes(callCount);
  });

  it('requires a deadband between the two thresholds', () => {
    expect(
      () => new PerformanceGovernor('high', { targetFrameTimeMs: 16, upshiftFrameTimeMs: 16 }),
    ).toThrow(/deadband/);
    expect(
      () => new PerformanceGovernor('high', { targetFrameTimeMs: 16, upshiftFrameTimeMs: 20 }),
    ).toThrow(/deadband/);
  });

  it('rejects unknown manual levels and exposes the ladder cheapest-first', () => {
    const governor = new PerformanceGovernor('high');
    expect(() => governor.setManual('ultra' as QualityLevel)).toThrow(/Unknown quality level/);
    expect(QUALITY_LADDER).toEqual(['low', 'balanced', 'high', 'cinematic']);
  });
});
