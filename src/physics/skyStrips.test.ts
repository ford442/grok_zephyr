import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  STRIPS_BEAT_WAVE_FLOOR,
  STRIPS_CHASE_BANDS,
  STRIPS_CHASE_WIDTH,
  STRIPS_PEAK,
  STRIPS_SPARKLE_DENSITY,
  STRIPS_WAVE_LOBES,
  StripsMode,
  argumentOfLatitude,
  clampBpm,
  sparkleHash,
  stripsFrame,
  stripsFrameFromClock,
  stripsSample,
  type StripsFrame,
} from './skyStrips.js';
import { ANIM_SCRATCH_STRIPS_SHIFT, animHalf, animHalfAlpha } from './animScratchPacking.js';
import { STRIPS_PARAMS_BYTE_SIZE, packStripsParams } from '@/shaders/uniformLayouts.js';
import { calculateSatelliteBufferBudget } from '@/core/buffer/BufferAllocator.js';

const WGSL = readFileSync(new URL('../shaders/compute/skyStrips.wgsl', import.meta.url), 'utf8');

function wgslConst(name: string): number {
  const m = new RegExp(`const ${name}: (?:u32|f32) = ([0-9.]+)u?;`).exec(WGSL);
  if (!m) throw new Error(`missing WGSL const ${name}`);
  return Number.parseFloat(m[1]);
}

const R = 6921;
const DEG = Math.PI / 180;

/** Simple-mode position, as orbital.wgsl builds it. */
function circular(raan: number, inc: number, m: number): [number, number, number] {
  const cM = Math.cos(m);
  const sM = Math.sin(m);
  const cR = Math.cos(raan);
  const sR = Math.sin(raan);
  const cI = Math.cos(inc);
  const sI = Math.sin(inc);
  return [R * (cR * cM - sR * sM * cI), R * (sR * cM + cR * sM * cI), R * sM * sI];
}

function frame(mode: StripsFrame['mode'], over: Partial<StripsFrame> = {}): StripsFrame {
  return { ...stripsFrameFromClock(mode, 0, 120, null), ...over };
}

describe('argumentOfLatitude', () => {
  it.each([
    ['equatorial', 0, 0],
    ['53°', 1.2, 53 * DEG],
    ['polar', 4.0, 90 * DEG],
    ['sun-synchronous', 2.5, 97.6 * DEG],
  ])('recovers the along-track angle of a %s orbit', (_name, raan, inc) => {
    for (const m of [-3, -1.5, 0, 0.4, 2, 3.1]) {
      expect(argumentOfLatitude(circular(raan, inc, m), raan, inc)).toBeCloseTo(m, 9);
    }
  });
});

