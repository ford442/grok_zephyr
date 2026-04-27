/**
 * Beam Compute Shader
 * Calculates laser connections between satellites to form patterns.
 */

import { UNIFORM_STRUCT } from '../uniforms.js';

export const BEAM_COMPUTE = UNIFORM_STRUCT + /* wgsl */ `
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

// Map satellite positions to the camera's flat perspective
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

// Smile Boundary Check
fn is_in_smile(sat_pos: vec3f) -> bool {
  let local = to_earth_facing_coords(sat_pos);
  if (local.z < 1000.0) { return false; } // Hide backside
  
  let scale = 1.0 / 6921.0;
  let x = local.x * scale;
  let y = local.y * scale;

  let left_eye_dist = length(vec2f(x - (-0.3), y - 0.3));
  let right_eye_dist = length(vec2f(x - 0.3, y - 0.3));
  let smile_y = -0.5 * x * x - 0.2;
  let smile_curve = abs(y - smile_y);

  if (left_eye_dist < 0.08 || right_eye_dist < 0.08 || (smile_curve < 0.05 && y < -0.1)) {
    return true;
  }
  return false;
}

// 𝕏 Logo Boundary Check
fn is_in_x_logo(sat_pos: vec3f) -> bool {
  let local = to_earth_facing_coords(sat_pos);
  if (local.z < 1000.0) { return false; } // Hide backside

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

// Route to correct pattern logic
fn is_active_node(sat_pos: vec3f, mode: u32) -> bool {
  if (mode == 3u) { return is_in_smile(sat_pos); }
  if (mode == 2u) { return is_in_x_logo(sat_pos); }
  return false;
}

@compute @workgroup_size(256,1,1)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let beam_idx = gid.x;
  if (beam_idx >= MAX_BEAMS) { return; }
  
  // Spread beam assignment across the constellation
  let sat_a_idx = beam_idx * 5u; 
  let pos_a = sat_pos[sat_a_idx].xyz;
  
  var is_active = false;
  var intensity = 0.0;
  
  // STEP 1: Determine if Node A is in the pattern
  if (params.mode == 2u || params.mode == 3u) {
     if (is_active_node(pos_a, params.mode)) {
         is_active = true;
         intensity = 1.0;
     }
  } else if (params.mode == 1u) {
     // CHAOS/GROK Mode: Random nodes
     if ((hash(beam_idx + u32(params.time * 0.1)) % 30u) == 0u) {
         is_active = true;
         intensity = 0.6;
     }
  }

  // If node A is not active, kill the beam
  if (!is_active) {
    beams[beam_idx * 2u] = vec4f(pos_a, 0.0);
    beams[beam_idx * 2u + 1u] = vec4f(pos_a, 0.0);
    return;
  }
  
  var pos_b = pos_a;
  var found = false;
  
  // STEP 2: Find a partner node (Node B)
  if (params.mode == 2u || params.mode == 3u) {
      // Search loop: Check up to 40 surrounding indices
      for (var j = 1u; j <= 40u; j++) {
          // Use prime offset (17) to jump around local orbit space
          let candidate_idx = (sat_a_idx + j * 17u) % NUM_SATS; 
          let c_pos = sat_pos[candidate_idx].xyz;
          
          if (is_active_node(c_pos, params.mode)) {
              // Prevent ultra-short or ultra-long beams
              let dist = length(c_pos - pos_a);
              if (dist > 50.0 && dist < 2000.0) { 
                  pos_b = c_pos;
                  found = true;
                  break;
              }
          }
      }
  } else {
      // Chaos mode: just grab a random neighbor
      let neighbor_offset = (hash(beam_idx) % 150u) + 1u;
      pos_b = sat_pos[(sat_a_idx + neighbor_offset) % NUM_SATS].xyz;
      found = true;
  }
  
  if (!found) {
    beams[beam_idx * 2u] = vec4f(pos_a, 0.0);
    beams[beam_idx * 2u + 1u] = vec4f(pos_a, 0.0);
    return;
  }
  
  // STEP 3: Connect them
  // Add a rapid flicker to the lasers
  let pulse = 0.4 + 0.6 * sin(params.time * 12.0 + f32(beam_idx));
  let final_intensity = intensity * pulse;
  
  beams[beam_idx * 2u] = vec4f(pos_a, final_intensity);
  beams[beam_idx * 2u + 1u] = vec4f(pos_b, f32(params.mode));
}
`;
