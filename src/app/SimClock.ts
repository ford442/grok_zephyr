/**
 * Canonical simulation clock.
 *
 * `epoch` + `simTime` define the simulated UTC instant. Keplerian GPU propagation
 * is a pure function of `simTime`, so scrubbing is smooth. SGP4-anchored realism
 * re-builds osculating elements when sim time jumps by more than
 * `SGP4_REANCHOR_JUMP_SEC` (see SatelliteGPUBuffer.forceSgp4Reanchor).
 */

export const SGP4_REANCHOR_JUMP_SEC = 60;
export const SIM_RATE_MAX = 10_000;
export const SIM_STEP_SEC = 60;
export const TIMELINE_HALF_RANGE_MS = 12 * 60 * 60 * 1000;

export const SIM_RATE_PRESETS = [1, 60, 600, 6000] as const;

export type SimClockChangeKind = 'tick' | 'scrub' | 'rate' | 'epoch' | 'now' | 'step';

export type SimClockListener = (
  clock: SimClock,
  kind: SimClockChangeKind,
  deltaSimSec: number,
) => void;

export class SimClock {
  /** UTC epoch (ms) corresponding to simTime === 0. */
  private epochMs: number;
  private simTimeSec = 0;
  private rateMultiplier = 1;
  private resumeRate = 1;
  private readonly listeners = new Set<SimClockListener>();

  constructor(epochMs: number = Date.now()) {
    this.epochMs = epochMs;
  }

  get epoch(): Date {
    return new Date(this.epochMs);
  }

  get epochTimeMs(): number {
    return this.epochMs;
  }

  get simTime(): number {
    return this.simTimeSec;
  }

  get rate(): number {
    return this.rateMultiplier;
  }

  get simUtcMs(): number {
    return this.epochMs + this.simTimeSec * 1000;
  }

  get simUtc(): Date {
    return new Date(this.simUtcMs);
  }

  isPaused(): boolean {
    return this.rateMultiplier === 0;
  }

  subscribe(listener: SimClockListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  tick(wallDeltaSec: number): void {
    if (this.rateMultiplier <= 0 || wallDeltaSec <= 0) return;
    const prev = this.simTimeSec;
    this.simTimeSec += wallDeltaSec * this.rateMultiplier;
    this.emit('tick', this.simTimeSec - prev);
  }

  setEpoch(epochMs: number): void {
    this.epochMs = epochMs;
    this.emit('epoch', 0);
  }

  setSimTime(seconds: number, kind: SimClockChangeKind = 'scrub'): void {
    const delta = seconds - this.simTimeSec;
    if (delta === 0) return;
    this.simTimeSec = seconds;
    this.emit(kind, delta);
  }

  setSimUtc(utcMs: number, kind: SimClockChangeKind = 'scrub'): void {
    this.setSimTime((utcMs - this.epochMs) / 1000, kind);
  }

  jumpToNow(): void {
    this.setSimUtc(Date.now(), 'now');
  }

  stepSimTime(deltaSec: number): void {
    this.setSimTime(this.simTimeSec + deltaSec, 'step');
  }

  setRate(rate: number): void {
    const clamped = Math.max(0, Math.min(SIM_RATE_MAX, rate));
    if (clamped === this.rateMultiplier) return;
    if (clamped > 0) {
      this.resumeRate = clamped;
    }
    this.rateMultiplier = clamped;
    this.emit('rate', 0);
  }

  togglePause(): void {
    if (this.rateMultiplier === 0) {
      this.setRate(this.resumeRate > 0 ? this.resumeRate : 1);
    } else {
      this.resumeRate = this.rateMultiplier;
      this.setRate(0);
    }
  }

  private emit(kind: SimClockChangeKind, deltaSimSec: number): void {
    for (const listener of this.listeners) {
      listener(this, kind, deltaSimSec);
    }
  }
}

export function formatSimUtc(date: Date): string {
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

export function formatSimRate(rate: number): string {
  if (rate === 0) return 'PAUSED';
  if (rate >= 1000) return `${(rate / 1000).toFixed(rate % 1000 === 0 ? 0 : 1)}k×`;
  return `${rate}×`;
}

export function parseSimClockUrl(
  search: string = window.location.search,
): { simUtcMs: number | null; rate: number | null } {
  const params = new URLSearchParams(search);
  const rawTime = params.get('t');
  let simUtcMs: number | null = null;
  if (rawTime) {
    const parsed = Date.parse(rawTime);
    if (Number.isFinite(parsed)) {
      simUtcMs = parsed;
    }
  }

  const rawRate = params.get('rate');
  let rate: number | null = null;
  if (rawRate !== null && rawRate !== '') {
    const parsed = Number(rawRate);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= SIM_RATE_MAX) {
      rate = parsed;
    }
  }

  return { simUtcMs, rate };
}
