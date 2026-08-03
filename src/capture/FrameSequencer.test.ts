import { describe, expect, it, vi } from 'vitest';
import {
  frameCount,
  iterateFrames,
  runCapture,
  scheduleFrame,
  type ScheduledFrame,
} from './FrameSequencer.js';

describe('frameCount', () => {
  it('produces exactly fps * duration frames for a 10s 60fps capture', () => {
    // The headline acceptance case: no off-by-one from float error.
    expect(frameCount({ fps: 60, durationSec: 10 })).toBe(600);
    expect(frameCount({ fps: 30, durationSec: 5 })).toBe(150);
    expect(frameCount({ fps: 24, durationSec: 12.5 })).toBe(300);
  });

  it('rejects nonsensical parameters', () => {
    expect(() => frameCount({ fps: 0, durationSec: 10 })).toThrow(/fps/);
    expect(() => frameCount({ fps: -30, durationSec: 10 })).toThrow(/fps/);
    expect(() => frameCount({ fps: Number.NaN, durationSec: 10 })).toThrow(/fps/);
    expect(() => frameCount({ fps: 60, durationSec: 0 })).toThrow(/durationSec/);
    expect(() => frameCount({ fps: 60, durationSec: Number.POSITIVE_INFINITY })).toThrow(/durationSec/);
  });
});

describe('scheduleFrame', () => {
  const options = { fps: 60, durationSec: 10 };

  it('is a pure function of the frame index', () => {
    // Same index must always agree, in any order, however many times asked.
    const a = scheduleFrame(options, 317);
    const b = scheduleFrame(options, 317);
    expect(a).toEqual(b);
    scheduleFrame(options, 0);
    scheduleFrame(options, 599);
    expect(scheduleFrame(options, 317)).toEqual(a);
  });

  it('emits strictly increasing, drift-free timestamps', () => {
    const frames = [...iterateFrames(options)];
    expect(frames).toHaveLength(600);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].timestampUs).toBeGreaterThan(frames[i - 1].timestampUs);
    }
    // Derived from the index, so the last frame lands exactly where 60fps says.
    expect(frames[0].timestampUs).toBe(0);
    expect(frames[599].timestampUs).toBe(Math.round((599 * 1_000_000) / 60));
    // Accumulating 1/60 s in floats would have drifted well past a microsecond.
    expect(frames[599].tourTimeSec).toBeCloseTo(599 / 60, 12);
  });

  it('does not drift over a long capture', () => {
    const long = { fps: 60, durationSec: 3600 };
    const last = frameCount(long) - 1;
    expect(scheduleFrame(long, last).timestampUs).toBe(Math.round((last * 1_000_000) / 60));
    expect(scheduleFrame(long, last).tourTimeSec).toBeCloseTo(last / 60, 9);
  });

  it('advances sim time by exactly one frame interval', () => {
    const scaled = { fps: 60, durationSec: 10, startSimTimeSec: 1000, simSecondsPerOutputSecond: 60 };
    expect(scheduleFrame(scaled, 0).simTimeSec).toBe(1000);
    // 60 sim-seconds per output second, at 60fps => exactly 1 sim-second/frame.
    expect(scheduleFrame(scaled, 1).simTimeSec).toBeCloseTo(1001, 9);
    expect(scheduleFrame(scaled, 600).simTimeSec).toBeCloseTo(1600, 6);
  });

  it('rejects invalid indices', () => {
    expect(() => scheduleFrame(options, -1)).toThrow(/index/);
    expect(() => scheduleFrame(options, 1.5)).toThrow(/index/);
  });
});

describe('runCapture', () => {
  const options = { fps: 30, durationSec: 2 };

  it('renders and encodes every frame exactly once, in order', async () => {
    const encoded: ScheduledFrame[] = [];
    const total = await runCapture(options, {
      renderFrame: (frame) => frame.index,
      encodeFrame: (rendered, frame) => {
        expect(rendered).toBe(frame.index);
        encoded.push(frame);
      },
    });

    expect(total).toBe(60);
    expect(encoded).toHaveLength(60);
    expect(encoded.map((f) => f.index)).toEqual([...Array(60).keys()]);
    // No duplicates and no gaps -- the acceptance criterion, restated.
    expect(new Set(encoded.map((f) => f.timestampUs)).size).toBe(60);
  });

  it('is unaffected by how slow rendering is', async () => {
    // Renders resolve on wildly varying delays; the schedule must not care.
    const slow = await runCapture(options, {
      renderFrame: async (frame) => {
        await new Promise((resolve) => setTimeout(resolve, frame.index % 3));
        return frame.index;
      },
      encodeFrame: () => undefined,
    });
    const fast = [...iterateFrames(options)];
    expect(slow).toBe(fast.length);
  });

  it('reports progress and honours cancellation', async () => {
    const onProgress = vi.fn();
    await runCapture(options, {
      renderFrame: () => 0,
      encodeFrame: () => undefined,
      onProgress,
    });
    expect(onProgress).toHaveBeenCalledTimes(60);
    expect(onProgress).toHaveBeenLastCalledWith(60, 60);

    const abort = new AbortController();
    abort.abort();
    await expect(
      runCapture(options, {
        renderFrame: () => 0,
        encodeFrame: () => undefined,
        signal: abort.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('stops partway when aborted mid-capture', async () => {
    const abort = new AbortController();
    let rendered = 0;
    await expect(
      runCapture(options, {
        renderFrame: (frame) => {
          rendered++;
          if (frame.index === 9) abort.abort();
          return frame.index;
        },
        encodeFrame: () => undefined,
        signal: abort.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(rendered).toBe(10);
  });
});
