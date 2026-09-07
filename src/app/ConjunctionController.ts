/**
 * Close-approach visualization control — enable, threshold, quality policy.
 *
 * Mirrors IslController: a user override that survives quality changes, and a
 * quality rule that can force the feature off without destroying the user's
 * preference.
 *
 * This is a congestion *visualization*. Every label it produces says so; see
 * conjunctionDisclaimer() and docs/CONJUNCTIONS.md.
 */

import type { AppRuntime } from '@/app/AppRuntime.js';
import { getActiveFleetSize } from '@/core/FleetScale.js';
import { calculateSatelliteBufferBudget } from '@/core/buffer/BufferAllocator.js';
import {
  DEFAULT_CONJUNCTION_THRESHOLD_KM,
  MAX_CONJUNCTION_THRESHOLD_KM,
  MIN_CONJUNCTION_THRESHOLD_KM,
  conjunctionScanLimit,
} from '@/types/conjunction.js';

export interface ConjunctionUrlState {
  enabled: boolean | null;
  thresholdKm: number | null;
  density: boolean | null;
}

/**
 * `?ca=0|1` and `?caKm=<n>`. An out-of-range threshold is clamped rather than
 * ignored, so a deep link with `?caKm=99999` still shows something explicable.
 */
export function parseConjunctionParams(search: string): ConjunctionUrlState {
  const params = new URLSearchParams(search);

  const rawEnabled = params.get('ca')?.toLowerCase();
  let enabled: boolean | null = null;
  if (rawEnabled === '1' || rawEnabled === 'true' || rawEnabled === 'on') enabled = true;
  else if (rawEnabled === '0' || rawEnabled === 'false' || rawEnabled === 'off') enabled = false;

  const rawDensity = params.get('caDensity')?.toLowerCase();
  let density: boolean | null = null;
  if (rawDensity === '1' || rawDensity === 'true' || rawDensity === 'on') density = true;
  else if (rawDensity === '0' || rawDensity === 'false' || rawDensity === 'off') density = false;

  const rawKm = params.get('caKm');
  let thresholdKm: number | null = null;
  if (rawKm !== null && rawKm !== '') {
    const value = Number.parseFloat(rawKm);
    if (Number.isFinite(value)) thresholdKm = clampThreshold(value);
  }

  return { enabled, thresholdKm, density };
}

export function clampThreshold(km: number): number {
  return Math.min(MAX_CONJUNCTION_THRESHOLD_KM, Math.max(MIN_CONJUNCTION_THRESHOLD_KM, km));
}

/**
 * Wording for the panel. The distinction that matters: procedural shells make
 * the pair count a property of the art direction, while SGP4-anchored TLEs make
 * it a property of real orbits — and still not of operational screening.
 */
export function conjunctionDisclaimer(realism: boolean): string {
  return realism
    ? 'SGP4-anchored — not conjunction-grade: no covariance, no CDMs, TEME treated as GCRF (tens of arcseconds).'
    : 'Illustrative shell spacing — procedural orbits, not real objects.';
}

/** Short HUD suffix marking the frame caveat. */
export const CONJUNCTION_APPROXIMATE_LABEL = 'Approximate';

export function setConjunctionsEnabled(rt: AppRuntime, enabled: boolean): void {
  rt.simulation.conjunctionsEnabled = enabled;
  rt.simulation.conjunctionsUserOverride = enabled;
  applyConjunctionBuffers(rt);
  rt.ui.setConjunctionsEnabled(rt.simulation.conjunctionsEnabled);
}

export function setConjunctionDensityEnabled(rt: AppRuntime, enabled: boolean): void {
  rt.simulation.conjunctionDensityEnabled = enabled;
  rt.ui.setConjunctionDensityEnabled(enabled);
}

export function setConjunctionThresholdKm(rt: AppRuntime, km: number): void {
  rt.simulation.conjunctionThresholdKm = clampThreshold(km);
  rt.ui.setConjunctionThresholdKm(rt.simulation.conjunctionThresholdKm);
}

/**
 * Low quality and mobile force the feature off, exactly as ISL does, but a
 * user who explicitly turned it on keeps that preference for when quality
 * rises again.
 */
export function applyConjunctionsForQuality(rt: AppRuntime, qualityForcesOff: boolean): void {
  if (rt.simulation.conjunctionsUserOverride !== null) {
    rt.simulation.conjunctionsEnabled = qualityForcesOff
      ? false
      : rt.simulation.conjunctionsUserOverride;
  } else {
    rt.simulation.conjunctionsEnabled = false;
  }
  applyConjunctionBuffers(rt);
  rt.ui.setConjunctionsEnabled(rt.simulation.conjunctionsEnabled);
}

/**
 * Allocate or release the GPU buffers to match the current toggle. Allocation
 * can fail on a full buffer budget — at a 1M fleet the satellite buffers
 * already fill the 128 MB Pascal cap — in which case the feature turns itself
 * back off and records why.
 */
export function applyConjunctionBuffers(rt: AppRuntime): void {
  if (!rt.pipeline) return;

  if (!rt.simulation.conjunctionsEnabled) {
    rt.pipeline.releaseConjunctions();
    rt.simulation.conjunctionUnavailableReason = null;
    return;
  }

  const fleetSize = getActiveFleetSize();
  const satelliteBytes = calculateSatelliteBufferBudget(fleetSize).total;
  const result = rt.pipeline.prepareConjunctions(fleetSize, satelliteBytes);
  if (!result.ok) {
    rt.simulation.conjunctionsEnabled = false;
    rt.simulation.conjunctionUnavailableReason = result.reason ?? 'unavailable';
    console.warn(`[Conjunctions] disabled: ${rt.simulation.conjunctionUnavailableReason}`);
    return;
  }
  rt.simulation.conjunctionUnavailableReason = null;
}

/**
 * HUD line. Says how much of the fleet was actually scanned whenever that is
 * less than all of it, and flags a saturated hash table, so a small number is
 * never mistaken for a quiet sky.
 */
export function formatConjunctionStatus(state: {
  enabled: boolean;
  pairCount: number;
  overflow: number;
  truncated: boolean;
  fleetSize: number;
  unavailableReason: string | null;
}): string {
  if (state.unavailableReason) return `Close pairs: unavailable — ${state.unavailableReason}`;
  if (!state.enabled) return 'Close pairs: off';

  const scanned = conjunctionScanLimit(state.fleetSize);
  const parts = [`Close pairs: ${state.truncated ? '≥' : ''}${state.pairCount.toLocaleString()}`];
  if (scanned < state.fleetSize) {
    parts.push(`scanned ${scanned.toLocaleString()}/${state.fleetSize.toLocaleString()}`);
  }
  if (state.overflow > 0) {
    parts.push(`${state.overflow.toLocaleString()} dropped (dense cells)`);
  }
  parts.push(CONJUNCTION_APPROXIMATE_LABEL);
  return parts.join(' · ');
}

export const CONJUNCTION_DEFAULTS = {
  thresholdKm: DEFAULT_CONJUNCTION_THRESHOLD_KM,
};
