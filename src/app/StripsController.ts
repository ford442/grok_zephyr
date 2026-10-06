/**
 * Sky Strips — time / audio / orbit-index light patterns on the fleet.
 *
 * Strips recompute the low 16 bits of the packed animation scratch every frame
 * (see src/physics/skyStrips.ts and src/shaders/compute/skyStrips.wgsl); the
 * Light Brush keeps the high 16, so both show at once. No satellite buffer is
 * added — only a 64-byte params uniform.
 *
 * Same policy as BrushController: off by default, `?strips=1` opts in, and low
 * quality / mobile force it off without discarding the user's choice. WebGPU
 * only — the WebGL2 fallback has no compute pass.
 *
 * Every string here describes light. The fleet is not signalling anyone.
 */

import type { AppRuntime } from '@/app/AppRuntime.js';
import type { AudioBands } from '@/audio/AudioEngine.js';
import {
  STRIPS_DEFAULT_BPM,
  STRIPS_MODE_NAMES,
  StripsMode,
  clampBpm,
  stripsFrameFromClock,
  type StripsModeValue,
} from '@/physics/skyStrips.js';
import { packStripsParams } from '@/shaders/uniformLayouts.js';

type StripsPattern = Exclude<StripsModeValue, typeof StripsMode.CLEAR>;

export interface StripsUrlState {
  enabled: boolean | null;
  mode: StripsPattern | null;
  bpm: number | null;
}

const MODE_BY_NAME: Record<string, StripsPattern> = {
  wave: StripsMode.WAVE,
  chase: StripsMode.CHASE,
  beat: StripsMode.BEAT,
  sparkle: StripsMode.SPARKLE,
};

export function parseStripsMode(raw: string | null | undefined): StripsPattern | null {
  if (!raw) return null;
  return MODE_BY_NAME[raw.toLowerCase()] ?? null;
}

/** `?strips=0|1`, `?stripsMode=wave|chase|beat|sparkle`, `?stripsBpm=<40–240>`. */
export function parseStripsParams(search: string): StripsUrlState {
  const params = new URLSearchParams(search);

  const rawEnabled = params.get('strips')?.toLowerCase();
  let enabled: boolean | null = null;
  if (rawEnabled === '1' || rawEnabled === 'true' || rawEnabled === 'on') enabled = true;
  else if (rawEnabled === '0' || rawEnabled === 'false' || rawEnabled === 'off') enabled = false;

  const rawBpm = params.get('stripsBpm');
  const bpmValue = rawBpm === null || rawBpm === '' ? NaN : Number.parseFloat(rawBpm);

  return {
    enabled,
    mode: parseStripsMode(params.get('stripsMode')),
    bpm: Number.isFinite(bpmValue) ? clampBpm(bpmValue) : null,
  };
}

/** Shown under the controls. Deliberately about light and nothing else. */
export const STRIPS_DISCLAIMER =
  'Light show only — changes how satellites glow, not what they do.';

export function formatStripsStatus(state: {
  enabled: boolean;
  wanted: boolean;
  unavailableReason: string | null;
  qualityForcesOff: boolean;
  mode: StripsPattern;
  audioLive: boolean;
  reducedMotion: boolean;
}): string {
  if (state.unavailableReason) return `Strips: unavailable — ${state.unavailableReason}`;
  if (state.wanted && state.qualityForcesOff) return 'Strips: off on Low quality and mobile';
  if (!state.enabled) return 'Strips: off';
  const name = STRIPS_MODE_NAMES[state.mode];
  if (state.reducedMotion && (state.mode === StripsMode.BEAT || state.mode === StripsMode.SPARKLE)) {
    return `Strips: ${name} · paused for reduced motion`;
  }
  if (state.mode === StripsMode.BEAT && !state.audioLive) return 'Strips: beat · unmute audio to drive it';
  return state.reducedMotion ? `Strips: ${name} · held still for reduced motion` : `Strips: ${name}`;
}

export interface StripsTickInput {
  /** Analyser bands, or null while audio is muted / locked. */
  bands: AudioBands | null;
  reducedMotion: boolean;
}

export class StripsController {
  enabled = false;
  /** null = follow the default (off); otherwise the last user toggle. */
  userOverride: boolean | null = null;
  qualityForcesOff = false;
  unavailableReason: string | null = null;

  mode: StripsPattern = StripsMode.WAVE;
  bpm = STRIPS_DEFAULT_BPM;

  /** Show clock, seconds of real time while drawing; independent of the sim time scale. */
  private showTime = 0;
  /** Set by setTime(…, true): the clock stays put (golden frames). */
  private timeHeld = false;
  /** The strips half may hold light; the next idle tick clears it once. */
  private halfDirty = false;
  private seed = 0;
  /** Last status line written, so per-frame refreshes touch the DOM only on change. */
  lastStatus: string | null = null;

