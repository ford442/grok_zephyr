import {
  SGP4_REANCHOR_JUMP_SEC,
  parseSimClockUrl,
  type SimClockChangeKind,
} from '@/app/SimClock.js';
import type { AppRuntime } from '@/app/AppRuntime.js';

export function bindSimClock(rt: AppRuntime): void {
  rt.simulation.clock.subscribe((clock, kind, deltaSimSec) => {
    handleSgp4ReanchorOnJump(rt, kind, deltaSimSec);
    rt.ui.updateSimClock(clock);
  });
}

export function applySimClockFromUrl(rt: AppRuntime, search: string = window.location.search): void {
  const clock = rt.simulation.clock;
  const { simUtcMs, rate } = parseSimClockUrl(search);

  if (simUtcMs !== null) {
    clock.setSimUtc(simUtcMs, 'scrub');
  }
  if (rate !== null) {
    clock.setRate(rate);
  }
}

/** Anchor the clock to a TLE epoch and jump to wall-clock now unless ?t= overrides. */
export function syncSimClockFromTleEpoch(
  rt: AppRuntime,
  tleEpoch: Date | null,
  search: string = window.location.search,
): void {
  const clock = rt.simulation.clock;
  const { simUtcMs } = parseSimClockUrl(search);

  if (tleEpoch) {
    clock.setEpoch(tleEpoch.getTime());
  }
  if (simUtcMs === null) {
    clock.jumpToNow();
  }
}

function handleSgp4ReanchorOnJump(
  rt: AppRuntime,
  kind: SimClockChangeKind,
  deltaSimSec: number,
): void {
  if (kind === 'tick' || kind === 'rate') return;
  if (Math.abs(deltaSimSec) < SGP4_REANCHOR_JUMP_SEC) return;
  rt.buffers?.forceSgp4Reanchor(rt.simulation.clock.simTime);
}
