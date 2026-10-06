import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ANIM_SCRATCH_BRUSH_SHIFT,
  ANIM_SCRATCH_HALF_MASK,
  ANIM_SCRATCH_STRIPS_SHIFT,
  animHalf,
  animHalfAlpha,
  animHalfColor,
  animHalfPack,
  animWithHalf,
  rgb332FromRgb24,
  rgbFromRgb332,
} from './animScratchPacking.js';

const WGSL = readFileSync(new URL('../shaders/compute/animScratchPack.wgsl', import.meta.url), 'utf8');
const SAT_WGSL = readFileSync(new URL('../shaders/render/satellites.wgsl', import.meta.url), 'utf8');

function wgslConst(name: string): number {
  const m = new RegExp(`const ${name}: u32 = ([0-9]+)u;`).exec(WGSL);
  if (!m) throw new Error(`missing WGSL const ${name}`);
  return Number.parseInt(m[1], 10);
}

describe('animScratch bit ownership', () => {
  it('shares its constants with animScratchPack.wgsl', () => {
    expect(wgslConst('ANIM_SCRATCH_BRUSH_SHIFT')).toBe(ANIM_SCRATCH_BRUSH_SHIFT);
    expect(wgslConst('ANIM_SCRATCH_STRIPS_SHIFT')).toBe(ANIM_SCRATCH_STRIPS_SHIFT);
    expect(wgslConst('ANIM_SCRATCH_HALF_MASK')).toBe(ANIM_SCRATCH_HALF_MASK);
  });

  it('splits the word into two non-overlapping halves', () => {
    const brushMask = (ANIM_SCRATCH_HALF_MASK << ANIM_SCRATCH_BRUSH_SHIFT) >>> 0;
    const stripsMask = (ANIM_SCRATCH_HALF_MASK << ANIM_SCRATCH_STRIPS_SHIFT) >>> 0;
    expect(brushMask & stripsMask).toBe(0);
    expect((brushMask | stripsMask) >>> 0).toBe(0xffffffff);
  });

  it('writes one half without touching the other', () => {
    const word = animWithHalf(0, ANIM_SCRATCH_BRUSH_SHIFT, animHalfPack(200, 0xe0));
    const both = animWithHalf(word, ANIM_SCRATCH_STRIPS_SHIFT, animHalfPack(90, 0x1c));
    expect(animHalf(both, ANIM_SCRATCH_BRUSH_SHIFT)).toBe(animHalf(word, ANIM_SCRATCH_BRUSH_SHIFT));
    expect(animHalfAlpha(animHalf(both, ANIM_SCRATCH_STRIPS_SHIFT))).toBe(90);
    expect(animHalfColor(animHalf(both, ANIM_SCRATCH_STRIPS_SHIFT))).toBe(0x1c);
    expect(animWithHalf(both, ANIM_SCRATCH_STRIPS_SHIFT, 0)).toBe(word);
    expect(animWithHalf(both, ANIM_SCRATCH_BRUSH_SHIFT, 0)).toBe(animHalfPack(90, 0x1c));
  });

  it('packs a zero alpha to exactly 0, whatever the colour', () => {
    expect(animHalfPack(0, 0xff)).toBe(0);
    expect(animHalfPack(256, 0xff)).toBe(0);
  });
});

describe('RGB332', () => {
  it('keeps primaries, black and white exact', () => {
    expect(rgb332FromRgb24(0x000000)).toBe(0);
    expect(rgb332FromRgb24(0xffffff)).toBe(0xff);
    // Red is the low byte (pack4x8unorm order).
    expect(rgbFromRgb332(rgb332FromRgb24(0x0000ff))).toEqual([1, 0, 0]);
    expect(rgbFromRgb332(rgb332FromRgb24(0x00ff00))).toEqual([0, 1, 0]);
    expect(rgbFromRgb332(rgb332FromRgb24(0xff0000))).toEqual([0, 0, 1]);
  });

  it('rounds to the nearest level on every channel', () => {
    for (let v = 0; v < 256; v += 5) {
      const [r, g, b] = rgbFromRgb332(rgb332FromRgb24(v | (v << 8) | (v << 16)));
      expect(Math.abs(r - v / 255)).toBeLessThanOrEqual(0.5 / 7 + 1e-9);
      expect(Math.abs(g - v / 255)).toBeLessThanOrEqual(0.5 / 7 + 1e-9);
      expect(Math.abs(b - v / 255)).toBeLessThanOrEqual(0.5 / 3 + 1e-9);
    }
  });

  it('matches the WGSL rounding expression', () => {
    expect(WGSL).toContain('(((rgb & 255u) * 7u) + 127u) / 255u');
    expect(WGSL).toContain('((((rgb >> 16u) & 255u) * 3u) + 127u) / 255u');
  });
});

describe('satellite shader', () => {
  it('decodes both halves through the shared include, strips under brush', () => {
    expect(SAT_WGSL).toContain('#import "../compute/animScratchPack.wgsl"');
    expect(SAT_WGSL).toContain('array<u32, 2>(ANIM_SCRATCH_STRIPS_SHIFT, ANIM_SCRATCH_BRUSH_SHIFT)');
  });
});