  /** Whether strips use the scratch this frame (drawing, or one clear left to do). */
  usesScratch(): boolean {
    return this.enabled || this.halfDirty;
  }

  /** Apply the enable rule. Returns the resulting state. */
  resolveEnabled(): boolean {
    const wanted = this.userOverride ?? false;
    this.enabled = wanted && !this.qualityForcesOff && this.unavailableReason === null;
    return this.enabled;
  }

  setMode(mode: StripsPattern): void {
    this.mode = mode;
  }

  setBpm(bpm: number): void {
    this.bpm = clampBpm(bpm);
  }

  /** Scripting hook: jump the show clock, and with `hold` keep it there (golden frames). */
  setTime(seconds: number, hold = false): void {
    this.showTime = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    this.timeHeld = hold;
  }

  getTime(): number {
    return this.showTime;
  }

  /**
   * True when this frame draws nothing: off, BEAT without audio, or a pattern
   * that only exists as motion (BEAT, SPARKLE) under reduced motion.
   */
  private isIdle(input: StripsTickInput): boolean {
    if (!this.enabled) return true;
    const motionOnly = this.mode === StripsMode.BEAT || this.mode === StripsMode.SPARKLE;
    if (input.reducedMotion && motionOnly) return true;
    return this.mode === StripsMode.BEAT && input.bands === null;
  }

  /**
   * Build this frame's packed StripsParams, or null when there is nothing to
   * do so the caller skips the dispatch. An idle tick after drawing emits one
   * CLEAR so no strip light lingers in the scratch.
   */
  tick(deltaSeconds: number, input: StripsTickInput): ArrayBuffer | null {
    if (this.isIdle(input)) {
      if (!this.halfDirty) return null;
      this.halfDirty = false;
      return packStripsParams(stripsFrameFromClock(StripsMode.CLEAR, 0, this.bpm, null));
    }

    // Reduced motion holds WAVE / CHASE still at the current phase.
    if (!input.reducedMotion && !this.timeHeld && Number.isFinite(deltaSeconds)) {
      this.showTime += Math.max(0, deltaSeconds);
    }
    this.halfDirty = true;
    return packStripsParams(
      stripsFrameFromClock(this.mode, this.showTime, this.bpm, input.bands, this.seed),
    );
  }
}

// ── App wiring (same shape as BrushController) ──────────────────────────────

function reducedMotion(rt: AppRuntime): boolean {
  return rt.a11y?.prefersReducedMotion ?? false;
}

/**
 * Refresh the toggle and status line. FrameLoop calls it every frame with the
 * live audio state; the DOM is only written when the text changes.
 */
export function syncStrips(rt: AppRuntime, audioLive: boolean = rt.audio.getBands() !== null): void {
  const strips = rt.strips;
  const wasEnabled = strips.enabled;
  strips.resolveEnabled();
  if (strips.enabled !== wasEnabled || strips.lastStatus === null) rt.ui.setStripsEnabled(strips.enabled);
  const status = formatStripsStatus({
    enabled: strips.enabled,
    wanted: strips.userOverride ?? false,
    unavailableReason: strips.unavailableReason,
    qualityForcesOff: strips.qualityForcesOff,
    mode: strips.mode,
    audioLive,
    reducedMotion: reducedMotion(rt),
  });
  if (status !== strips.lastStatus) {
    strips.lastStatus = status;
    rt.ui.setStripsStatus(status);
  }
}

export function setStripsEnabled(rt: AppRuntime, enabled: boolean): void {
  rt.strips.userOverride = enabled;
  syncStrips(rt);
}

/** Low quality and mobile force strips off, exactly as ISL and the brush. */
export function applyStripsForQuality(rt: AppRuntime, qualityForcesOff: boolean): void {
  rt.strips.qualityForcesOff = qualityForcesOff;
  syncStrips(rt);
}

export function setStripsUnavailable(rt: AppRuntime, reason: string): void {
  rt.strips.unavailableReason = reason;
  syncStrips(rt);
  rt.ui.setStripsAvailable(false);
}

export function setStripsMode(rt: AppRuntime, mode: StripsPattern): void {
  rt.strips.setMode(mode);
  rt.ui.setStripsMode(STRIPS_MODE_NAMES[mode]);
  syncStrips(rt);
}

/** Boot: apply `?strips…` after the quality preset, so the quality rule still wins. */
export function applyStripsFromUrl(rt: AppRuntime, search: string = window.location.search): void {
  const url = parseStripsParams(search);
  if (url.mode !== null) setStripsMode(rt, url.mode);
  if (url.bpm !== null) rt.strips.setBpm(url.bpm);
  if (url.enabled !== null) setStripsEnabled(rt, url.enabled);
  else syncStrips(rt);
}
