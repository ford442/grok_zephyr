import { parseQualityParam, type QualityLevel } from '@/core/QualityPresets.js';
import { parseVisualHarnessParams, type VisualHarnessParams } from '@/visualHarness.js';
import { applySimClockFromUrl } from '@/app/SimClockController.js';
import type { AppRuntime } from '@/app/AppRuntime.js';

export interface InitialUrlState {
  viewMode: number | null;
  qualityLevel: QualityLevel | null;
  physicsMode: number | null;
  patternMode: number | null;
  animationMode: number | null;
  realismMode: boolean | null;
}

/**
 * Parse initial-state URL parameters for the application.
 *
 * Supported params:
 *   ?mode=0-5            view mode index
 *   ?preset=low|balanced|high|cinematic   quality preset
 *   ?physics=0-2         physics mode
 *   ?pattern=0-2         beam pattern mode
 *   ?animation=3-5       constellation animation pattern (smile/rain/heartbeat)
 *   ?realism=0|1         SGP4 catalog vs art-directed shells (requires ?tle=)
 *   ?t=ISO8601           initial simulated UTC (shareable moment)
 *   ?rate=<n>            sim rate multiplier (0 = paused, up to 10000)
 */
export function parseInitialStateFromURL(search: string = window.location.search): InitialUrlState {
  const params = new URLSearchParams(search);

  const parseIntParam = (key: string, min: number, max: number): number | null => {
    const raw = params.get(key);
    if (!raw) return null;
    const val = parseInt(raw, 10);
    if (isNaN(val) || val < min || val > max) return null;
    return val;
  };

  const parseBoolParam = (key: string): boolean | null => {
    const raw = params.get(key)?.toLowerCase();
    if (raw === null || raw === '') return null;
    if (raw === '0' || raw === 'false' || raw === 'off') return false;
    if (raw === '1' || raw === 'true' || raw === 'on') return true;
    return null;
  };

  return {
    viewMode: parseIntParam('mode', 0, 5),
    qualityLevel: parseQualityParam(params.get('preset')),
    physicsMode: parseIntParam('physics', 0, 2),
    patternMode: parseIntParam('pattern', 0, 2),
    animationMode: parseIntParam('animation', 3, 5),
    realismMode: parseBoolParam('realism'),
  };
}

/**
 * Apply visual-harness URL params (?demo, ?simTime, ?timescale, ?ground, ?seed).
 * Used by Playwright to freeze camera/sim state for golden-frame comparisons.
 */
export function applyVisualHarnessParams(rt: AppRuntime): VisualHarnessParams {
  const harness = parseVisualHarnessParams();
  if (harness.demoAuto !== null) {
    rt.simulation.demoAutoEnabled = harness.demoAuto;
    rt.ui.setDemoAutoEnabled(harness.demoAuto);
  }
  if (harness.simTime !== null) rt.simulation.clock.setSimTime(harness.simTime, 'scrub');
  if (harness.timeScale !== null) rt.simulation.clock.setRate(harness.timeScale);
  applySimClockFromUrl(rt);
  if (harness.groundPreset !== null) {
    rt.groundObserver.setPreset(harness.groundPreset);
    rt.applyGroundOverlayClass(rt.groundObserver.getOverlayClass());
    rt.applyGroundPresetEffects(0);
  }
  return harness;
}
