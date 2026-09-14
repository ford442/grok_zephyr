import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BRUSH_MAX_FADE_S,
  BRUSH_MAX_STAMPS,
  BRUSH_MIN_FADE_S,
  BRUSH_RING_MIN_HALF_WIDTH_KM,
  BRUSH_RING_WIDTH_FRACTION,
  BRUSH_SHELL_RADIUS_KM,
  BRUSH_SPRAY_DENSITY,
  BRUSH_STAMP_BYTES,
  BrushMode,
  PaintDecayClock,
  brushFalloff,
  clampFadeSeconds,
  composePaint,
  hashU32,
  interpolateStroke,
  packPaint,
  paintAlpha,
  paintFrame,
  paintRgb,
  paintRgbFromCss,
  rayShellHit,
  ringAxis,
  screenRayDirection,
  sprayHash,
  stampLevel,
  type BrushStamp,
} from './brushFalloff.js';
import { BRUSH_PARAMS_BYTE_SIZE, packBrushParams } from '@/shaders/uniformLayouts.js';
import { calculateSatelliteBufferBudget } from '@/core/buffer/BufferAllocator.js';
import { mat4frustum, mat4lookAt, mat4mul, mat4persp } from '@/utils/math.js';

const WGSL = readFileSync(new URL('../shaders/compute/brush.wgsl', import.meta.url), 'utf8');
const SAT_WGSL = readFileSync(new URL('../shaders/render/satellites.wgsl', import.meta.url), 'utf8');

function wgslConst(name: string): number {
  const m = new RegExp(`const ${name}: (?:u32|f32) = ([0-9.]+)u?;`).exec(WGSL);
  if (!m) throw new Error(`missing WGSL const ${name}`);
  return Number.parseFloat(m[1]);
}

function stamp(center: [number, number, number], radiusKm: number): BrushStamp {
  return { center, radiusKm, axis: [0, 0, 0], strength: 1 };
}

describe('falloff', () => {
  it('is 1 at the centre, 0 at and beyond the radius', () => {
    expect(brushFalloff(0, 400)).toBe(1);
    expect(brushFalloff(400, 400)).toBe(0);
    expect(brushFalloff(1000, 400)).toBe(0);
    expect(brushFalloff(10, 0)).toBe(0);
  });

  it('pins the (1 - t²)² kernel at known points', () => {
    expect(brushFalloff(200, 400)).toBeCloseTo(0.5625, 12); // t=0.5 → 0.75²
    expect(brushFalloff(100, 400)).toBeCloseTo(0.87890625, 12); // t=0.25 → 0.9375²
    expect(brushFalloff(300, 400)).toBeCloseTo(0.19140625, 12); // t=0.75 → 0.4375²
  });

  it('decreases monotonically and has no tail', () => {
    let prev = 1;
    for (let d = 0; d <= 400; d += 10) {
      const w = brushFalloff(d, 400);
      expect(w).toBeLessThanOrEqual(prev);
      prev = w;
    }
    // Smooth edge: just inside the radius is already nearly dark.
    expect(brushFalloff(390, 400)).toBeLessThan(0.003);
  });

  it('rounds to 8 bits the way pack4x8unorm does', () => {
    expect(stampLevel(0)).toBe(0);
    expect(stampLevel(1)).toBe(255);
    expect(stampLevel(2)).toBe(255);
    expect(stampLevel(-1)).toBe(0);
    expect(stampLevel(0.5)).toBe(128); // 127.5 rounds up
    expect(stampLevel(1 / 255)).toBe(1);
    expect(stampLevel(0.4 / 255)).toBe(0);
  });
});

