// Light Brush — decaying paint in the packed animation scratch.
//
// One dispatch per frame while the brush owns the scratch. Every satellite:
//   1. decays its paint by `decay_steps` whole 1/255 steps,
//   2. takes the strongest of up to BRUSH_MAX_STAMPS stamps (point / spray /
//      ring), and
//   3. max-composes that over what is left.
//
// Paint is u32 rgba8 in the same slot Smile V2's `sat_output` uses
// (animScratch, 4 bytes/sat): rgb = brush colour, a = intensity. Integer bit
// ops rather than unpack4x8unorm/pack4x8unorm so decay stays exact.
//
// This file mirrors src/physics/brushFalloff.ts (brushFalloff, hashU32,
// sprayHash, stampLevel, composePaint). brushFalloff.test.ts pins the shared
// constants; change both sides together.
//
// It is a per-satellite gather against a handful of stamps — no CPU pick and no
// spatial hash. The conjunction hash would need its lazily allocated table,
// which does not fit next to a 1M fleet, and binning a million satellites
// costs more than the eight distance tests it would save.

override num_satellites: u32 = 1048576u;

const BRUSH_MAX_STAMPS: u32 = 8u;
const BRUSH_MODE_POINT: u32 = 0u;
const BRUSH_MODE_SPRAY: u32 = 1u;
const BRUSH_MODE_RING: u32 = 2u;
const BRUSH_SPRAY_DENSITY: f32 = 0.2;
const BRUSH_RING_WIDTH_FRACTION: f32 = 0.2;
const BRUSH_RING_MIN_HALF_WIDTH_KM: f32 = 20.0;

struct BrushStamp {
  center_km : vec3f,
  radius_km : f32,
  axis      : vec3f,
  strength  : f32,
}

struct BrushParams {
  stamp_count : u32,
  mode        : u32,
  decay_steps : u32,
  color_rgb   : u32,
  seed        : u32,
  pad0        : u32,
  pad1        : u32,
  pad2        : u32,
  stamps      : array<BrushStamp, 8>,
}

@group(0) @binding(0) var<uniform> params : BrushParams;
@group(0) @binding(1) var<storage, read> sat_pos : array<vec4f>;
@group(0) @binding(2) var<storage, read_write> paint : array<u32>;

fn brushFalloff(distance_km: f32, radius_km: f32) -> f32 {
  if (radius_km <= 0.0 || distance_km >= radius_km) { return 0.0; }
  let t = distance_km / radius_km;
  let u = 1.0 - t * t;
  return u * u;
}

// lowbias32
fn hashU32(n: u32) -> u32 {
  var x = n;
  x = x ^ (x >> 16u);
  x = x * 0x7feb352du;
  x = x ^ (x >> 15u);
  x = x * 0x846ca68bu;
  x = x ^ (x >> 16u);
  return x;
}

fn sprayHash(sat_idx: u32, seed: u32) -> f32 {
  return f32(hashU32(sat_idx ^ (seed * 0x9e3779b9u)) >> 8u) / 16777216.0;
}

fn stampLevel(weight: f32) -> u32 {
  return u32(floor(0.5 + 255.0 * clamp(weight, 0.0, 1.0)));
}

fn stampWeight(stamp: BrushStamp, p: vec3f, sat_idx: u32) -> f32 {
  if (params.mode == BRUSH_MODE_RING) {
    let half_width = max(BRUSH_RING_MIN_HALF_WIDTH_KM, stamp.radius_km * BRUSH_RING_WIDTH_FRACTION);
    return brushFalloff(abs(dot(p, stamp.axis)), half_width) * stamp.strength;
  }
  let w = brushFalloff(length(p - stamp.center_km), stamp.radius_km) * stamp.strength;
  if (params.mode == BRUSH_MODE_SPRAY && w > 0.0 && sprayHash(sat_idx, params.seed) >= BRUSH_SPRAY_DENSITY) {
    return 0.0;
  }
  return w;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= num_satellites) { return; }

  let packed = paint[i];
  // Untouched and no stroke this frame: one read, no write.
  if (packed == 0u && params.stamp_count == 0u) { return; }

  let pd = sat_pos[i];
  let p = pd.xyz;
  let is_active = pd.w >= 0.0 && any(p != vec3f(0.0));

  var weight = 0.0;
  if (is_active) {
    let n = min(params.stamp_count, BRUSH_MAX_STAMPS);
    for (var s = 0u; s < n; s = s + 1u) {
      weight = max(weight, stampWeight(params.stamps[s], p, i));
    }
  }

  // composePaint
  var a = packed >> 24u;
  var rgb = packed & 0xffffffu;
  a = select(0u, a - params.decay_steps, a > params.decay_steps);
  let level = stampLevel(weight);
  if (level > a) {
    a = level;
    rgb = params.color_rgb & 0xffffffu;
  }
  paint[i] = select((a << 24u) | rgb, 0u, a == 0u);
}
