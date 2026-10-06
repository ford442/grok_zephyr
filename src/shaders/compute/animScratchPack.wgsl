// Packed animation scratch (animScratch, one u32 per satellite): who owns
// which bits. Pulled in with #import by brush.wgsl, skyStrips.wgsl and
// satellites.wgsl.
//
//   bits 31..24  Light Brush intensity (a8, linear 1/255 decay)
//   bits 23..16  Light Brush colour (RGB332)
//   bits 15..8   Sky Strips intensity (a8)
//   bits  7..0   Sky Strips colour (RGB332)
//
// Each half is (a8 << 8) | rgb332 and is exactly 0 when its alpha is 0, so a
// zero word means "nothing to draw". Every writer preserves the other half.
// Smile V2 writes whole words and is never dispatched while either half is in
// use. CPU mirror: src/physics/animScratchPacking.ts (constants pinned by
// animScratchPacking.test.ts).

const ANIM_SCRATCH_BRUSH_SHIFT: u32 = 16u;
const ANIM_SCRATCH_STRIPS_SHIFT: u32 = 0u;
const ANIM_SCRATCH_HALF_MASK: u32 = 65535u;

// rgb24 (red in the low byte) → RGB332, rounding to nearest.
fn rgb332_from_rgb24(rgb: u32) -> u32 {
  let r = (((rgb & 255u) * 7u) + 127u) / 255u;
  let g = ((((rgb >> 8u) & 255u) * 7u) + 127u) / 255u;
  let b = ((((rgb >> 16u) & 255u) * 3u) + 127u) / 255u;
  return (r << 5u) | (g << 2u) | b;
}

fn rgb_from_rgb332(c: u32) -> vec3f {
  return vec3f(f32((c >> 5u) & 7u) / 7.0, f32((c >> 2u) & 7u) / 7.0, f32(c & 3u) / 3.0);
}

fn anim_half(packed: u32, shift: u32) -> u32 {
  return (packed >> shift) & ANIM_SCRATCH_HALF_MASK;
}

// A zero alpha packs to exactly 0, whatever the colour.
fn anim_half_pack(alpha: u32, c332: u32) -> u32 {
  return select(((alpha & 255u) << 8u) | (c332 & 255u), 0u, (alpha & 255u) == 0u);
}

fn anim_half_alpha(hw: u32) -> u32 {
  return (hw >> 8u) & 255u;
}

fn anim_half_color(hw: u32) -> u32 {
  return hw & 255u;
}

fn anim_with_half(packed: u32, shift: u32, hw: u32) -> u32 {
  return (packed & ~(ANIM_SCRATCH_HALF_MASK << shift)) | ((hw & ANIM_SCRATCH_HALF_MASK) << shift);
}
