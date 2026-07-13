/**
 * Beam Compute Shader
 * Calculates laser connections between satellites to form patterns.
 */

import { UNIFORM_STRUCT } from '../uniforms.js';

export const BEAM_COMPUTE =
  UNIFORM_STRUCT +
  /* wgsl */ `
@group(0) @binding(1) var<storage, read> sat_pos : array<vec4f>;
@group(0) @binding(2) var<storage, read_write> beams : array<vec4f>;

struct BeamParams {
  time: f32,
  mode: u32,
  density: u32,
  padding: u32,
}
@group(0) @binding(3) var<uniform> params : BeamParams;

const MAX_BEAMS = 65536u;
const NUM_SATS = 1048576u;
const ORBIT_RADIUS_KM: f32 = 6921.0;
const INV_SQRT2: f32 = 0.70710678;

fn hash(n: u32) -> u32 {
  var x = n;
  x = x ^ (x >> 16u);
  x = x * 0x45d9f3bu;
  x = x ^ (x >> 16u);
  return x;
}

fn hashf(n: u32) -> f32 {
  return f32(hash(n) & 0xFFFFu) / 65535.0;
}

fn to_earth_facing_coords(sat_pos: vec3f) -> vec3f {
  let center_dir = normalize(uni.camera_pos.xyz);
  let up = vec3f(0.0, 0.0, 1.0);
  let right = normalize(cross(up, center_dir));
  let true_up = cross(center_dir, right);

  let local_x = dot(sat_pos, right);
  let local_y = dot(sat_pos, true_up);
  let local_z = dot(sat_pos, center_dir);

  return vec3f(local_x, local_y, local_z);
}

fn is_in_grok(sat_pos: vec3f) -> bool {
  let local = to_earth_facing_coords(sat_pos);
  if (local.z < 1000.0) { return false; }

  let scale = 1.0 / ORBIT_RADIUS_KM;
  let x = local.x * scale;
  let y = local.y * scale;

  let left_stem = abs(x + 0.45) < 0.14 && abs(y) < 0.45;
  let right_stem = abs(x - 0.45) < 0.14 && abs(y) < 0.45;
  let center_bar = abs(x) < 0.22 && abs(y) < 0.12;
  let star = abs(x) < 0.08 && abs(y) < 0.08;

  return left_stem || right_stem || center_bar || star;
}

fn is_in_x_logo(sat_pos: vec3f) -> bool {
  let local = to_earth_facing_coords(sat_pos);
  if (local.z < 1000.0) { return false; }

  let px = local.x / ORBIT_RADIUS_KM;
  let py = local.y / ORBIT_RADIUS_KM;

  let LOGO_HALF: f32 = 0.48;
  let STROKE_HALF: f32 = 0.068;

  let in_box = abs(px) < LOGO_HALF && abs(py) < LOGO_HALF;
  let d1 = abs(py - px) * INV_SQRT2;
  let d2 = abs(py + px) * INV_SQRT2;
  let nearest = min(d1, d2);

  return in_box && nearest < STROKE_HALF;
}

fn is_active_node(sat_pos: vec3f, mode: u32) -> bool {
  if (mode == 1u) { return is_in_grok(sat_pos); }
  if (mode == 2u) { return is_in_x_logo(sat_pos); }
  return false;
}

fn earth_surface_point(pos: vec3f) -> vec3f {
  var point = vec3f(pos.x, pos.y, 0.0);
  if (length(point) < 1.0) {
    point = vec3f(1.0, 0.0, 0.0);
  }
  return normalize(point) * 6371.0;
}

fn patternPulse(mode: u32, beam_idx: u32, pos_a: vec3f, time: f32) -> f32 {
  switch mode {
    case 0u: {
      // CHAOS — high-frequency flicker, irregular per-beam phases, stochastic dropout.
      let flicker = hashf(beam_idx * 7u + u32(time * 55.0));
      let phase = hashf(beam_idx * 3u) * 6.2831853;
      let rate = 14.0 + flicker * 26.0;
      let wave = abs(sin(time * rate + phase));
      let dropout = step(0.82, hashf(beam_idx * 23u + u32(time * 17.0)));
      return (0.22 + 0.78 * wave) * (1.0 - dropout * 0.55);
    }
    case 1u: {
      // GROK — synchronized radial sweep across the constellation.
      let r = length(pos_a.xy);
      let sweep = sin(time * 2.6 - r * 0.0018);
      return 0.48 + 0.52 * (0.5 + 0.5 * sweep);
    }
    case 2u: {
      // 𝕏 LOGO — sharp geometric gate, higher contrast.
      let gate = sin(time * 7.4 + f32(beam_idx) * 0.035);
      return 0.32 + 0.68 * smoothstep(0.12, 0.88, 0.5 + 0.5 * gate);
    }
    default: {
      return 0.52 + 0.48 * sin(time * 8.6 + f32(beam_idx) * 0.12);
    }
  }
}

fn patternThickness(mode: u32, beam_idx: u32) -> f32 {
  if (mode == 0u) {
    return 0.55 + 0.95 * hashf(beam_idx * 11u);
  }
  if (mode == 2u) {
    return 0.72 + 0.18 * hashf(beam_idx * 5u);
  }
  return 1.0;
}

@compute @workgroup_size(256,1,1)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let beam_idx = gid.x;
  if (beam_idx >= MAX_BEAMS) { return; }

  let sat_a_idx = beam_idx * 5u;
  let pos_a = sat_pos[sat_a_idx].xyz;

  var is_active = false;
  let intensity = 1.0;

  if (params.mode == 0u) {
    is_active = true;
  } else if (is_active_node(pos_a, params.mode)) {
    is_active = true;
  }

  if (!is_active) {
    beams[beam_idx * 2u] = vec4f(pos_a, 0.0);
    beams[beam_idx * 2u + 1u] = vec4f(pos_a, 0.0);
    return;
  }

  var pos_b = pos_a;
  var found = false;

  if (params.mode == 0u) {
    pos_b = earth_surface_point(pos_a);
    let angle = hashf(beam_idx * 13u) * 6.2831853;
    let jitter = vec3f(cos(angle), sin(angle), 0.0) * (4.0 + hashf(beam_idx * 19u) * 10.0);
    pos_b += jitter;
    found = true;
  } else {
    for (var j = 1u; j <= 40u; j++) {
      let candidate_idx = (sat_a_idx + j * 17u) % NUM_SATS;
      let c_pos = sat_pos[candidate_idx].xyz;
      if (is_active_node(c_pos, params.mode)) {
        let dist = length(c_pos - pos_a);
        if (dist > 90.0 && dist < 2100.0) {
          pos_b = c_pos;
          found = true;
          break;
        }
      }
    }
  }

  if (!found) {
    beams[beam_idx * 2u] = vec4f(pos_a, 0.0);
    beams[beam_idx * 2u + 1u] = vec4f(pos_a, 0.0);
    return;
  }

  let pulse = patternPulse(params.mode, beam_idx, pos_a, params.time);
  let thick = patternThickness(params.mode, beam_idx);
  let final_intensity = intensity * pulse * thick;

  beams[beam_idx * 2u] = vec4f(pos_a, final_intensity);
  beams[beam_idx * 2u + 1u] = vec4f(pos_b, f32(params.mode));
}
`;
