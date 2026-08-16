import type { AppRuntime } from '@/app/AppRuntime.js';
import type { TLEData } from '@/types/index.js';
import { getActiveFleetSize } from '@/core/FleetScale.js';
import { GrowthClock } from './GrowthClock.js';
import {
  buildProceduralSchedule,
  buildTleSchedule,
  countActiveOnOrBefore,
  formatEraLabel,
  parseEraParam,
  utcMsToGrowthDay,
} from './growthSchedule.js';

export const growthClock = new GrowthClock();

export function applyGrowthFromUrl(search: string = window.location.search): void {
  const era = parseEraParam(new URLSearchParams(search).get('era'));
  if (era === null) {
    growthClock.eraMs = growthClock.endMs;
    growthClock.enabled = true;
    growthClock.playing = false;
    return;
  }
  growthClock.enabled = true;
  growthClock.setEraMs(era);
}

export function rebuildGrowthSchedule(rt: AppRuntime, tles: readonly TLEData[]): void {
  const count = rt.buffers?.getOrbitalElementData().length
    ? Math.floor(rt.buffers.getOrbitalElementData().length / 4)
    : getActiveFleetSize();
  const days =
    tles.length > 0 ? buildTleSchedule(tles, count) : buildProceduralSchedule(count);
  rt.buffers?.setActiveFromDays(days);
  syncGrowthGpu(rt);
  updateGrowthHud(rt);
}

export function syncGrowthGpu(rt: AppRuntime): void {
  rt.buffers?.setGrowthEra(growthClock.enabled, utcMsToGrowthDay(growthClock.eraMs));
}

export function updateGrowthHud(rt: AppRuntime): void {
  const days = rt.buffers?.getActiveFromDays();
  if (!days || !growthClock.enabled) {
    rt.ui.setGrowthHud(null);
    return;
  }
  const n = countActiveOnOrBefore(days, utcMsToGrowthDay(growthClock.eraMs));
  rt.ui.setGrowthHud(`Active: ${n.toLocaleString()} — ${formatEraLabel(growthClock.eraMs)}`);
  rt.ui.setGrowthTransport(growthClock.progress, growthClock.playing);
}

export function tickGrowth(rt: AppRuntime, wallDeltaSec: number): void {
  if (!growthClock.tick(wallDeltaSec)) return;
  syncGrowthGpu(rt);
  updateGrowthHud(rt);
}

export function setGrowthProgress(rt: AppRuntime, t: number): void {
  growthClock.setProgress(t);
  syncGrowthGpu(rt);
  updateGrowthHud(rt);
}

export function toggleGrowthPlay(rt: AppRuntime): void {
  growthClock.playing = !growthClock.playing;
  if (growthClock.eraMs >= growthClock.endMs) {
    growthClock.eraMs = growthClock.startMs;
    growthClock.playing = true;
  }
  updateGrowthHud(rt);
}

export function bindGrowthTransport(rt: AppRuntime): void {
  const play = document.getElementById('growthPlay');
  const scrub = document.getElementById('growthScrub') as HTMLInputElement | null;
  play?.addEventListener('click', () => {
    toggleGrowthPlay(rt);
  });
  scrub?.addEventListener('input', () => {
    growthClock.playing = false;
    setGrowthProgress(rt, Number(scrub.value));
  });
  updateGrowthHud(rt);
}

export function growthCaptureLabel(): string | null {
  if (!growthClock.enabled || growthClock.eraMs >= growthClock.endMs) return null;
  return formatEraLabel(growthClock.eraMs);
}
