/**
 * Packed animation scratch — bit ownership, CPU mirror of
 * `src/shaders/compute/animScratchPack.wgsl` (constants pinned by
 * `animScratchPacking.test.ts`).
 *
 * One u32 per satellite, split into two 16-bit halves so the Light Brush and
 * Sky Strips can both be visible:
 *
 *   bits 31..24  brush intensity (a8)    bits 23..16  brush colour (RGB332)
 *   bits 15..8   strips intensity (a8)   bits  7..0   strips colour (RGB332)
 *
 * A half is `(a8 << 8) | rgb332` and is exactly 0 when its alpha is 0. Every
 * writer preserves the other half. Smile V2 writes whole words and is not
 * dispatched while either half is in use.
 */

export const ANIM_SCRATCH_BRUSH_SHIFT = 16;
export const ANIM_SCRATCH_STRIPS_SHIFT = 0;
export const ANIM_SCRATCH_HALF_MASK = 0xffff;

/** rgb24 (red in the low byte, pack4x8unorm order) → RGB332, rounding to nearest. */
export function rgb332FromRgb24(rgb: number): number {
  const r = Math.floor(((rgb & 0xff) * 7 + 127) / 255);
  const g = Math.floor((((rgb >>> 8) & 0xff) * 7 + 127) / 255);
  const b = Math.floor((((rgb >>> 16) & 0xff) * 3 + 127) / 255);
  return (r << 5) | (g << 2) | b;
}

/** RGB332 → linear 0..1 triple, as the satellite shader decodes it. */
export function rgbFromRgb332(c: number): [number, number, number] {
  return [((c >>> 5) & 7) / 7, ((c >>> 2) & 7) / 7, (c & 3) / 3];
}

export function animHalf(packed: number, shift: number): number {
  return (packed >>> shift) & ANIM_SCRATCH_HALF_MASK;
}

export function animHalfPack(alpha: number, c332: number): number {
  const a = alpha & 0xff;
  return a === 0 ? 0 : (a << 8) | (c332 & 0xff);
}

export function animHalfAlpha(half: number): number {
  return (half >>> 8) & 0xff;
}

export function animHalfColor(half: number): number {
  return half & 0xff;
}

export function animWithHalf(packed: number, shift: number, half: number): number {
  const mask = (ANIM_SCRATCH_HALF_MASK << shift) >>> 0;
  return ((packed & ~mask) | ((half & ANIM_SCRATCH_HALF_MASK) << shift)) >>> 0;
}
