/**
 * Thin cyan/white ISL fiber ribbons — independent of CHAOS/GROK/X beam patterns.
 */

import { UNIFORM_STRUCT } from '../uniforms.js';

export const ISL_SHADER =
  UNIFORM_STRUCT +
  /* wgsl */ `
@group(0) @binding(1) var<storage, read> isl : array<vec4f>;

struct IslParams {
  enabled: u32,
  density: f32,
  focus_index: u32,
  sat_limit: u32,
  time: f32,
  topology: u32,
  pad0: u32,
  pad1: u32,
}
@group(0) @binding(2) var<uniform> params : IslParams;

struct VOut {
  @builtin(position) cp: vec4f,
  @location(0) uv: vec2f,
  @location(1) quality: f32,
  @location(2) focused: f32,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) instance: u32) -> VOut {
  var out: VOut;
  let start = isl[instance * 2u];
  let endv = isl[instance * 2u + 1u];
  if (params.enabled == 0u || start.w <= 0.001) {
    out.cp = vec4f(2.0, 2.0, 2.0, 1.0);
    return out;
  }

  let quad = vi & 3u;
  let step = quad >> 1u;
  let sideSign = select(-1.0, 1.0, (quad & 1u) == 1u);
  let t = f32(step);
  let p0 = start.xyz;
  let p1 = endv.xyz;
  let beamDir = normalize(p1 - p0 + vec3f(0.0001, 0.0, 0.0));
  var offsetDir = normalize(cross(beamDir, uni.camera_up.xyz));
  if (length(offsetDir) < 0.0001) {
    offsetDir = normalize(cross(beamDir, uni.camera_right.xyz));
  }
  let center = mix(p0, p1, t);
  let distance = max(length(uni.camera_pos.xyz - center), 1.0);
  let thickness = 0.00022 * distance * (0.65 + 0.55 * start.w);
  let worldPos = center + offsetDir * sideSign * thickness;
  out.cp = uni.view_proj * vec4f(worldPos, 1.0);
  out.uv = vec2f(t, select(0.0, 1.0, sideSign > 0.0));
  out.quality = start.w;
  out.focused = endv.w;
  return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let dist = abs(in.uv.y - 0.5) * 2.0;
  let core = pow(max(0.0, 1.0 - dist), 3.6);
  let halo = pow(max(0.0, 1.0 - dist), 1.4) * 0.22;
  var pulse = 0.55 + 0.45 * in.quality;
  if (in.focused > 0.5) {
    let travel = fract(params.time * 1.8 - in.uv.x);
    pulse = 0.35 + 1.4 * smoothstep(0.22, 0.0, abs(travel - 0.5));
  }
  let cyan = vec3f(0.45, 0.92, 1.0);
  let white = vec3f(0.92, 0.98, 1.0);
  let col = mix(cyan, white, core) * (core + halo) * pulse;
  let view = uni.view_mode & 0xFFFFu;
  var viewScale = 1.0;
  if (view == 2u) { viewScale = 0.45; }
  else if (view == 3u) { viewScale = 0.35; }
  else if (view == 4u) { viewScale = 1.15; }
  return vec4f(col * viewScale, core * pulse);
}
`;
