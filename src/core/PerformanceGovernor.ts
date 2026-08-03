/**
 * Closed-loop quality control.
 *
 * Steps the quality ladder to hold a frame-time budget: drop quickly when the
 * frame is over budget, climb slowly and only with real headroom. Kept as a
 * pure state machine fed by frame-time samples -- no timers, no globals -- so
 * the convergence and stability behaviour can be simulated and asserted rather
 * than eyeballed on a device.
 *
 * The input is a frame time in milliseconds, whatever its source: GPU
 * timestamp-query totals where available, rAF deltas otherwise.
 */

import type { QualityLevel } from './QualityPresets.js';

/** Cheapest first. Index in this array is the governor's control variable. */
export const QUALITY_LADDER: readonly QualityLevel[] = ['low', 'balanced', 'high', 'cinematic'];

export type GovernorMode = 'auto' | 'manual';

export type QualityChangeReason = 'downshift' | 'upshift' | 'manual' | 'initial';

export interface QualityChange {
  from: QualityLevel;
  to: QualityLevel;
  reason: QualityChangeReason;
  /** Averaged frame time that triggered the change, in ms. */
  frameTimeMs: number;
}

export interface PerformanceGovernorOptions {
  /** Over this averaged frame time, quality steps down. 18ms ~= 55fps. */
  targetFrameTimeMs?: number;
  /**
   * Under this, quality may step up. The gap between this and the target is
   * the deadband -- the single most important anti-oscillation device, since a
   * level that lands between the two is left alone.
   */
  upshiftFrameTimeMs?: number;
  /** Sustained time over budget before stepping down. */
  downshiftSustainSec?: number;
  /** Sustained headroom before stepping up. Deliberately much longer. */
  upshiftSustainSec?: number;
  /** Quiet period after a downshift; short, so descent stays fast. */
  downshiftCooldownSec?: number;
  /** Quiet period after an upshift; long, so probing is rare. */
  upshiftCooldownSec?: number;
  /**
   * Each failed attempt at a level doubles the headroom it demands next time,
   * up to this many doublings. Without it, a device sitting near a boundary
   * would climb and fall forever.
   */
  maxUpshiftBackoff?: number;
  /** Ignore samples above this; a hitch is not a trend. */
  maxPlausibleFrameTimeMs?: number;
  /** Smoothing factor for the frame-time average, per sample. */
  smoothing?: number;
}

const DEFAULTS: Required<PerformanceGovernorOptions> = {
  targetFrameTimeMs: 18,
  upshiftFrameTimeMs: 13,
  downshiftSustainSec: 1.0,
  upshiftSustainSec: 4.0,
  downshiftCooldownSec: 0.5,
  upshiftCooldownSec: 3.0,
  maxUpshiftBackoff: 4,
  maxPlausibleFrameTimeMs: 500,
  smoothing: 0.15,
};

export type GovernorListener = (change: QualityChange) => void;

export interface GovernorSnapshot {
  mode: GovernorMode;
  level: QualityLevel;
  averageFrameTimeMs: number;
  overBudgetSec: number;
  headroomSec: number;
  cooldownRemainingSec: number;
  /** Backoff exponent per ladder index; grows each time a level fails. */
  upshiftPenalties: readonly number[];
}

export class PerformanceGovernor {
  private readonly options: Required<PerformanceGovernorOptions>;
  private readonly listeners = new Set<GovernorListener>();

  private mode: GovernorMode = 'auto';
  private index: number;
  private average = 0;
  private sampleCount = 0;
  private overBudgetSec = 0;
  private headroomSec = 0;
  private cooldownSec = 0;
  /** Per-level count of failed upshift attempts. */
  private penalties: number[];

  constructor(initialLevel: QualityLevel = 'high', options: PerformanceGovernorOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
    if (this.options.upshiftFrameTimeMs >= this.options.targetFrameTimeMs) {
      throw new RangeError(
        'upshiftFrameTimeMs must be below targetFrameTimeMs to leave a deadband.',
      );
    }
    this.index = Math.max(0, QUALITY_LADDER.indexOf(initialLevel));
    this.penalties = QUALITY_LADDER.map(() => 0);
  }

  get level(): QualityLevel {
    return QUALITY_LADDER[this.index];
  }

