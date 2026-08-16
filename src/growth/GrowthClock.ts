/**
 * Launch-era clock, independent of SimClock so pause/time-warp do not fight growth play.
 */

import { clampEraMs, GROWTH_END_MS, GROWTH_START_MS } from './growthSchedule.js';

export const GROWTH_PLAY_MONTHS_PER_SEC = 4;

export class GrowthClock {
  startMs = GROWTH_START_MS;
  endMs = GROWTH_END_MS;
  eraMs = GROWTH_END_MS;
  playing = false;
  enabled = true;

  get spanMs(): number {
    return this.endMs - this.startMs;
  }

  get progress(): number {
    if (this.spanMs <= 0) return 1;
    return (this.eraMs - this.startMs) / this.spanMs;
  }

  setProgress(t: number): void {
    const u = Math.min(1, Math.max(0, t));
    this.eraMs = this.startMs + u * this.spanMs;
    if (u >= 1) this.playing = false;
  }

  setEraMs(utcMs: number): void {
    this.eraMs = clampEraMs(utcMs);
    if (this.eraMs >= this.endMs) this.playing = false;
  }

  tick(wallDeltaSec: number): boolean {
    if (!this.playing || wallDeltaSec <= 0) return false;
    const deltaMs = wallDeltaSec * GROWTH_PLAY_MONTHS_PER_SEC * (30.4375 * 86400000);
    this.eraMs = Math.min(this.endMs, this.eraMs + deltaMs);
    if (this.eraMs >= this.endMs) {
      this.playing = false;
    }
    return true;
  }
}
