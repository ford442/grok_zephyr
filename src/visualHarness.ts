/**
 * URL parameters for deterministic visual-regression / Playwright harness runs.
 *
 *   ?demo=0|1          disable/enable auto demo cinematic (default: on)
 *   ?simTime=<sec>     initial scaled simulation time
 *   ?timescale=<n>     simulation time multiplier (0 freezes orbital motion)
 *   ?ground=<preset>   ground observer preset id (e.g. houseWindow)
 *   ?seed=<n>          seeded procedural orbital layout
 *   ?hdr=0|1           force HDR canvas off/on (WebGPU only)
 */

import { GroundObserverPreset } from '@/camera/GroundObserverCamera.js';
import { resolveHdrOverride } from '@/core/HdrPresentation.js';

export interface VisualHarnessParams {
  demoAuto: boolean | null;
  simTime: number | null;
  timeScale: number | null;
  groundPreset: GroundObserverPreset | null;
  seed: number | null;
  /** Force HDR canvas on/off for deterministic captures (`?hdr=0|1`). */
  hdr: boolean | null;
}

const GROUND_PRESET_IDS = new Set<string>(Object.values(GroundObserverPreset));

function parseBoolParam(raw: string | null): boolean | null {
  if (raw === null || raw === '') return null;
  if (raw === '0' || raw.toLowerCase() === 'false' || raw.toLowerCase() === 'off') return false;
  if (raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'on') return true;
  return null;
}

function parseFloatParam(raw: string | null, min: number, max: number): number | null {
  if (raw === null || raw === '') return null;
  const val = Number(raw);
  if (!Number.isFinite(val) || val < min || val > max) return null;
  return val;
}

function parseIntParam(raw: string | null, min: number, max: number): number | null {
  if (raw === null || raw === '') return null;
  const val = parseInt(raw, 10);
  if (!Number.isFinite(val) || val < min || val > max) return null;
  return val;
}

/** Parse visual-harness query params from the current (or supplied) search string. */
export function parseVisualHarnessParams(
  search: string = window.location.search,
): VisualHarnessParams {
  const params = new URLSearchParams(search);
  const groundRaw = params.get('ground');
  const groundPreset =
    groundRaw && GROUND_PRESET_IDS.has(groundRaw) ? (groundRaw as GroundObserverPreset) : null;

  return {
    demoAuto: parseBoolParam(params.get('demo')),
    simTime: parseFloatParam(params.get('simTime'), 0, 1_000_000),
    timeScale: parseFloatParam(params.get('timescale'), 0, 100_000),
    groundPreset,
    seed: parseIntParam(params.get('seed'), 0, 0x7fffffff),
    hdr: resolveHdrOverride(search),
  };
}