  get currentMode(): GovernorMode {
    return this.mode;
  }

  get averageFrameTimeMs(): number {
    return this.average;
  }

  subscribe(listener: GovernorListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Pin to a level and stop adapting. */
  setManual(level: QualityLevel): void {
    const index = QUALITY_LADDER.indexOf(level);
    if (index < 0) throw new RangeError(`Unknown quality level: ${level}`);
    const from = this.level;
    this.mode = 'manual';
    this.index = index;
    this.resetAccumulators();
    if (from !== level) {
      this.emit({ from, to: level, reason: 'manual', frameTimeMs: this.average });
    }
  }

  /** Hand control back to the governor, starting from the current level. */
  setAuto(): void {
    this.mode = 'auto';
    this.resetAccumulators();
    this.penalties = QUALITY_LADDER.map(() => 0);
  }

  /**
   * Feed one frame. Returns the new level if it changed, else null.
   *
   * `deltaSec` is the wall time this sample covers, so the sustain windows are
   * measured in seconds rather than in frames -- otherwise a slow device, which
   * produces fewer samples per second, would react more slowly than a fast one.
   */
  sample(frameTimeMs: number, deltaSec: number): QualityLevel | null {
    if (!Number.isFinite(frameTimeMs) || frameTimeMs <= 0) return null;
    if (!Number.isFinite(deltaSec) || deltaSec <= 0) return null;
    // A single stall (tab restore, shader compile) must not move the ladder.
    if (frameTimeMs > this.options.maxPlausibleFrameTimeMs) return null;

    this.sampleCount++;
    this.average =
      this.sampleCount === 1
        ? frameTimeMs
        : this.average + (frameTimeMs - this.average) * this.options.smoothing;

    if (this.mode === 'manual') return null;

    this.cooldownSec = Math.max(0, this.cooldownSec - deltaSec);

    const { targetFrameTimeMs, upshiftFrameTimeMs } = this.options;
    if (this.average > targetFrameTimeMs) {
      this.overBudgetSec += deltaSec;
      this.headroomSec = 0;
    } else if (this.average < upshiftFrameTimeMs) {
      this.headroomSec += deltaSec;
      this.overBudgetSec = 0;
    } else {
      // Inside the deadband: the current level is a good fit, so let both
      // accumulators decay rather than creeping toward a change.
      this.overBudgetSec = Math.max(0, this.overBudgetSec - deltaSec);
      this.headroomSec = Math.max(0, this.headroomSec - deltaSec);
    }

    if (this.cooldownSec > 0) return null;

    if (this.overBudgetSec >= this.options.downshiftSustainSec && this.index > 0) {
      // The level we are leaving just failed; make it harder to return to.
      this.penalties[this.index] = Math.min(
        this.options.maxUpshiftBackoff,
        this.penalties[this.index] + 1,
      );
      return this.step(-1, 'downshift');
    }

    if (this.index < QUALITY_LADDER.length - 1) {
      const required = this.options.upshiftSustainSec * 2 ** this.penalties[this.index + 1];
      if (this.headroomSec >= required) {
        return this.step(1, 'upshift');
      }
    }

    return null;
  }

  snapshot(): GovernorSnapshot {
    return {
      mode: this.mode,
      level: this.level,
      averageFrameTimeMs: this.average,
      overBudgetSec: this.overBudgetSec,
      headroomSec: this.headroomSec,
      cooldownRemainingSec: this.cooldownSec,
      upshiftPenalties: [...this.penalties],
    };
  }

  private step(direction: 1 | -1, reason: QualityChangeReason): QualityLevel {
    const from = this.level;
    this.index += direction;
    this.cooldownSec =
      direction === -1 ? this.options.downshiftCooldownSec : this.options.upshiftCooldownSec;
    this.overBudgetSec = 0;
    this.headroomSec = 0;
    const to = this.level;
    this.emit({ from, to, reason, frameTimeMs: this.average });
    return to;
  }

  private resetAccumulators(): void {
    this.overBudgetSec = 0;
    this.headroomSec = 0;
    this.cooldownSec = 0;
  }

  private emit(change: QualityChange): void {
    for (const listener of this.listeners) listener(change);
  }
}
