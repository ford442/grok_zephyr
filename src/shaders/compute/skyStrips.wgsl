// Sky Strips — a time / audio / orbit-index light show in the packed
// animation scratch.
//
// One dispatch per frame while strips are on. Every satellite recomputes its
// strips half (low 16 bits of animScratch: a8 + RGB332, see
// animScratchPack.wgsl) from scratch; the Light Brush's high half is preserved.
// Nothing is stored per satellite beyond what is drawn this frame.
//
// This file mirrors src/physics/skyStrips.ts (argumentOfLatitude, sparkleHash,
// stripsSample, stripsColor332, stripsHalf). skyStrips.test.ts pins the shared
// constants; change both sides together. Phases arrive pre-reduced from the CPU
// (float64), so no large f32 time is multiplied here.

#import "animScratchPack.wgsl"

override num_satellites: u32 = 1048576u;

const STRIPS_MODE_CLEAR: u32 = 0u;
const STRIPS_MODE_WAVE: u32 = 1u;
const STRIPS_MODE_CHASE: u32 = 2u;
const STRIPS_MODE_BEAT: u32 = 3u;
const STRIPS_MODE_SPARKLE: u32 = 4u;
const STRIPS_WAVE_LOBES: f32 = 4.0;
const STRIPS_CHASE_BANDS: f32 = 6.0;
const STRIPS_CHASE_WIDTH: f32 = 0.18;
const STRIPS_SPARKLE_DENSITY: f32 = 0.03;
const STRIPS_BEAT_WAVE_FLOOR: f32 = 0.35;
const STRIPS_PEAK: f32 = 0.85;
const TAU: f32 = 6.283185307179586;

struct StripsParams {
  mode           : u32,
  seed           : u32,
  color_a        : u32,
  color_b        : u32,
  sparkle_bucket : u32,
  wave_phase     : f32,
  chase_offset   : f32,
  sparkle_frac   : f32,
  bass           : f32,
  presence       : f32,
  pad0           : f32,
  pad1           : f32,
  pad2           : f32,
  pad3           : f32,
  pad4           : f32,
  pad5           : f32,
}

@group(0) @binding(0) var<uniform> params : StripsParams;
@group(0) @binding(1) var<storage, read> sat_pos : array<vec4f>;
@group(0) @binding(2) var<storage, read> orb_elem : array<vec4f>;
@group(0) @binding(3) var<storage, read_write> scratch : array<u32>;

// lowbias32 (same constants as brush.wgsl)
fn hashU32(n: u32) -> u32 {
  var x = n;
  x = x ^ (x >> 16u);
  x = x * 0x7feb352du;
  x = x ^ (x >> 15u);
  x = x * 0x846ca68bu;
  x = x ^ (x >> 16u);
  return x;
}

fn sparkleHash(sat_idx: u32) -> f32 {
  let mixed = sat_idx ^ (params.seed * 0x9e3779b9u) ^ (params.sparkle_bucket * 0x85ebca6bu);
  return f32(hashU32(mixed) >> 8u) / 16777216.0;
}

fn argumentOfLatitude(p: vec3f, raan: f32, inc: f32) -> f32 {
  let cR = cos(raan); let sR = sin(raan);
  let cI = cos(inc);  let sI = sin(inc);
  let x = p.x * cR + p.y * sR;
  let y = -p.x * sR * cI + p.y * cR * cI + p.z * sI;
  return atan2(y, x);
}

fn waveShape(u: f32) -> f32 {
  return 0.5 + 0.5 * sin(STRIPS_WAVE_LOBES * u - params.wave_phase);
}

// x = intensity (0..1, before STRIPS_PEAK), y = colour mix A→B.
fn stripsSample(i: u32, p: vec3f, raan: f32, inc: f32) -> vec2f {
  switch params.mode {
    case STRIPS_MODE_WAVE: {
      let w = waveShape(argumentOfLatitude(p, raan, inc));
      return vec2f(w, w);
    }
    case STRIPS_MODE_CHASE: {
      let along = raan / TAU;
      let ph = fract(along * STRIPS_CHASE_BANDS - params.chase_offset);
      let lit = select(0.0, 1.0 - ph / STRIPS_CHASE_WIDTH, ph < STRIPS_CHASE_WIDTH);
      return vec2f(lit, fract(along));
    }
    case STRIPS_MODE_BEAT: {
      let w = waveShape(argumentOfLatitude(p, raan, inc));
      let shape = STRIPS_BEAT_WAVE_FLOOR + (1.0 - STRIPS_BEAT_WAVE_FLOOR) * w;
      return vec2f(params.bass * shape, params.presence);
    }
    case STRIPS_MODE_SPARKLE: {
      let r = sparkleHash(i);
      if (r >= STRIPS_SPARKLE_DENSITY) { return vec2f(0.0); }
      return vec2f(1.0 - params.sparkle_frac, r / STRIPS_SPARKLE_DENSITY);
    }
    default: {
      return vec2f(0.0);
    }
  }
}

fn stripsColor332(m: f32) -> u32 {
  let t = clamp(m, 0.0, 1.0);
  let a = vec3f(f32(params.color_a & 255u), f32((params.color_a >> 8u) & 255u), f32((params.color_a >> 16u) & 255u));
  let b = vec3f(f32(params.color_b & 255u), f32((params.color_b >> 8u) & 255u), f32((params.color_b >> 16u) & 255u));
  let c = vec3u(floor(a + (b - a) * t + vec3f(0.5)));
  return rgb332_from_rgb24(c.x | (c.y << 8u) | (c.z << 16u));
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= num_satellites) { return; }

  let packed = scratch[i];
  var hw = 0u;
  if (params.mode != STRIPS_MODE_CLEAR) {
    let pd = sat_pos[i];
    let p = pd.xyz;
    if (pd.w >= 0.0 && any(p != vec3f(0.0))) {
      let e = orb_elem[i];
      let s = stripsSample(i, p, e.x, e.y);
      let level = u32(floor(0.5 + 255.0 * clamp(s.x * STRIPS_PEAK, 0.0, 1.0)));
      hw = anim_half_pack(level, stripsColor332(s.y));
    }
  } else if (anim_half(packed, ANIM_SCRATCH_STRIPS_SHIFT) == 0u) {
    // Nothing to clear: one read, no write.
    return;
  }
  scratch[i] = anim_with_half(packed, ANIM_SCRATCH_STRIPS_SHIFT, hw);
}
