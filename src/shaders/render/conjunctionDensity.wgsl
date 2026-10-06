// Shell-density heat overlay — one marker per occupied hash cell, coloured by
// how many satellites share it.
//
// Drawn from the same counting-sort table the pair search builds, so it costs
// one extra draw and no extra compute. Each instance is a bucket; after the
// scatter `bin_offsets[bucket]` is the end of its slice of `sorted`, so
// `sorted[end - count]` is a representative satellite whose position places the
// marker, and `bin_counts[bucket]` is the occupancy.
//
// Cells are threshold-sized, so this reads as local crowding rather than
// whole-shell density — which is the honest thing for it to show, since it is
// built from the same cells the pair test uses.
#import "uniforms.wgsl"

@group(0) @binding(1) var<storage, read> sat_pos : array<vec4f>;
@group(0) @binding(2) var<storage, read> bin_counts : array<u32>;
@group(0) @binding(3) var<storage, read> bin_offsets : array<u32>;
@group(0) @binding(5) var<storage, read> sorted : array<u32>;

// Occupancy that reads as fully hot. The table has no capacity any more, so
// this is just the top of the colour ramp — kept at the old bucket size so the
// overlay looks the same as before for the same crowding.
const DENSITY_HEAT_FULL : f32 = 8.0;

struct ConjunctionParams {
  enabled         : u32,
  threshold_km    : f32,
  scan_count      : u32,
  bucket_mask     : u32,
  block_count     : u32,
  max_pairs       : u32,
  time            : f32,
  pad0            : u32,
}
@group(0) @binding(4) var<uniform> params : ConjunctionParams;

struct VOut {
  @builtin(position) cp: vec4f,
  @location(0) uv: vec2f,
  @location(1) heat: f32,
};

/**
 * Viridis approximation. Chosen over a red/green heat ramp because it is
 * monotonic in lightness, so it survives greyscale printing and every common
 * form of colour blindness — the ordering stays readable without hue.
 */
fn viridis(t: f32) -> vec3f {
  let x = clamp(t, 0.0, 1.0);
  let c0 = vec3f(0.2777273272234177,  0.005407344544966578, 0.3340998053353061);
  let c1 = vec3f(0.1050930431085774,  1.404613529898575,    1.384590162594685);
  let c2 = vec3f(-0.3308618287255563, 0.214847559468213,    0.09509516302823659);
  let c3 = vec3f(-4.634230498983486, -5.799100973351585,  -19.33244095627987);
  let c4 = vec3f(6.228269936347081,  14.17993336680509,    56.69055260068105);
  let c5 = vec3f(4.776384997670288, -13.74514537774601,   -65.35303263337234);
  let c6 = vec3f(-5.435455855934631,  4.645852612178535,   26.3124352495832);
  return c0 + x * (c1 + x * (c2 + x * (c3 + x * (c4 + x * (c5 + x * c6)))));
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) bucket: u32) -> VOut {
  var out: VOut;
  let occupancy = bin_counts[bucket];
  if (params.enabled == 0u || bucket > params.bucket_mask || occupancy == 0u) {
    out.cp = vec4f(2.0, 2.0, 2.0, 1.0);
    return out;
  }

  let rep = sorted[bin_offsets[bucket] - occupancy];
  let center = sat_pos[rep].xyz;

  let heat = clamp(f32(occupancy) / DENSITY_HEAT_FULL, 0.0, 1.0);

  let quad = vi & 3u;
  let corner = vec2f(
    select(-1.0, 1.0, (quad & 1u) == 1u),
    select(-1.0, 1.0, (quad >> 1u) == 1u),
  );

  let distance = max(length(uni.camera_pos.xyz - center), 1.0);
  // Screen-relative so a crowded cell stays legible from god view, where a
  // threshold-sized cell is far below a pixel.
  let radius = 0.0016 * distance * (0.6 + 0.6 * heat);
  let worldPos = center
    + uni.camera_right.xyz * corner.x * radius
    + uni.camera_up.xyz * corner.y * radius;

  out.cp = uni.view_proj * vec4f(worldPos, 1.0);
  out.uv = corner;
  out.heat = heat;
  return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let r = length(in.uv);
  if (r > 1.0) { discard; }
  let falloff = pow(1.0 - r, 2.0);
  let col = viridis(in.heat);
  let alpha = falloff * (0.18 + 0.5 * in.heat);
  return vec4f(col * falloff * (0.5 + 0.9 * in.heat), alpha);
}
