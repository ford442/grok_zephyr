/**
 * Light Brush — pointer (or XR ray) → decaying paint on the fleet.
 *
 * The brush turns the constellation into an addressable display: dragging
 * lights nearby satellites in the brush colour and they fade back over 2–5 s.
 * Paint lives in the packed animation scratch (see src/physics/brushFalloff.ts
 * and src/shaders/compute/brush.wgsl); no satellite buffer is added.
 *
 * Mirrors ConjunctionController's policy: off by default, `?brush=1` opts in,
 * and low quality / mobile force it off without discarding the user's choice.
 * WebGPU only — the WebGL2 fallback has no compute pass.
 *
 * Every string here describes light. The brush does not move satellites, model
 * gravity, or say anything about tracking or collision risk.
 */

import type { AppRuntime } from '@/app/AppRuntime.js';
import {
  BRUSH_DEFAULT_COLOR_CSS,
  BRUSH_DEFAULT_FADE_S,
  BRUSH_DEFAULT_RADIUS_KM,
  BRUSH_MAX_STAMPS,
  BRUSH_MODE_NAMES,
  BRUSH_SHELL_RADIUS_KM,
  BrushMode,
  PaintDecayClock,
  clampFadeSeconds,
  clampRadiusKm,
  interpolateStroke,
  paintRgbFromCss,
  rayShellHit,
  ringAxis,
  screenRayDirection,
  type BrushModeValue,
  type BrushStamp,
  type Vec3Tuple,
} from '@/physics/brushFalloff.js';
import { packBrushParams } from '@/shaders/uniformLayouts.js';

export type BrushModeName = 'point' | 'spray' | 'ring';

export interface BrushUrlState {
  enabled: boolean | null;
  mode: BrushModeValue | null;
  radiusKm: number | null;
  fadeSeconds: number | null;
  color: string | null;
}

const MODE_BY_NAME: Record<string, BrushModeValue> = {
  point: BrushMode.POINT,
  spray: BrushMode.SPRAY,
  ring: BrushMode.RING,
  'plane-ring': BrushMode.RING,
};

export function parseBrushMode(raw: string | null | undefined): BrushModeValue | null {
  if (!raw) return null;
  return MODE_BY_NAME[raw.toLowerCase()] ?? null;
}

/**
 * `?brush=0|1`, `?brushMode=point|spray|ring`, `?brushKm=<n>`,
 * `?brushFade=<s>`, `?brushColor=rrggbb`. Out-of-range numbers are clamped so
 * a deep link still shows something explicable.
 */
export function parseBrushParams(search: string): BrushUrlState {
  const params = new URLSearchParams(search);

  const rawEnabled = params.get('brush')?.toLowerCase();
  let enabled: boolean | null = null;
  if (rawEnabled === '1' || rawEnabled === 'true' || rawEnabled === 'on') enabled = true;
  else if (rawEnabled === '0' || rawEnabled === 'false' || rawEnabled === 'off') enabled = false;

  const num = (key: string): number | null => {
    const raw = params.get(key);
    if (raw === null || raw === '') return null;
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value : null;
  };
  const km = num('brushKm');
  const fade = num('brushFade');
  const rawColor = params.get('brushColor');
  const color = rawColor && /^#?[0-9a-f]{6}$/i.test(rawColor)
    ? `#${rawColor.replace('#', '').toLowerCase()}`
    : null;

  return {
    enabled,
    mode: parseBrushMode(params.get('brushMode')),
    radiusKm: km === null ? null : clampRadiusKm(km),
    fadeSeconds: fade === null ? null : clampFadeSeconds(fade),
    color,
  };
}

/** Shown under the controls. Deliberately about light and nothing else. */
export const BRUSH_DISCLAIMER =
  'Light paint only — changes how satellites glow, not where they are.';

export function formatBrushStatus(state: {
  enabled: boolean;
  wanted: boolean;
  unavailableReason: string | null;
  qualityForcesOff: boolean;
  mode: BrushModeValue;
}): string {
  if (state.unavailableReason) return `Brush: unavailable — ${state.unavailableReason}`;
  if (state.wanted && state.qualityForcesOff) return 'Brush: off on Low quality and mobile';
  if (!state.enabled) return 'Brush: off';
  return `Brush: ${BRUSH_MODE_NAMES[state.mode]} · drag to paint · Shift-drag orbits`;
}

