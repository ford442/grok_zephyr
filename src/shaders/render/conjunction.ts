/**
 * Close-approach markers — amber/red segments joining each detected pair.
 *
 * Deliberately unlike the cyan ISL fibers: this is a warning colour, and it
 * pulses so a static screenshot cannot be mistaken for the link mesh. The
 * geometry is the ISL ribbon's camera-facing quad, driven from the pair buffer
 * the compute pass appends to.
 */

import { UNIFORM_STRUCT } from '../uniforms.js';

export const CONJUNCTION_SHADER =
  UNIFORM_STRUCT +
  /* wgsl */ `
@group(0) @binding(1) var<storage, read> pairs : array<vec4f>;

struct ConjunctionParams {
  enabled         : u32,
  threshold_km    : f32,
  scan_count      : u32,
  bucket_mask     : u32,
  bucket_capacity : u32,
  max_pairs       : u32,
  time            : f32,
  pad0            : u32,
}
@group(0) @binding(2) var<uniform> params : ConjunctionParams;

// Live pair count, written by the compute pass. Instances beyond it are
// degenerate — the draw is a fixed max_pairs instance count, not indirect.
struct ConjunctionCounters {
  pair_count : u32,
  overflow   : u32,
}
@group(0) @binding(3) var<storage, read> counters : ConjunctionCounters;

struct VOut {
  @builtin(position) cp: vec4f,
  @location(0) uv: vec2f,
  @location(1) severity: f32,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) instance: u32) -> VOut {
  var out: VOut;
  if (params.enabled == 0u || instance >= min(counters.pair_count, params.max_pairs)) {
    out.cp = vec4f(2.0, 2.0, 2.0, 1.0);
    return out;
  }

  let a = pairs[instance * 2u];
  let b = pairs[instance * 2u + 1u];

  let quad = vi & 3u;
  let t = f32(quad >> 1u);
  let sideSign = select(-1.0, 1.0, (quad & 1u) == 1u);

  let p0 = a.xyz;
  let p1 = b.xyz;
  // A conjunction pair can be metres apart, so the segment direction is
  // degenerate far more often than an ISL link's. Fall back to the camera
  // right vector instead of normalizing a zero-length vector.
  let span = p1 - p0;
  var dir = uni.camera_right.xyz;
  if (length(span) > 1e-4) { dir = normalize(span); }
  var offsetDir = cross(dir, uni.camera_up.xyz);
  if (length(offsetDir) < 1e-4) { offsetDir = cross(dir, uni.camera_right.xyz); }
  offsetDir = normalize(offsetDir + vec3f(1e-6, 0.0, 0.0));

  let center = mix(p0, p1, t);
  let distance = max(length(uni.camera_pos.xyz - center), 1.0);
  // Screen-constant width: a 1 km separation is sub-pixel from god view, so the
  // marker has to be sized in screen space or it would be invisible where it
  // matters most.
  let thickness = 0.0009 * distance;
  let worldPos = center + offsetDir * sideSign * thickness;

  out.cp = uni.view_proj * vec4f(worldPos, 1.0);
  out.uv = vec2f(t, select(0.0, 1.0, sideSign > 0.0));
  out.severity = b.w;
  return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let dist = abs(in.uv.y - 0.5) * 2.0;
  let core = pow(max(0.0, 1.0 - dist), 3.2);
  let halo = pow(max(0.0, 1.0 - dist), 1.3) * 0.3;

  // Pulse so this never reads as a static structural line like an ISL fiber.
  let pulse = 0.55 + 0.45 * sin(params.time * 4.0 + in.severity * 6.0);

  // Amber at the threshold, red as separation goes to zero. Both stay
  // distinguishable from the cyan ISL mesh for red-green colour blindness,
  // which is why the cue is amber→red plus the pulse, not hue alone.
  let amber = vec3f(1.0, 0.62, 0.12);
  let red   = vec3f(1.0, 0.18, 0.10);
  let col = mix(amber, red, in.severity);

  let intensity = (core + halo) * (0.65 + 0.35 * in.severity) * pulse;
  return vec4f(col * intensity, core * pulse * 0.9);
}
`;