describe('decay', () => {
  it('fades a full stroke to black in exactly fadeSeconds at any frame rate', () => {
    for (const fps of [30, 60, 90, 144, 240]) {
      for (const fade of [2, 3, 5]) {
        const clock = new PaintDecayClock();
        let a = 255;
        let frames = 0;
        while (a > 0 && frames < 10_000) {
          a = paintAlpha(composePaint(packPaint(0xffffff, a), clock.advance(1 / fps, fade), 0, 0));
          frames++;
        }
        // Frame-quantised: the last step lands within one frame of the target.
        expect(frames / fps).toBeGreaterThanOrEqual(fade - 1 / fps - 1e-9);
        expect(frames / fps).toBeLessThanOrEqual(fade + 1 / fps + 1e-9);
      }
    }
  });

  it('does not stall at low values the way per-frame exponential decay does', () => {
    // The trap the linear clock avoids: at 144 Hz a 3 s exponential rounds its
    // last steps back to themselves and never reaches zero.
    const k = Math.exp(-1 / (144 * 0.6));
    let exp = 255;
    for (let i = 0; i < 144 * 10; i++) exp = Math.floor(0.5 + exp * k);
    expect(exp).toBeGreaterThan(0);

    const clock = new PaintDecayClock();
    let lin = 255;
    for (let i = 0; i < 144 * 3 + 2; i++) lin = Math.max(0, lin - clock.advance(1 / 144, 3));
    expect(lin).toBe(0);
  });

  it('carries fractional steps and tolerates bad frame times', () => {
    const clock = new PaintDecayClock();
    // 255 steps / 3 s = 85 steps/s; 1 ms frames deliver 0.085 steps each.
    let total = 0;
    for (let i = 0; i < 1000; i++) total += clock.advance(0.001, 3);
    // 85 exactly in reals; float accumulation may land one step short.
    expect(total).toBeGreaterThanOrEqual(84);
    expect(total).toBeLessThanOrEqual(85);
    expect(clock.advance(Number.NaN, 3)).toBe(0);
    expect(clock.advance(-1, 3)).toBe(0);
    expect(clock.advance(100, 3)).toBe(255);
  });

  it('clamps fade time into the 2–5 s window', () => {
    expect(clampFadeSeconds(0.1)).toBe(BRUSH_MIN_FADE_S);
    expect(clampFadeSeconds(60)).toBe(BRUSH_MAX_FADE_S);
    expect(clampFadeSeconds(3.5)).toBe(3.5);
    expect(clampFadeSeconds(Number.NaN)).toBe(3);
  });
});

describe('compose', () => {
  const blue = paintRgbFromCss('#0000ff');
  const red = paintRgbFromCss('#ff0000');

  it('packs red in the low byte, matching pack4x8unorm', () => {
    expect(paintRgbFromCss('#ff0000')).toBe(0x0000ff);
    expect(paintRgbFromCss('#00ff00')).toBe(0x00ff00);
    expect(paintRgbFromCss('#0000ff')).toBe(0xff0000);
    expect(paintRgbFromCss('nope')).toBe(paintRgbFromCss('#39c8ff'));
  });

  it('max-composes instead of adding', () => {
    const lit = composePaint(0, 0, 200, blue);
    expect(paintAlpha(lit)).toBe(200);
    expect(paintAlpha(composePaint(lit, 0, 100, blue))).toBe(200);
    expect(paintAlpha(composePaint(lit, 0, 250, blue))).toBe(250);
  });

  it('keeps an older colour where it is still brighter than the new stamp', () => {
    const old = packPaint(red, 200);
    expect(paintRgb(composePaint(old, 10, 100, blue))).toBe(red);
    expect(paintRgb(composePaint(old, 10, 250, blue))).toBe(blue);
  });

  it('returns exactly 0 once faded, so the scratch reads as unpainted', () => {
    expect(composePaint(packPaint(red, 3), 3, 0, blue)).toBe(0);
    expect(composePaint(packPaint(red, 3), 200, 0, blue)).toBe(0);
    expect(composePaint(0, 5, 0, blue)).toBe(0);
  });
});

describe('spray hash', () => {
  it('wraps like WGSL u32 arithmetic', () => {
    expect(hashU32(0)).toBe(0);
    expect(hashU32(1)).not.toBe(hashU32(2));
    // Stable and in range for inputs that overflow 32-bit multiplication.
    for (const n of [1, 42, 0x7fffffff, 0xffffffff]) {
      const h = hashU32(n);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
      expect(hashU32(n)).toBe(h);
    }
  });

  it('lights roughly BRUSH_SPRAY_DENSITY of satellites and changes with the seed', () => {
    const n = 20000;
    let kept = 0;
    let changed = 0;
    for (let i = 0; i < n; i++) {
      const h = sprayHash(i, 7);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      if (h < BRUSH_SPRAY_DENSITY) kept++;
      if (h < BRUSH_SPRAY_DENSITY !== sprayHash(i, 8) < BRUSH_SPRAY_DENSITY) changed++;
    }
    expect(kept / n).toBeGreaterThan(BRUSH_SPRAY_DENSITY - 0.02);
    expect(kept / n).toBeLessThan(BRUSH_SPRAY_DENSITY + 0.02);
    expect(changed).toBeGreaterThan(n * 0.2);
  });
});

