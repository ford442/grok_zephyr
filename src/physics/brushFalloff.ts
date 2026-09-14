/**
 * Light Brush (orbital paint) — CPU reference.
 *
 * This is the authority for the paint math: `src/shaders/compute/brush.wgsl`
 * reimplements `brushFalloff`, `sprayHash`, `stampLevel` and `composePaint` in
 * WGSL and must stay in step, which is what `brushFalloff.test.ts` pins (the
 * shader constants are checked against the ones exported here).
 *
 * Paint lives in the packed rgba8 animation scratch (one u32 per satellite,
 * the same slot Smile V2 writes): rgb = brush colour, a = intensity. Nothing in
 * here is gravity, orbit perturbation or tracking — it changes how brightly a
 * satellite is drawn and nothing else.
 *
 * Decay is linear in whole 1/255 steps with the remainder carried between
 * frames. Exponential decay (`a *= k` per frame) does not work on 8 bits: once
 * `a * (1 - k)` rounds to zero the value never reaches black, and at high frame
 * rates that happens almost immediately. `PaintDecayClock` guarantees a full
 * stroke is gone in exactly `fadeSeconds`, independent of frame rate.
 */

export type Vec3Tuple = readonly [number, number, number];

export const BrushMode = {
  POINT: 0,
  SPRAY: 1,
  RING: 2,
} as const;
export type BrushModeValue = (typeof BrushMode)[keyof typeof BrushMode];

export const BRUSH_MODE_NAMES: Record<BrushModeValue, 'point' | 'spray' | 'ring'> = {
  [BrushMode.POINT]: 'point',
  [BrushMode.SPRAY]: 'spray',
  [BrushMode.RING]: 'ring',
};

/** Stamps per frame; the WGSL uniform array has exactly this many slots. */
export const BRUSH_MAX_STAMPS = 8;
/** Bytes per stamp in the uniform: vec3f centre + radius, vec3f axis + strength. */
export const BRUSH_STAMP_BYTES = 32;

export const BRUSH_MIN_FADE_S = 2;
export const BRUSH_MAX_FADE_S = 5;
export const BRUSH_DEFAULT_FADE_S = 3;

export const BRUSH_MIN_RADIUS_KM = 50;
export const BRUSH_MAX_RADIUS_KM = 2000;
export const BRUSH_DEFAULT_RADIUS_KM = 400;

/** Fraction of satellites inside the radius a spray stamp lights per frame. */
export const BRUSH_SPRAY_DENSITY = 0.2;
/** Ring half-width as a fraction of brush radius, floored so it stays visible. */
export const BRUSH_RING_WIDTH_FRACTION = 0.2;
export const BRUSH_RING_MIN_HALF_WIDTH_KM = 20;

/**
 * Pointer rays hit this sphere. It is the middle procedural shell (Earth radius
 * + 550 km); the default 400 km brush radius reaches the 6711 km and most of
 * the 7521 km shell around it, and real TLE fleets cluster in the same band.
 */
export const BRUSH_SHELL_RADIUS_KM = 6921;

/** Default brush colour as CSS `#rrggbb`. */
export const BRUSH_DEFAULT_COLOR_CSS = '#39c8ff';

/**
 * CSS `#rrggbb` → the scratch's rgb layout, which is pack4x8unorm order: red in
 * the low byte. Invalid input returns the default colour.
 */
export function paintRgbFromCss(css: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(css.trim());
  const hex = m ? m[1] : BRUSH_DEFAULT_COLOR_CSS.slice(1);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (r | (g << 8) | (b << 16)) >>> 0;
}

export function clampFadeSeconds(s: number): number {
  if (!Number.isFinite(s)) return BRUSH_DEFAULT_FADE_S;
  return Math.min(BRUSH_MAX_FADE_S, Math.max(BRUSH_MIN_FADE_S, s));
}

export function clampRadiusKm(km: number): number {
  if (!Number.isFinite(km)) return BRUSH_DEFAULT_RADIUS_KM;
  return Math.min(BRUSH_MAX_RADIUS_KM, Math.max(BRUSH_MIN_RADIUS_KM, km));
}

/**
 * Compact smooth kernel: 1 at the centre, 0 with zero slope at `radiusKm`,
 * exactly 0 beyond. Squared-quadratic (not Gaussian) so there is no long tail
 * lighting satellites the user did not touch.
 */
export function brushFalloff(distanceKm: number, radiusKm: number): number {
  if (radiusKm <= 0 || distanceKm >= radiusKm) return 0;
  const t = distanceKm / radiusKm;
  const u = 1 - t * t;
  return u * u;
}

/** Weight → 8-bit level, with pack4x8unorm's rounding: floor(0.5 + 255·v). */
export function stampLevel(weight: number): number {
  const v = Math.min(1, Math.max(0, weight));
  return Math.floor(0.5 + 255 * v);
}

