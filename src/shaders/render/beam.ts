/**
 * Laser Beam Shader
 */

import { UNIFORM_STRUCT } from '../uniforms.js';

export const BEAM_SHADER = UNIFORM_STRUCT + /* wgsl */ `
@group(0) @binding(1) var<storage, read> beams : array<vec4f>;

struct VOut {
  @builtin(position) cp: vec4f,
  @location(0) uv: vec2f,
  @location(1) intensity: f32,
  @location(2) mode: f32,
};

fn beam_color(mode: u32) -> vec3f {
  switch mode {
    case 0u: { return vec3f(0.45, 0.9, 1.0); }
    case 1u: { return vec3f(0.15, 1.0, 0.75); }
    case 2u: { return vec3f(1.0, 0.45, 0.78); }
    default: { return vec3f(0.6, 0.9, 1.0); }
  }
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) instance: u32) -> VOut {
  var out: VOut;
  let quad = vi & 3u;
  let step = quad >> 1u;
  let sideSign = select(-1.0, 1.0, (quad & 1u) == 1u);
  let t = f32(step);

  let start = beams[instance * 2u];
  let end = beams[instance * 2u + 1u];
  let p0 = start.xyz;
  let p1 = end.xyz;
  let beamDir = normalize(p1 - p0 + vec3f(0.0001, 0.0, 0.0));
  var offsetDir = normalize(cross(beamDir, uni.camera_up.xyz));
  if (length(offsetDir) < 0.0001) {
    offsetDir = normalize(cross(beamDir, uni.camera_right.xyz));
  }

  let center = mix(p0, p1, t);
  let distance = max(length(uni.camera_pos.xyz - center), 1.0);
  let thickness = (0.0008 + 0.0014 * start.w) * distance;
  let worldPos = center + offsetDir * sideSign * thickness;

  out.cp = uni.view_proj * vec4f(worldPos, 1.0);
  out.uv = vec2f(t, select(0.0, 1.0, sideSign > 0.0));
  out.intensity = start.w;
  out.mode = end.w;
  return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let mode = u32(in.mode);
  let base = beam_color(mode);
  let edge = pow(max(0.0, 1.0 - abs(in.uv.y - 0.5) * 2.0), 3.0);
  let pulse = 0.6 + 0.4 * sin(uni.time * 8.0 - in.uv.x * 10.0);
  let travel = smoothstep(0.0, 0.08, 0.08 - abs(fract(uni.time * 3.4 - in.uv.x * 2.6) - 0.5));
  let glow = max(0.35, travel);
  let alpha = clamp(edge * in.intensity * pulse * glow, 0.0, 1.0);
  let color = mix(base * 0.8, base * 1.4, travel);
  if (uni.is_ground_view == 1u) {
    let groundTint = mix(color, vec3f(1.0, 0.8, 0.45), 0.24);
    return vec4f(groundTint * alpha * 1.05, alpha * 0.85);
  }
  return vec4f(color * alpha, alpha * 0.85);
}
`;