describe('paintFrame (CPU reference of one dispatch)', () => {
  const positions = new Float32Array([
    6921, 0, 0, 1, // 0: at the stamp centre
    6921, 200, 0, 1, // 1: half radius
    6921, 399, 0, 1, // 2: just inside the edge
    6921, 600, 0, 1, // 3: outside
    0, 0, 0, 1, // 4: not launched (zero position)
    6921, 0, 0, -1, // 5: decayed flag
  ]);
  const rgb = paintRgbFromCss('#39c8ff');

  it('paints by falloff and skips inactive sentinels', () => {
    const paint = new Uint32Array(6);
    paintFrame(positions, paint, 6, {
      mode: BrushMode.POINT,
      stamps: [stamp([6921, 0, 0], 400)],
      decaySteps: 0,
      rgb,
      seed: 0,
    });
    expect(paint[0]).toBe(packPaint(rgb, 255));
    expect(paintAlpha(paint[1])).toBe(stampLevel(0.5625));
    expect(paintAlpha(paint[2])).toBe(0); // 399/400 → weight 2.5e-5 → level 0
    expect(paint[3]).toBe(0);
    expect(paint[4]).toBe(0);
    expect(paint[5]).toBe(0);
  });

  it('holds while stamping, then fades out within the fade window after release', () => {
    const paint = new Uint32Array(6);
    const clock = new PaintDecayClock();
    const dt = 1 / 60;
    for (let f = 0; f < 60; f++) {
      paintFrame(positions, paint, 6, {
        mode: BrushMode.POINT,
        stamps: [stamp([6921, 0, 0], 400)],
        decaySteps: clock.advance(dt, 3),
        rgb,
        seed: f,
      });
    }
    expect(paintAlpha(paint[0])).toBe(255);

    let frames = 0;
    while (paint.some((v) => v !== 0) && frames < 1000) {
      paintFrame(positions, paint, 6, {
        mode: BrushMode.POINT,
        stamps: [],
        decaySteps: clock.advance(dt, 3),
        rgb,
        seed: 0,
      });
      frames++;
    }
    expect(frames * dt).toBeGreaterThan(2.9);
    expect(frames * dt).toBeLessThanOrEqual(3 + 2 * dt);
  });

  it('ring mode lights the plane band regardless of distance to the centre', () => {
    const ring = new Float32Array([
      -6921, 0, 0, 1, // far side of the Earth, in the z=0 plane
      0, 6921, 5, 1, // in the band
      0, 0, 6921, 1, // on the axis, far out of plane
    ]);
    const paint = new Uint32Array(3);
    paintFrame(ring, paint, 3, {
      mode: BrushMode.RING,
      stamps: [{ center: [6921, 0, 0], radiusKm: 400, axis: [0, 0, 1], strength: 1 }],
      decaySteps: 0,
      rgb,
      seed: 0,
    });
    expect(paintAlpha(paint[0])).toBe(255);
    expect(paintAlpha(paint[1])).toBeGreaterThan(200);
    expect(paint[2]).toBe(0);
  });

  it('uses the strongest of several stamps and ignores stamps past the cap', () => {
    const paint = new Uint32Array(1);
    const far = stamp([0, 0, 6921], 400);
    const stamps = Array.from({ length: BRUSH_MAX_STAMPS }, () => far);
    stamps.push(stamp([6921, 0, 0], 400)); // ninth — the shader has no slot for it
    paintFrame(positions, paint, 1, { mode: BrushMode.POINT, stamps, decaySteps: 0, rgb, seed: 0 });
    expect(paint[0]).toBe(0);
  });
});

describe('pointer ray → shell', () => {
  it('hits the near side from outside and the far side from inside', () => {
    const outside = rayShellHit([30000, 0, 0], [-1, 0, 0], 6921)!;
    expect(outside[0]).toBeCloseTo(6921, 6);
    const inside = rayShellHit([0, 0, 0], [0, 1, 0], 6921)!;
    expect(inside[1]).toBeCloseTo(6921, 6);
    expect(rayShellHit([30000, 0, 0], [1, 0, 0], 6921)).toBeNull();
    expect(rayShellHit([30000, 10000, 0], [-1, 0, 0], 6921)).toBeNull();
  });

  it('unprojects the screen centre onto the point the camera looks at', () => {
    const eye: [number, number, number] = [0, -30000, 0];
    const view = mat4lookAt(eye, [0, 0, 0], [0, 0, 1]);
    const proj = mat4persp(Math.PI / 3, 16 / 9, 10, 1_000_000);
    const dir = screenRayDirection(view, proj, 0, 0)!;
    expect(dir[1]).toBeCloseTo(1, 6);
    const hit = rayShellHit(eye, dir)!;
    expect(hit[1]).toBeCloseTo(-BRUSH_SHELL_RADIUS_KM, 3);

    // Every NDC point must reproject to itself through the forward matrices.
    const vp = mat4mul(proj, view);
    for (const [nx, ny] of [[0.1, 0], [-0.12, 0.1], [0.05, -0.2]] as const) {
      const p = rayShellHit(eye, screenRayDirection(view, proj, nx, ny)!)!;
      const w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
      expect((vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12]) / w).toBeCloseTo(nx, 4);
      expect((vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13]) / w).toBeCloseTo(ny, 4);
    }
    // Past the limb: a corner ray misses the shell.
    expect(rayShellHit(eye, screenRayDirection(view, proj, 0.99, 0.99)!)).toBeNull();
  });

  it('handles an off-axis (XR eye) frustum', () => {
    const eye: [number, number, number] = [0, -30000, 0];
    const view = mat4lookAt(eye, [0, 0, 0], [0, 0, 1]);
    const proj = mat4frustum(-8, 4, -5, 6, 10, 1_000_000);
    const vp = mat4mul(proj, view);
    for (const [nx, ny] of [[0, 0], [0.2, -0.1]] as const) {
      const p = rayShellHit(eye, screenRayDirection(view, proj, nx, ny)!)!;
      const w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
      expect((vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12]) / w).toBeCloseTo(nx, 4);
      expect((vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13]) / w).toBeCloseTo(ny, 4);
    }
  });

  it('interpolates a fast drag into evenly spaced stamps on the shell', () => {
    const from: [number, number, number] = [6921, 0, 0];
    const to: [number, number, number] = [0, 6921, 0];
    const stamps = interpolateStroke(from, to, 400);
    expect(stamps).toHaveLength(BRUSH_MAX_STAMPS); // ~9800 km chord, capped
    expect(stamps[stamps.length - 1]).toEqual(to);
    for (const p of stamps) expect(Math.hypot(...p)).toBeCloseTo(6921, 6);

    const short = interpolateStroke(from, [6921, 150, 0], 400);
    expect(short).toHaveLength(1);
    expect(interpolateStroke(null, to, 400)).toEqual([to]);
  });

  it('builds a ring plane through the hit that contains the tangent', () => {
    const hit: [number, number, number] = [6921, 0, 0];
    const axis = ringAxis(hit, [0, 7.6, 0]);
    expect(axis[2]).toBeCloseTo(1, 12);
    const degenerate = ringAxis(hit, [1, 0, 0]);
    expect(Math.hypot(...degenerate)).toBeCloseTo(1, 12);
    expect(degenerate[0]).toBeCloseTo(0, 12);
  });
});