describe('patterns', () => {
  it('WAVE travels with the phase and stays in 0..1', () => {
    const pos = circular(0.3, 53 * DEG, 0.8);
    const a = stripsSample(frame(StripsMode.WAVE, { wavePhase: 0 }), 0, pos, 0.3, 53 * DEG);
    const b = stripsSample(frame(StripsMode.WAVE, { wavePhase: 2 * Math.PI }), 0, pos, 0.3, 53 * DEG);
    expect(a.intensity).toBeCloseTo(b.intensity, 9);
    // A crest at u = phase / lobes.
    const crest = circular(0.3, 53 * DEG, Math.PI / 2 / STRIPS_WAVE_LOBES);
    expect(stripsSample(frame(StripsMode.WAVE), 0, crest, 0.3, 53 * DEG).intensity).toBeCloseTo(1, 9);
    for (let m = -3; m < 3; m += 0.37) {
      const s = stripsSample(frame(StripsMode.WAVE, { wavePhase: 1.1 }), 0, circular(1, 0.9, m), 1, 0.9);
      expect(s.intensity).toBeGreaterThanOrEqual(0);
      expect(s.intensity).toBeLessThanOrEqual(1);
    }
  });

  it('CHASE lights a band of planes whose head moves with the offset', () => {
    const raanHead = (0.5 / STRIPS_CHASE_BANDS) * 2 * Math.PI;
    const pos = circular(raanHead, 0.9, 0);
    const lit = stripsSample(frame(StripsMode.CHASE, { chaseOffset: 0.5 }), 0, pos, raanHead, 0.9);
    expect(lit.intensity).toBeCloseTo(1, 6);
    const dark = stripsSample(frame(StripsMode.CHASE, { chaseOffset: 0.5 - STRIPS_CHASE_WIDTH - 0.01 }), 0, pos, raanHead, 0.9);
    expect(dark.intensity).toBe(0);
    // Periodic in the offset.
    const again = stripsSample(frame(StripsMode.CHASE, { chaseOffset: 0.5 + 1 - 1e-12 }), 0, pos, raanHead, 0.9);
    expect(again.intensity).toBeCloseTo(lit.intensity, 6);
  });

  it('BEAT is dark with no audio and scales with bass', () => {
    const pos = circular(0, 0.5, 0.2);
    expect(stripsSample(frame(StripsMode.BEAT), 0, pos, 0, 0.5).intensity).toBe(0);
    const loud = stripsSample(frame(StripsMode.BEAT, { bass: 1, presence: 0.25 }), 0, pos, 0, 0.5);
    expect(loud.intensity).toBeGreaterThanOrEqual(STRIPS_BEAT_WAVE_FLOOR);
    expect(loud.mix).toBe(0.25);
  });

  it('SPARKLE is deterministic and lights about its density', () => {
    let lit = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const s = stripsSample(frame(StripsMode.SPARKLE, { seed: 7, sparkleBucket: 3 }), i, [R, 0, 0], 0, 0);
      if (s.intensity > 0) lit++;
    }
    expect(lit / n).toBeGreaterThan(STRIPS_SPARKLE_DENSITY * 0.8);
    expect(lit / n).toBeLessThan(STRIPS_SPARKLE_DENSITY * 1.2);
    expect(sparkleHash(42, 7, 3)).toBe(sparkleHash(42, 7, 3));
    expect(sparkleHash(42, 7, 3)).not.toBe(sparkleHash(42, 7, 4));
  });
});

describe('stripsFrameFromClock', () => {
  it('reduces time to small phases and clamps tempo and bands', () => {
    const f = stripsFrameFromClock(StripsMode.WAVE, 1e7 + 0.25, 120, { bass: 2, presence: -1 });
    expect(f.wavePhase).toBeGreaterThanOrEqual(0);
    expect(f.wavePhase).toBeLessThan(2 * Math.PI);
    expect(f.chaseOffset).toBeGreaterThanOrEqual(0);
    expect(f.chaseOffset).toBeLessThan(1);
    expect(f.sparkleFrac).toBeCloseTo(0, 6);
    expect(f.bass).toBe(1);
    expect(f.presence).toBe(0);
    expect(clampBpm(10)).toBe(40);
    expect(clampBpm(999)).toBe(240);
  });
});

describe('stripsFrame (CPU reference of one dispatch)', () => {
  it('writes only the low half and keeps brush paint', () => {
    const n = 4;
    const positions = new Float32Array(n * 4);
    const elements = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      positions.set([...circular(0, 0.9, i * 0.2), 0], i * 4);
      elements.set([0, 0.9, i * 0.2, 0], i * 4);
    }
    positions.set([0, 0, 0, 0], 12); // inactive sentinel
    const scratch = new Uint32Array([0xc8e00000, 0, 0x12345678, 0xffff0000 | 0x1234]);
    stripsFrame(positions, elements, scratch, n, frame(StripsMode.WAVE, { wavePhase: 0.7 }));
    expect(scratch[0] >>> 16).toBe(0xc8e0);
    expect(scratch[2] >>> 16).toBe(0x1234);
    expect(animHalfAlpha(animHalf(scratch[1], ANIM_SCRATCH_STRIPS_SHIFT))).toBeGreaterThan(0);
    expect(scratch[3]).toBe(0xffff0000); // inactive: strips half cleared, brush kept
    stripsFrame(positions, elements, scratch, n, frame(StripsMode.CLEAR));
    expect(Array.from(scratch, (w) => w & 0xffff)).toEqual([0, 0, 0, 0]);
    expect(scratch[0]).toBe(0xc8e00000);
  });
});

