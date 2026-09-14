import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BRUSH_DISCLAIMER,
  BrushController,
  formatBrushStatus,
  parseBrushParams,
  type BrushHost,
  type BrushView,
} from './BrushController.js';
import { BrushMode } from '@/physics/brushFalloff.js';
import { mat4lookAt, mat4persp } from '@/utils/math.js';

function host(overrides: Partial<BrushHost> = {}): BrushHost {
  return {
    pickSatellite: () => Promise.resolve(-1),
    satellitePosition: () => null,
    satelliteVelocity: () => null,
    ...overrides,
  };
}

/** God-view-like camera looking at the Earth centre from 30,000 km. */
function view(): BrushView {
  const eye: [number, number, number] = [0, -30000, 0];
  return {
    cameraPosition: eye,
    cameraUp: [0, 0, 1],
    view: mat4lookAt(eye, [0, 0, 0], [0, 0, 1]),
    projection: mat4persp(Math.PI / 3, 1, 10, 1_000_000),
    getRect: () => ({ left: 0, top: 0, width: 800, height: 800 }),
  };
}

function header(ab: ArrayBuffer) {
  const u32 = new Uint32Array(ab);
  const f32 = new Float32Array(ab);
  return {
    stampCount: u32[0],
    mode: u32[1],
    decaySteps: u32[2],
    firstCenter: [f32[8], f32[9], f32[10]],
    firstRadius: f32[11],
  };
}

function enabledBrush(h = host()): BrushController {
  const brush = new BrushController(h);
  brush.userOverride = true;
  brush.resolveEnabled();
  return brush;
}

describe('parseBrushParams', () => {
  it('reads ?brush and friends, clamping numbers into range', () => {
    const p = parseBrushParams('?brush=1&brushMode=ring&brushKm=99999&brushFade=0.5&brushColor=FF8800');
    expect(p).toEqual({ enabled: true, mode: BrushMode.RING, radiusKm: 2000, fadeSeconds: 2, color: '#ff8800' });
  });

  it('leaves everything unset (off by default) without params', () => {
    expect(parseBrushParams('')).toEqual({
      enabled: null,
      mode: null,
      radiusKm: null,
      fadeSeconds: null,
      color: null,
    });
    expect(parseBrushParams('?brush=0').enabled).toBe(false);
    expect(parseBrushParams('?brushMode=gravity&brushColor=red').mode).toBeNull();
    expect(parseBrushParams('?brushMode=plane-ring').mode).toBe(BrushMode.RING);
    expect(parseBrushParams('?brushColor=red').color).toBeNull();
  });
});

describe('enable rule', () => {
  it('is off by default', () => {
    const brush = new BrushController(host());
    brush.resolveEnabled();
    expect(brush.enabled).toBe(false);
    expect(brush.ownsScratch()).toBe(false);
  });

  it('low quality / mobile forces it off but keeps the user choice', () => {
    const brush = enabledBrush();
    expect(brush.enabled).toBe(true);
    brush.qualityForcesOff = true;
    brush.resolveEnabled();
    expect(brush.enabled).toBe(false);
    expect(brush.userOverride).toBe(true);
    brush.qualityForcesOff = false;
    brush.resolveEnabled();
    expect(brush.enabled).toBe(true);
  });

  it('stays off when unavailable (WebGL2 fallback)', () => {
    const brush = new BrushController(host());
    brush.unavailableReason = 'WebGPU only';
    brush.userOverride = true;
    expect(brush.resolveEnabled()).toBe(false);
  });

  it('ignores strokes while disabled', () => {
    const brush = new BrushController(host());
    brush.beginNdcStroke(0, 0);
    expect(brush.isStroking()).toBe(false);
    expect(brush.tick(1 / 60, view())).toBeNull();
  });
});

