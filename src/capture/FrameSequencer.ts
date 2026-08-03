/**
 * Deterministic frame scheduling for offline capture.
 *
 * A realtime recorder (MediaRecorder over `captureStream`) samples whatever the
 * page happens to have drawn, so a dip in live FPS shows up as a dropped or
 * duplicated frame in the file. This module removes wall-clock time from the
 * equation: the exporter asks for frame N, gets the exact sim time and
 * presentation timestamp for frame N, renders it, and moves on. Encoding can
 * run slower or faster than realtime with no effect on the output.
 *
 * Every value is derived from the frame index rather than accumulated, so
 * timestamps cannot drift no matter how long the capture runs.
 */

export interface FrameScheduleOptions {
  /** Frames per second of the output file. */
  fps: number;
  durationSec: number;
  /** Sim time (seconds) that frame 0 renders at. */
  startSimTimeSec?: number;
  /** Sim seconds advanced per second of output. 1 = realtime playback. */
  simSecondsPerOutputSecond?: number;
}

export interface ScheduledFrame {
  index: number;
  /** Seconds into the capture; exact rational index/fps. */
  tourTimeSec: number;
  /** Sim time to render this frame at. */
  simTimeSec: number;
  /** Presentation timestamp in microseconds, for VideoEncoder/VideoFrame. */
  timestampUs: number;
}

const MICROSECONDS_PER_SECOND = 1_000_000;

function validate(options: FrameScheduleOptions): Required<FrameScheduleOptions> {
  const { fps, durationSec } = options;
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new RangeError('fps must be a positive, finite number.');
  }
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new RangeError('durationSec must be a positive, finite number.');
  }
  const startSimTimeSec = options.startSimTimeSec ?? 0;
  const simSecondsPerOutputSecond = options.simSecondsPerOutputSecond ?? 1;
  if (!Number.isFinite(startSimTimeSec)) {
    throw new RangeError('startSimTimeSec must be finite.');
  }
  if (!Number.isFinite(simSecondsPerOutputSecond)) {
    throw new RangeError('simSecondsPerOutputSecond must be finite.');
  }
  return { fps, durationSec, startSimTimeSec, simSecondsPerOutputSecond };
}

/**
 * Total frames in the capture.
 *
 * Rounded so that e.g. 10 s at 60 fps is exactly 600 frames rather than 599 or
 * 601 from floating-point error in `fps * durationSec`.
 */
export function frameCount(options: FrameScheduleOptions): number {
  const { fps, durationSec } = validate(options);
  return Math.max(1, Math.round(fps * durationSec));
}

/**
 * The schedule entry for a single frame.
 *
 * Derived purely from `index`, never from the previous frame, so repeated or
 * out-of-order calls always agree and long captures accumulate no drift.
 */
export function scheduleFrame(options: FrameScheduleOptions, index: number): ScheduledFrame {
  const { fps, startSimTimeSec, simSecondsPerOutputSecond } = validate(options);
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError('Frame index must be a non-negative integer.');
  }
  const tourTimeSec = index / fps;
  return {
    index,
    tourTimeSec,
    simTimeSec: startSimTimeSec + tourTimeSec * simSecondsPerOutputSecond,
    timestampUs: Math.round((index * MICROSECONDS_PER_SECOND) / fps),
  };
}

/** Every frame of the capture, in order. */
export function* iterateFrames(options: FrameScheduleOptions): Generator<ScheduledFrame> {
  const total = frameCount(options);
  for (let index = 0; index < total; index++) {
    yield scheduleFrame(options, index);
  }
}

export interface FrameSequencerHooks<T> {
  /** Advance the sim and draw one frame; returns whatever the encoder needs. */
  renderFrame: (frame: ScheduledFrame) => T | Promise<T>;
  /** Hand the rendered frame to the encoder. */
  encodeFrame: (rendered: T, frame: ScheduledFrame) => void | Promise<void>;
  onProgress?: (completed: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * Drive a full capture to completion, one scheduled frame at a time.
 *
 * Renders and encodes are awaited in sequence, so the loop naturally runs at
 * whatever rate the machine sustains -- the output timeline is fixed by the
 * schedule regardless. Resolves with the number of frames encoded.
 */
export async function runCapture<T>(
  options: FrameScheduleOptions,
  hooks: FrameSequencerHooks<T>,
): Promise<number> {
  const total = frameCount(options);
  let completed = 0;
  for (const frame of iterateFrames(options)) {
    if (hooks.signal?.aborted) {
      throw new DOMException('Capture cancelled', 'AbortError');
    }
    const rendered = await hooks.renderFrame(frame);
    await hooks.encodeFrame(rendered, frame);
    completed++;
    hooks.onProgress?.(completed, total);
  }
  return completed;
}