/**
 * lowbias32 integer hash. `Math.imul` and `>>> 0` reproduce WGSL's wrapping
 * u32 arithmetic; the result is the full 32-bit value.
 */
export function hashU32(n: number): number {
  let x = n >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

/** Per-satellite, per-frame spray draw in [0, 1). 24 bits so f32 holds it exactly. */
export function sprayHash(satIndex: number, seed: number): number {
  const mixed = (satIndex ^ Math.imul(seed >>> 0, 0x9e3779b9)) >>> 0;
  return (hashU32(mixed) >>> 8) / 16777216;
}

export interface BrushStamp {
  /** Centre on the shell, km (body frame, same as the position buffer). */
  center: Vec3Tuple;
  radiusKm: number;
  /** Ring mode: unit normal of the lit plane. Unused otherwise. */
  axis: Vec3Tuple;
  strength: number;
}

export function ringHalfWidthKm(radiusKm: number): number {
  return Math.max(BRUSH_RING_MIN_HALF_WIDTH_KM, radiusKm * BRUSH_RING_WIDTH_FRACTION);
}

/** Weight one stamp contributes to a satellite at `pos`. */
export function stampWeight(
  mode: BrushModeValue,
  stamp: BrushStamp,
  pos: Vec3Tuple,
  satIndex: number,
  seed: number,
): number {
  if (mode === BrushMode.RING) {
    const planeDistance = Math.abs(
      pos[0] * stamp.axis[0] + pos[1] * stamp.axis[1] + pos[2] * stamp.axis[2],
    );
    return brushFalloff(planeDistance, ringHalfWidthKm(stamp.radiusKm)) * stamp.strength;
  }
  const dx = pos[0] - stamp.center[0];
  const dy = pos[1] - stamp.center[1];
  const dz = pos[2] - stamp.center[2];
  const w = brushFalloff(Math.sqrt(dx * dx + dy * dy + dz * dz), stamp.radiusKm) * stamp.strength;
  if (mode === BrushMode.SPRAY && w > 0 && sprayHash(satIndex, seed) >= BRUSH_SPRAY_DENSITY) {
    return 0;
  }
  return w;
}

export function packPaint(rgb: number, alpha: number): number {
  return (((alpha & 0xff) << 24) | (rgb & 0xffffff)) >>> 0;
}

export function paintAlpha(packed: number): number {
  return packed >>> 24;
}

export function paintRgb(packed: number): number {
  return packed & 0xffffff;
}

/**
 * One frame for one satellite: decay by `decaySteps`, then let the strongest
 * stamp raise it. Max-compose rather than add, so holding the brush still keeps
 * a patch lit at full instead of saturating its neighbours. The stamp's colour
 * wins only where it is brighter than what is left, so repainting in a new
 * colour replaces the old one while an older fading stroke keeps its own. A
 * fully faded satellite is exactly 0 so the scratch reads as "no paint".
 */
export function composePaint(
  packed: number,
  decaySteps: number,
  level: number,
  brushRgb: number,
): number {
  let a = paintAlpha(packed);
  let rgb = paintRgb(packed);
  a = a > decaySteps ? a - decaySteps : 0;
  if (level > a) {
    a = level;
    rgb = brushRgb & 0xffffff;
  }
  return a === 0 ? 0 : packPaint(rgb, a);
}

/**
 * Converts frame time into whole 1/255 decay steps, carrying the remainder, so
 * 255 → 0 takes `fadeSeconds` at any frame rate.
 */
export class PaintDecayClock {
  private carry = 0;

  advance(deltaSeconds: number, fadeSeconds: number): number {
    const dt = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    this.carry += (dt * 255) / clampFadeSeconds(fadeSeconds);
    const steps = Math.min(255, Math.floor(this.carry));
    this.carry = Math.min(this.carry - steps, 1);
    return steps;
  }

  reset(): void {
    this.carry = 0;
  }
}

// ── Pointer ray → shell ─────────────────────────────────────────────────────

/**
 * World-space direction through an NDC point, from separate column-major view
 * and projection matrices (WebGPU/GL perspective, w = -z_view; off-axis XR
 * frusta included).
 *
 * Deliberately not an inverse of view × projection: with a 10 km near plane
 * and a 10⁶ km far plane that product is numerically singular in Float32 (its
 * last two rows are almost parallel), and inverting it returns garbage. The
 * view matrix is a rotation + translation and the projection's x/y terms are
 * well conditioned, so this path is exact.
 */
export function screenRayDirection(
  view: ArrayLike<number>,
  projection: ArrayLike<number>,
  ndcX: number,
  ndcY: number,
): Vec3Tuple | null {
  const p0 = projection[0];
  const p5 = projection[5];
  if (Math.abs(p0) < 1e-12 || Math.abs(p5) < 1e-12) return null;
  // View space at z = -1: ndc = p0·x − p8  ⇒  x = (ndc + p8) / p0.
  const x = (ndcX + projection[8]) / p0;
  const y = (ndcY + projection[9]) / p5;
  // Rows of the view rotation are the camera's right, up and back axes.
  const d = normalize([
    view[0] * x + view[1] * y - view[2],
    view[4] * x + view[5] * y - view[6],
    view[8] * x + view[9] * y - view[10],
  ]);
  return d[0] === 0 && d[1] === 0 && d[2] === 0 ? null : d;
}

/**
 * Where a ray meets the shell sphere. From outside, the near side (what the
 * user sees); from inside — Fleet POV, ground — the far side ahead of them.
 */
export function rayShellHit(
  origin: Vec3Tuple,
  direction: Vec3Tuple,
  radiusKm: number = BRUSH_SHELL_RADIUS_KM,
): Vec3Tuple | null {
  const b = origin[0] * direction[0] + origin[1] * direction[1] + origin[2] * direction[2];
  const c = origin[0] * origin[0] + origin[1] * origin[1] + origin[2] * origin[2] - radiusKm * radiusKm;
  const disc = b * b - c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const tNear = -b - root;
  const tFar = -b + root;
  const t = tNear > 0 ? tNear : tFar;
  if (t <= 0) return null;
  return [origin[0] + direction[0] * t, origin[1] + direction[1] * t, origin[2] + direction[2] * t];
}

/**
 * Stamp centres from the previous frame's hit to this one, spaced about half a
 * radius apart along the chord and pushed back onto the shell, so a fast drag
 * paints a continuous stroke. Always includes `to`; capped at `maxStamps`
 * (spread evenly when the stroke is longer than the cap can cover).
 */
export function interpolateStroke(
  from: Vec3Tuple | null,
  to: Vec3Tuple,
  radiusKm: number,
  maxStamps: number = BRUSH_MAX_STAMPS,
): Vec3Tuple[] {
  if (!from) return [to];
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const spacing = Math.max(1e-6, radiusKm * 0.5);
  const count = Math.max(1, Math.min(maxStamps, Math.ceil(length / spacing)));
  const shell = Math.sqrt(to[0] * to[0] + to[1] * to[1] + to[2] * to[2]);
  const out: Vec3Tuple[] = [];
  for (let i = 1; i <= count; i++) {
    const s = i / count;
    const p: Vec3Tuple = [from[0] + dx * s, from[1] + dy * s, from[2] + dz * s];
    const len = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
    out.push(len > 1e-6 ? [(p[0] / len) * shell, (p[1] / len) * shell, (p[2] / len) * shell] : p);
  }
  return out;
}

/**
 * Ring plane through `hit` that also contains `tangent` — the picked
 * satellite's velocity, so the ring follows its orbital plane, or the camera up
 * vector when nothing was picked. Falls back to an arbitrary perpendicular when
 * the two are parallel.
 */
export function ringAxis(hit: Vec3Tuple, tangent: Vec3Tuple): Vec3Tuple {
  const n = cross(hit, tangent);
  if (Math.hypot(n[0], n[1], n[2]) > 1e-9 * Math.max(1, Math.hypot(hit[0], hit[1], hit[2]))) {
    return normalize(n);
  }
  const alt: Vec3Tuple = Math.abs(hit[2]) < 0.9 * Math.hypot(hit[0], hit[1], hit[2]) ? [0, 0, 1] : [1, 0, 0];
  return normalize(cross(hit, alt));
}

function cross(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(v: Vec3Tuple): Vec3Tuple {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 0];
}

// ── Reference frame over a whole fleet ──────────────────────────────────────

/**
 * What one GPU dispatch does, over `positions` (packed vec4, like the position
 * buffer) and `paint` (the scratch), in place. Inactive satellites — exactly
 * zero position or negative w, the sentinels every fleet pass skips — only
 * decay. Used by tests; not on the frame path.
 */
export function paintFrame(
  positions: Float32Array,
  paint: Uint32Array,
  count: number,
  frame: {
    mode: BrushModeValue;
    stamps: readonly BrushStamp[];
    decaySteps: number;
    rgb: number;
    seed: number;
  },
): void {
  const stamps = frame.stamps.slice(0, BRUSH_MAX_STAMPS);
  for (let i = 0; i < count; i++) {
    const x = positions[i * 4];
    const y = positions[i * 4 + 1];
    const z = positions[i * 4 + 2];
    const w = positions[i * 4 + 3];
    const active = w >= 0 && (x !== 0 || y !== 0 || z !== 0);
    let weight = 0;
    if (active) {
      for (const stamp of stamps) {
        weight = Math.max(weight, stampWeight(frame.mode, stamp, [x, y, z], i, frame.seed));
      }
    }
    paint[i] = composePaint(paint[i], frame.decaySteps, stampLevel(weight), frame.rgb);
  }
}