/** What the controller needs from the app, injected so tests need no DOM or GPU. */
export interface BrushHost {
  /** Screen-space GPU picker; resolves to -1 on a miss. */
  pickSatellite(clientX: number, clientY: number): Promise<number>;
  satellitePosition(index: number): Vec3Tuple | null;
  satelliteVelocity(index: number): Vec3Tuple | null;
  onStrokeStart?(): void;
}

/** Camera for the frame the stamps are built in. */
export interface BrushView {
  cameraPosition: Vec3Tuple;
  cameraUp: Vec3Tuple;
  /** Column-major view and projection matrices (not their product — see screenRayDirection). */
  view: ArrayLike<number>;
  projection: ArrayLike<number>;
  /** Canvas rect for turning client coordinates into NDC; only read mid-stroke. */
  getRect(): { left: number; top: number; width: number; height: number };
}

type StrokeTarget =
  | { kind: 'screen'; clientX: number; clientY: number }
  | { kind: 'ndc'; x: number; y: number }
  | { kind: 'ray'; origin: Vec3Tuple; direction: Vec3Tuple };

export class BrushController {
  enabled = false;
  /** null = follow the default (off); otherwise the last user toggle. */
  userOverride: boolean | null = null;
  qualityForcesOff = false;
  unavailableReason: string | null = null;

  mode: BrushModeValue = BrushMode.POINT;
  radiusKm = BRUSH_DEFAULT_RADIUS_KM;
  fadeSeconds = BRUSH_DEFAULT_FADE_S;
  colorCss = BRUSH_DEFAULT_COLOR_CSS;

  private readonly decay = new PaintDecayClock();
  private target: StrokeTarget | null = null;
  private stroking = false;
  private lastHit: Vec3Tuple | null = null;
  /** Ring orientation for this stroke: picked satellite velocity, else camera up. */
  private ringTangent: Vec3Tuple | null = null;
  /** Nearest satellite from the picker, used while the ray misses the shell. */
  private fallbackIndex = -1;
  private pickInFlight = false;
  /** Decay steps applied since the last stamp; ≥ 255 means the scratch is black. */
  private stepsSinceStamp = 255;
  private clearPending = false;
  private seed = 0;
  /** The last press on the canvas started a stroke; its click/dblclick is ours. */
  private lastPressWasBrush = false;

  constructor(private readonly host: BrushHost) {}

  /** Whether the brush currently holds the animation scratch. */
  ownsScratch(): boolean {
    return this.enabled || this.clearPending || this.stepsSinceStamp < 255;
  }

  isStroking(): boolean {
    return this.stroking;
  }

  /** Apply the enable rule. Returns the resulting state. */
  resolveEnabled(): boolean {
    const wanted = this.userOverride ?? false;
    const next = wanted && !this.qualityForcesOff && this.unavailableReason === null;
    if (this.enabled && !next) {
      this.endStroke();
      // One dispatch with full decay so no paint lingers in a scratch the
      // brush no longer owns.
      if (this.stepsSinceStamp < 255) this.clearPending = true;
    }
    this.enabled = next;
    return next;
  }

  setMode(mode: BrushModeValue): void {
    this.mode = mode;
  }

  setRadiusKm(km: number): void {
    this.radiusKm = clampRadiusKm(km);
  }

  setFadeSeconds(s: number): void {
    this.fadeSeconds = clampFadeSeconds(s);
  }