describe('GPU mirror', () => {
  it('shares constants with brush.wgsl', () => {
    expect(wgslConst('BRUSH_MAX_STAMPS')).toBe(BRUSH_MAX_STAMPS);
    expect(wgslConst('BRUSH_SPRAY_DENSITY')).toBe(BRUSH_SPRAY_DENSITY);
    expect(wgslConst('BRUSH_RING_WIDTH_FRACTION')).toBe(BRUSH_RING_WIDTH_FRACTION);
    expect(wgslConst('BRUSH_RING_MIN_HALF_WIDTH_KM')).toBe(BRUSH_RING_MIN_HALF_WIDTH_KM);
    expect(wgslConst('BRUSH_MODE_POINT')).toBe(BrushMode.POINT);
    expect(wgslConst('BRUSH_MODE_SPRAY')).toBe(BrushMode.SPRAY);
    expect(wgslConst('BRUSH_MODE_RING')).toBe(BrushMode.RING);
    expect(WGSL).toContain(`stamps      : array<BrushStamp, ${BRUSH_MAX_STAMPS}>`);
    expect(WGSL).toContain('0x7feb352du');
    expect(WGSL).toContain('0x846ca68bu');
    expect(WGSL).toContain('0x9e3779b9u');
  });

  it('packs BrushParams at the WGSL uniform layout', () => {
    expect(BRUSH_PARAMS_BYTE_SIZE).toBe(32 + BRUSH_MAX_STAMPS * BRUSH_STAMP_BYTES);
    const ab = packBrushParams({
      mode: BrushMode.RING,
      decaySteps: 300,
      rgb: 0x123456,
      seed: 9,
      stamps: [{ center: [1, 2, 3], radiusKm: 400, axis: [0, 0, 1], strength: 0.5 }],
    });
    const u32 = new Uint32Array(ab);
    const f32 = new Float32Array(ab);
    expect(ab.byteLength).toBe(BRUSH_PARAMS_BYTE_SIZE);
    expect([u32[0], u32[1], u32[2], u32[3], u32[4]]).toEqual([1, 2, 255, 0x123456, 9]);
    expect(Array.from(f32.slice(8, 16))).toEqual([1, 2, 3, 400, 0, 0, 1, 0.5]);
  });

  it('reads paint from the packed animation scratch in the satellite shader', () => {
    expect(SAT_WGSL).toContain('@group(0) @binding(8) var<storage, read> anim_scratch : array<u32>;');
    expect(WGSL).toContain('var<storage, read_write> paint : array<u32>;');
  });

  it('adds no satellite storage buffer to the ledger', () => {
    // Paint shares the 4-bytes-per-satellite animScratch slot; the ledger has no
    // brush entry and the 1M totals are unchanged.
    const { breakdown } = calculateSatelliteBufferBudget(1 << 20);
    expect(Object.keys(breakdown).some((k) => /brush|paint/i.test(k))).toBe(false);
    expect(breakdown.animScratch).toBe((1 << 20) * 4);
  });
});
