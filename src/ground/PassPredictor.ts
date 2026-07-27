import type { Vec3 } from '@/types/index.js';
import { elevationDeg, type GroundStation } from './GroundStation.js';

export type SatellitePassMethod = 'sgp4-wasm' | 'sgp4-js' | 'keplerian-approximate';
export interface SatellitePass { aosUtcMs: number; losUtcMs: number; maxUtcMs: number; maxElevationDeg: number; inProgress: boolean; method: SatellitePassMethod }
export interface PassPredictionOptions { startUtcMs: number; station: GroundStation; positionAtUtc: (utcMs: number) => Vec3 | null; method: SatellitePassMethod; signal?: AbortSignal; maxPasses?: number; horizonMs?: number }

const STEP_MS = 30000;
async function yieldTask(): Promise<void> { await new Promise<void>((resolve) => setTimeout(resolve, 0)); }

function refineCrossing(options: PassPredictionOptions, lo: number, hi: number, rising: boolean): number {
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    const pos = options.positionAtUtc(mid); if (!pos) break;
    const above = elevationDeg(options.station, pos, mid) >= options.station.minimumElevationDeg;
    if (above === rising) hi = mid; else lo = mid;
  }
  return Math.round(hi / 1000) * 1000;
}

function maximize(options: PassPredictionOptions, aos: number, los: number): { utcMs: number; elevation: number } {
  let lo = aos, hi = los;
  for (let i = 0; i < 24 && hi - lo > 1000; i++) {
    const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
    const pa = options.positionAtUtc(a), pb = options.positionAtUtc(b);
    if (!pa || !pb) break;
    if (elevationDeg(options.station, pa, a) < elevationDeg(options.station, pb, b)) lo = a; else hi = b;
  }
  const utcMs = Math.round((lo + hi) / 2000) * 1000;
  const pos = options.positionAtUtc(utcMs);
  return { utcMs, elevation: pos ? elevationDeg(options.station, pos, utcMs) : -90 };
}

export async function predictPasses(options: PassPredictionOptions): Promise<SatellitePass[]> {
  const results: SatellitePass[] = [];
  const end = options.startUtcMs + (options.horizonMs ?? 7 * 86400000);
  const maxPasses = options.maxPasses ?? 5;
  const elevationAt = (utcMs: number): number => { const p = options.positionAtUtc(utcMs); return p ? elevationDeg(options.station, p, utcMs) : -90; };
  let t = options.startUtcMs;
  let above = elevationAt(t) >= options.station.minimumElevationDeg;
  let aos: number | null = null;
  let inProgress = false;
  if (above) {
    inProgress = true; let back = t;
    while (back > options.startUtcMs - 86400000 && elevationAt(back) >= options.station.minimumElevationDeg) { back -= STEP_MS; }
    aos = refineCrossing(options, back, back + STEP_MS, true);
  }
  for (let sample = 0; t < end && results.length < maxPasses; sample++) {
    if (options.signal?.aborted) throw new DOMException('Pass prediction cancelled', 'AbortError');
    const next = Math.min(end, t + STEP_MS);
    const nextAbove = elevationAt(next) >= options.station.minimumElevationDeg;
    if (!above && nextAbove) aos = refineCrossing(options, t, next, true);
    if (above && !nextAbove && aos !== null) {
      const los = refineCrossing(options, t, next, false);
      const maximum = maximize(options, aos, los);
      results.push({ aosUtcMs: aos, losUtcMs: los, maxUtcMs: maximum.utcMs, maxElevationDeg: maximum.elevation, inProgress, method: options.method });
      aos = null; inProgress = false;
    }
    above = nextAbove; t = next;
    if (sample % 256 === 255) await yieldTask();
  }
  return results;
}