  setColor(css: string): void {
    if (/^#?[0-9a-f]{6}$/i.test(css)) this.colorCss = `#${css.replace('#', '').toLowerCase()}`;
  }

  // ── Stroke input ──────────────────────────────────────────────────────────

  beginScreenStroke(clientX: number, clientY: number): void {
    this.beginStroke({ kind: 'screen', clientX, clientY });
    if (this.mode === BrushMode.RING) this.requestPick(clientX, clientY, true);
  }

  moveScreenStroke(clientX: number, clientY: number): void {
    if (!this.stroking) return;
    this.target = { kind: 'screen', clientX, clientY };
  }

  /** Scripting / golden-frame entry: paint at an NDC point. */
  beginNdcStroke(x: number, y: number): void {
    this.beginStroke({ kind: 'ndc', x, y });
  }

  /** XR controller ray (#158) or any world-space ray, km. */
  beginRayStroke(origin: Vec3Tuple, direction: Vec3Tuple): void {
    this.beginStroke({ kind: 'ray', origin, direction });
  }

  updateRay(origin: Vec3Tuple, direction: Vec3Tuple): void {
    if (!this.stroking) return;
    this.target = { kind: 'ray', origin, direction };
  }

  endStroke(): void {
    this.stroking = false;
    this.target = null;
    this.lastHit = null;
    this.ringTangent = null;
    this.fallbackIndex = -1;
  }

  private beginStroke(target: StrokeTarget): void {
    if (!this.enabled) return;
    this.stroking = true;
    this.target = target;
    this.lastHit = null;
    this.ringTangent = null;
    this.fallbackIndex = -1;
    this.host.onStrokeStart?.();
  }

  private requestPick(clientX: number, clientY: number, forRing: boolean): void {
    if (this.pickInFlight) return;
    this.pickInFlight = true;
    void this.host
      .pickSatellite(clientX, clientY)
      .then((index) => {
        if (!this.stroking || index < 0) return;
        if (forRing) {
          const v = this.host.satelliteVelocity(index);
          if (v && Math.hypot(v[0], v[1], v[2]) > 0) this.ringTangent = v;
        } else {
          this.fallbackIndex = index;
        }
      })
      .catch(() => undefined)
      .finally(() => {
        this.pickInFlight = false;
      });
  }

  // ── Per frame ─────────────────────────────────────────────────────────────

  /**
   * Build this frame's packed BrushParams, or null when there is nothing to do
   * (no stroke, nothing left fading) so the caller skips the dispatch.
   */
  tick(deltaSeconds: number, view: BrushView | null): ArrayBuffer | null {
    const rgb = paintRgbFromCss(this.colorCss);

    if (this.clearPending) {
      this.clearPending = false;
      this.stepsSinceStamp = 255;
      this.decay.reset();
      return packBrushParams({ mode: this.mode, decaySteps: 255, rgb, seed: this.seed, stamps: [] });
    }

    const stamps = this.enabled && this.stroking && view ? this.buildStamps(view) : [];
    if (stamps.length === 0 && this.stepsSinceStamp >= 255) {
      this.decay.reset();
      return null;
    }

    const decaySteps = this.decay.advance(deltaSeconds, this.fadeSeconds);
    this.stepsSinceStamp = stamps.length > 0 ? 0 : Math.min(255, this.stepsSinceStamp + decaySteps);
    this.seed = (this.seed + 1) >>> 0;
    return packBrushParams({ mode: this.mode, decaySteps, rgb, seed: this.seed, stamps });
  }

  private buildStamps(view: BrushView): BrushStamp[] {
    const hit = this.resolveHit(view);
    if (!hit) {
      this.lastHit = null;
      return [];
    }

    const radiusKm = this.radiusKm;
    if (this.mode === BrushMode.RING) {
      // One plane per frame is enough: the ring spans the whole orbit.
      const tangent = this.ringTangent ?? view.cameraUp;
      this.lastHit = hit;
      return [{ center: hit, radiusKm, axis: ringAxis(hit, tangent), strength: 1 }];
    }

    const centers = interpolateStroke(this.lastHit, hit, radiusKm, BRUSH_MAX_STAMPS);
    this.lastHit = hit;
    return centers.map((center) => ({ center, radiusKm, axis: [0, 0, 0], strength: 1 }));
  }

  private resolveHit(view: BrushView): Vec3Tuple | null {
    const target = this.target;
    if (!target) return null;

    let origin: Vec3Tuple;
    let direction: Vec3Tuple | null;
    if (target.kind === 'ray') {
      origin = target.origin;
      direction = target.direction;
    } else {
      let ndcX: number;
      let ndcY: number;
      if (target.kind === 'ndc') {
        ndcX = target.x;
        ndcY = target.y;
      } else {
        const { left, top, width, height } = view.getRect();
        ndcX = ((target.clientX - left) / Math.max(1, width)) * 2 - 1;
        ndcY = 1 - ((target.clientY - top) / Math.max(1, height)) * 2;
      }
      origin = view.cameraPosition;
      direction = screenRayDirection(view.view, view.projection, ndcX, ndcY);
    }

    const hit = direction ? rayShellHit(origin, direction, BRUSH_SHELL_RADIUS_KM) : null;
    if (hit) {
      this.fallbackIndex = -1;
      return hit;
    }

    // The ray missed the shell (grazing the limb, or pointing into space):
    // paint around the nearest satellite on screen instead.
    if (this.fallbackIndex >= 0) return this.host.satellitePosition(this.fallbackIndex);
    if (target.kind === 'screen') this.requestPick(target.clientX, target.clientY, false);
    return null;
  }

  // ── DOM ───────────────────────────────────────────────────────────────────

  /**
   * Left-drag paints while the brush is on. `preventDefault` on pointerdown
   * suppresses the compatibility mousedown, so CameraInput does not also orbit;
   * Shift or Alt passes the drag through to the camera. The click/dblclick that
   * ends a stroke is swallowed so painting does not select or reset the view.
   * Mouse and pen only: touch is mobile, where the brush is forced off.
   */
  attach(canvas: HTMLCanvasElement): () => void {
    const onDown = (e: PointerEvent): void => {
      this.lastPressWasBrush = false;
      if (!this.enabled || e.button !== 0 || e.shiftKey || e.altKey) return;
      if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
      e.preventDefault();
      this.lastPressWasBrush = true;
      canvas.setPointerCapture?.(e.pointerId);
      this.beginScreenStroke(e.clientX, e.clientY);
    };
    const onMove = (e: PointerEvent): void => {
      if (this.stroking) this.moveScreenStroke(e.clientX, e.clientY);
    };
    const onUp = (e: PointerEvent): void => {
      if (!this.stroking) return;
      canvas.releasePointerCapture?.(e.pointerId);
      this.endStroke();
    };
    const swallow = (e: Event): void => {
      if (!this.lastPressWasBrush) return;
      e.stopImmediatePropagation();
      e.preventDefault();
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('click', swallow, { capture: true });
    canvas.addEventListener('dblclick', swallow, { capture: true });
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('click', swallow, { capture: true });
      canvas.removeEventListener('dblclick', swallow, { capture: true });
    };
  }
}

// ── App wiring (same shape as ConjunctionController) ────────────────────────

function syncBrush(rt: AppRuntime): void {
  const brush = rt.brush;
  brush.resolveEnabled();
  rt.ui.setBrushEnabled(brush.enabled);
  rt.ui.setBrushStatus(
    formatBrushStatus({
      enabled: brush.enabled,
      wanted: brush.userOverride ?? false,
      unavailableReason: brush.unavailableReason,
      qualityForcesOff: brush.qualityForcesOff,
      mode: brush.mode,
    }),
  );
}

export function setBrushEnabled(rt: AppRuntime, enabled: boolean): void {
  rt.brush.userOverride = enabled;
  syncBrush(rt);
}

/** Low quality and mobile force the brush off, exactly as ISL and close approaches. */
export function applyBrushForQuality(rt: AppRuntime, qualityForcesOff: boolean): void {
  rt.brush.qualityForcesOff = qualityForcesOff;
  syncBrush(rt);
}

export function setBrushUnavailable(rt: AppRuntime, reason: string): void {
  rt.brush.unavailableReason = reason;
  syncBrush(rt);
  rt.ui.setBrushAvailable(false);
}

export function setBrushMode(rt: AppRuntime, mode: BrushModeValue): void {
  rt.brush.setMode(mode);
  rt.ui.setBrushMode(BRUSH_MODE_NAMES[mode]);
  syncBrush(rt);
}

export function setBrushRadiusKm(rt: AppRuntime, km: number): void {
  rt.brush.setRadiusKm(km);
  rt.ui.setBrushRadiusKm(rt.brush.radiusKm);
}

export function setBrushFadeSeconds(rt: AppRuntime, s: number): void {
  rt.brush.setFadeSeconds(s);
  rt.ui.setBrushFadeSeconds(rt.brush.fadeSeconds);
}

export function setBrushColor(rt: AppRuntime, css: string): void {
  rt.brush.setColor(css);
  rt.ui.setBrushColor(rt.brush.colorCss);
}

/** Boot: apply `?brush…` after the quality preset, so the quality rule still wins. */
export function applyBrushFromUrl(rt: AppRuntime, search: string = window.location.search): void {
  const url = parseBrushParams(search);
  if (url.mode !== null) setBrushMode(rt, url.mode);
  setBrushRadiusKm(rt, url.radiusKm ?? rt.brush.radiusKm);
  setBrushFadeSeconds(rt, url.fadeSeconds ?? rt.brush.fadeSeconds);
  setBrushColor(rt, url.color ?? rt.brush.colorCss);
  if (url.enabled !== null) setBrushEnabled(rt, url.enabled);
  else syncBrush(rt);
}