describe('tick', () => {
  it('dispatches nothing when idle', () => {
    const brush = enabledBrush();
    for (let i = 0; i < 10; i++) expect(brush.tick(1 / 60, view())).toBeNull();
  });

  it('stamps where the screen-centre ray meets the shell', () => {
    const brush = enabledBrush();
    brush.beginNdcStroke(0, 0);
    const params = brush.tick(1 / 60, view());
    expect(params).not.toBeNull();
    const h = header(params!);
    expect(h.stampCount).toBe(1);
    expect(h.mode).toBe(BrushMode.POINT);
    expect(h.firstCenter[1]).toBeCloseTo(-6921, 0);
    expect(h.firstRadius).toBe(400);
  });

  it('keeps dispatching after release until the fade window has passed, then stops', () => {
    const brush = enabledBrush();
    brush.setFadeSeconds(2);
    brush.beginNdcStroke(0, 0);
    brush.tick(1 / 60, view());
    brush.endStroke();

    let frames = 0;
    while (brush.tick(1 / 60, view()) !== null) {
      frames++;
      expect(frames).toBeLessThan(1000);
    }
    // 2 s at 60 Hz, within a frame.
    expect(frames).toBeGreaterThanOrEqual(119);
    expect(frames).toBeLessThanOrEqual(121);
    expect(brush.ownsScratch()).toBe(true); // still enabled
  });

  it('emits one full-decay clear when disabled mid-fade, then releases the scratch', () => {
    const brush = enabledBrush();
    brush.beginNdcStroke(0, 0);
    brush.tick(1 / 60, view());
    brush.userOverride = false;
    brush.resolveEnabled();
    expect(brush.isStroking()).toBe(false);
    expect(brush.ownsScratch()).toBe(true);

    const clear = brush.tick(1 / 60, view());
    expect(header(clear!).decaySteps).toBe(255);
    expect(header(clear!).stampCount).toBe(0);
    expect(brush.ownsScratch()).toBe(false);
    expect(brush.tick(1 / 60, view())).toBeNull();
  });

  it('paints nothing when the ray misses the shell and the picker misses too', () => {
    const brush = enabledBrush();
    brush.beginNdcStroke(0.99, 0.99); // off into space past the limb
    expect(brush.tick(1 / 60, view())).toBeNull();
  });

  it('falls back to the picked satellite when a screen ray misses the shell', async () => {
    const brush = enabledBrush(
      host({
        pickSatellite: () => Promise.resolve(12),
        satellitePosition: (i) => (i === 12 ? [7000, 1, 2] : null),
      }),
    );
    // Far corner of an 800×800 canvas: past the limb at this distance.
    brush.beginScreenStroke(799, 1);
    expect(brush.tick(1 / 60, view())).toBeNull(); // pick requested, not yet resolved
    await Promise.resolve();
    await Promise.resolve();
    const params = brush.tick(1 / 60, view());
    expect(params).not.toBeNull();
    expect(header(params!).firstCenter).toEqual([7000, 1, 2]);
  });

  it('accepts a world-space ray (XR controller)', () => {
    const brush = enabledBrush();
    brush.beginRayStroke([30000, 0, 0], [-1, 0, 0]);
    const h = header(brush.tick(1 / 60, view())!);
    expect(h.firstCenter[0]).toBeCloseTo(6921, 0);
    brush.updateRay([0, 30000, 0], [0, -1, 0]);
    const next = brush.tick(1 / 60, view())!;
    expect(header(next).stampCount).toBeGreaterThan(1); // interpolated across the drag
  });

  it('ring mode sends one plane per frame', () => {
    const brush = enabledBrush();
    brush.setMode(BrushMode.RING);
    brush.beginNdcStroke(0, 0);
    const h = header(brush.tick(1 / 60, view())!);
    expect(h.stampCount).toBe(1);
    expect(h.mode).toBe(BrushMode.RING);
  });
});

describe('HUD copy', () => {
  const forbidden = /gravit|n-body|perturb|\bssa\b|situational awareness|collision|conjunction|avoid|track/i;

  it('never claims physics or space-safety capability', () => {
    const strings = [
      BRUSH_DISCLAIMER,
      ...[true, false].flatMap((enabled) =>
        [BrushMode.POINT, BrushMode.SPRAY, BrushMode.RING].flatMap((mode) => [
          formatBrushStatus({ enabled, wanted: true, unavailableReason: null, qualityForcesOff: false, mode }),
          formatBrushStatus({ enabled, wanted: true, unavailableReason: null, qualityForcesOff: true, mode }),
          formatBrushStatus({ enabled, wanted: true, unavailableReason: 'WebGPU only', qualityForcesOff: false, mode }),
        ]),
      ),
    ];
    for (const s of strings) expect(s).not.toMatch(forbidden);

    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    const section = /<section id="brush-controls"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
    expect(section).not.toBe('');
    expect(section).not.toMatch(forbidden);
    expect(section.replace(/\s+/g, ' ').replace('&mdash;', '—')).toContain(BRUSH_DISCLAIMER);
  });

  it('says why it is off', () => {
    expect(
      formatBrushStatus({ enabled: false, wanted: true, unavailableReason: null, qualityForcesOff: true, mode: 0 }),
    ).toBe('Brush: off on Low quality and mobile');
    expect(
      formatBrushStatus({ enabled: false, wanted: false, unavailableReason: null, qualityForcesOff: false, mode: 0 }),
    ).toBe('Brush: off');
  });
});