describe('GPU mirror', () => {
  it('shares constants with skyStrips.wgsl', () => {
    expect(wgslConst('STRIPS_MODE_CLEAR')).toBe(StripsMode.CLEAR);
    expect(wgslConst('STRIPS_MODE_WAVE')).toBe(StripsMode.WAVE);
    expect(wgslConst('STRIPS_MODE_CHASE')).toBe(StripsMode.CHASE);
    expect(wgslConst('STRIPS_MODE_BEAT')).toBe(StripsMode.BEAT);
    expect(wgslConst('STRIPS_MODE_SPARKLE')).toBe(StripsMode.SPARKLE);
    expect(wgslConst('STRIPS_WAVE_LOBES')).toBe(STRIPS_WAVE_LOBES);
    expect(wgslConst('STRIPS_CHASE_BANDS')).toBe(STRIPS_CHASE_BANDS);
    expect(wgslConst('STRIPS_CHASE_WIDTH')).toBe(STRIPS_CHASE_WIDTH);
    expect(wgslConst('STRIPS_SPARKLE_DENSITY')).toBe(STRIPS_SPARKLE_DENSITY);
    expect(wgslConst('STRIPS_BEAT_WAVE_FLOOR')).toBe(STRIPS_BEAT_WAVE_FLOOR);
    expect(wgslConst('STRIPS_PEAK')).toBe(STRIPS_PEAK);
    expect(WGSL).toContain('0x9e3779b9u');
    expect(WGSL).toContain('0x85ebca6bu');
    expect(WGSL).toContain('#import "animScratchPack.wgsl"');
    expect(WGSL).toContain('override num_satellites');
  });

  it('packs StripsParams at the WGSL uniform layout', () => {
    expect(STRIPS_PARAMS_BYTE_SIZE).toBe(64);
    const ab = packStripsParams({
      mode: StripsMode.CHASE,
      seed: 9,
      colorA: 0x123456,
      colorB: 0xabcdef,
      sparkleBucket: 77,
      wavePhase: 1.5,
      chaseOffset: 0.25,
      sparkleFrac: 0.5,
      bass: 0.75,
      presence: 0.125,
    });
    const u32 = new Uint32Array(ab);
    const f32 = new Float32Array(ab);
    expect(ab.byteLength).toBe(STRIPS_PARAMS_BYTE_SIZE);
    expect(Array.from(u32.slice(0, 5))).toEqual([2, 9, 0x123456, 0xabcdef, 77]);
    expect(Array.from(f32.slice(5, 10))).toEqual([1.5, 0.25, 0.5, 0.75, 0.125]);
    // Field order in the WGSL struct.
    const order = ['mode', 'seed', 'color_a', 'color_b', 'sparkle_bucket', 'wave_phase', 'chase_offset', 'sparkle_frac', 'bass', 'presence'];
    const idx = order.map((f) => WGSL.indexOf(`  ${f} `));
    expect(idx.every((v, i) => v > 0 && (i === 0 || v > idx[i - 1]))).toBe(true);
  });

  it('adds no satellite storage buffer to the ledger at 1M', () => {
    const { breakdown } = calculateSatelliteBufferBudget(1 << 20);
    expect(Object.keys(breakdown).some((k) => /strip/i.test(k))).toBe(false);
    expect(breakdown.animScratch).toBe((1 << 20) * 4);
  });
});
