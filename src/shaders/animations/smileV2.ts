/**
 * Smile from the Moon v2 Shader
 * 
 * Full WGSL implementation inlined for the build system.
 * This is the compute shader that generates the smile animation.
 */

export const SMILE_V2_SHADER = /* wgsl */ `
const NUM_SATELLITES: u32 = 1048576u;
const EARTH_RADIUS_KM: f32 = 6371.0;
const FEATURE_NONE: u32 = 0u;
const FEATURE_LEFT_EYE: u32 = 1u;
const FEATURE_RIGHT_EYE: u32 = 2u;
const FEATURE_SMILE_CURVE: u32 = 3u;
const FEATURE_MORPH_TARGET: u32 = 4u;
const FACE_UV_RADIUS: f32 = 1.0;
const LEFT_EYE_CENTER: vec2f = vec2f(-0.3, 0.2);
const RIGHT_EYE_CENTER: vec2f = vec2f(0.3, 0.2);
const EYE_RADIUS_UV: f32 = 0.15;
const SMILE_CURVE_A: f32 = 0.3;
const SMILE_CURVE_Y0: f32 = 0.1;
const SMILE_X_MIN: f32 = -0.4;
const SMILE_X_MAX: f32 = 0.4;
const SMILE_THICKNESS_UV: f32 = 0.08;
const MORPH_REGION_RADIUS: f32 = 0.25;
const FACING_THRESHOLD: f32 = 0.7;
const CYCLE_DURATION_SECONDS: f32 = 48.0;
const PHASE_0_IDLE: f32 = 4.0;
const PHASE_1_EMERGE: f32 = 6.0;
const PHASE_2_BLINK: f32 = 8.0;
const PHASE_3_TWINKLE: f32 = 10.0;
const PHASE_4_GLOW: f32 = 8.0;
const PHASE_5_MORPH: f32 = 8.0;
const PHASE_6_FADE: f32 = 4.0;
const PHASE_1_START: f32 = 4.0;
const PHASE_2_START: f32 = 10.0;
const PHASE_3_START: f32 = 18.0;
const PHASE_4_START: f32 = 28.0;
const PHASE_5_START: f32 = 36.0;
const PHASE_6_START: f32 = 44.0;
const COLOR_AMBER: vec3f = vec3f(1.0, 0.702, 0.278);
const COLOR_GOLDEN: vec3f = vec3f(1.0, 0.843, 0.0);
const COLOR_WARM_WHITE: vec3f = vec3f(1.0, 0.95, 0.85);
const COLOR_DEEP_ORANGE: vec3f = vec3f(1.0, 0.5, 0.1);
const COLOR_CYAN_ACCENT: vec3f = vec3f(0.2, 0.9, 1.0);
const COLOR_X_LOGO: vec3f = vec3f(0.0, 0.0, 0.0);
const COLOR_GROK_GLOW: vec3f = vec3f(0.8, 0.3, 1.0);
const WORKGROUP_SIZE: u32 = 256u;

struct SmileV2Params {
  cycle_time: f32,
  global_time: f32,
  speed_multiplier: f32,
  _pad0: f32,
  transition_alpha: f32,
  target_mode: f32,
  transition_duration: f32,
  _pad1: f32,
  ref_nadir: vec3f,
  ref_east: vec3f,
  ref_north: vec3f,
  morph_mode: u32,
  _pad2: vec3f,
};

@group(0) @binding(0) var<uniform> params: SmileV2Params;
@group(0) @binding(1) var<storage, read> sat_positions: array<vec4f>;
@group(0) @binding(2) var<storage, read> orb_elements: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> sat_output: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> trail_buffer: array<vec4f>;

fn gnomonic_project_satellite(sat_pos: vec3f, earth_dir: vec3f) -> vec2f {
  let sat_dir = normalize(sat_pos);
  let facing = dot(sat_dir, -earth_dir);
  if (facing < FACING_THRESHOLD) {
    return vec2f(999.0, 999.0);
  }
  let sub_sat = sat_dir * EARTH_RADIUS_KM;
  let delta = sub_sat - params.ref_nadir;
  let ref_normal = normalize(params.ref_nadir);
  let delta_tangent = delta - ref_normal * dot(delta, ref_normal);
  let u = dot(delta_tangent, params.ref_east);
  let v = dot(delta_tangent, params.ref_north);
  let face_radius_km = 1000.0;
  return vec2f(u / face_radius_km, v / face_radius_km);
}

fn sdf_circle(p: vec2f, c: vec2f, r: f32) -> f32 {
  return length(p - c) - r;
}

fn sdf_parabola(p: vec2f, a: f32, y0: f32, xmin: f32, xmax: f32) -> f32 {
  var x = clamp(p.x, xmin, xmax);
  for (var i: i32 = 0; i < 3; i = i + 1) {
    let y = a * x * x + y0;
    let dy_dx = 2.0 * a * x;
    let dx = x - p.x;
    let dy = y - p.y;
    let f = dx + dy * dy_dx;
    let fp = 1.0 + dy_dx * dy_dx + dy * 2.0 * a;
    x = x - f / fp;
    x = clamp(x, xmin, xmax);
  }
  let closest_y = a * x * x + y0;
  let closest = vec2f(x, closest_y);
  return length(p - closest);
}

fn sdf_x_shape(p: vec2f, thickness: f32) -> f32 {
  let d1 = abs(p.y - p.x) / 1.41421356;
  let d2 = abs(p.y + p.x) / 1.41421356;
  let dist_from_center = length(p);
  let center_mask = 1.0 - smoothstep(0.15, 0.25, dist_from_center);
  return min(d1, d2) * center_mask + (dist_from_center - 0.25) * (1.0 - center_mask);
}

fn get_smile_feature(uv: vec2f) -> u32 {
  if (uv.x > 100.0) {
    return FEATURE_NONE;
  }
  let dist_from_center = length(uv);
  if (dist_from_center > FACE_UV_RADIUS * 1.1) {
    return FEATURE_NONE;
  }
  let d_left_eye = sdf_circle(uv, LEFT_EYE_CENTER, EYE_RADIUS_UV);
  if (d_left_eye < 0.0) {
    return FEATURE_LEFT_EYE;
  }
  let d_right_eye = sdf_circle(uv, RIGHT_EYE_CENTER, EYE_RADIUS_UV);
  if (d_right_eye < 0.0) {
    return FEATURE_RIGHT_EYE;
  }
  if (uv.x >= SMILE_X_MIN && uv.x <= SMILE_X_MAX) {
    let d_smile = sdf_parabola(uv, SMILE_CURVE_A, SMILE_CURVE_Y0, SMILE_X_MIN, SMILE_X_MAX);
    if (d_smile < SMILE_THICKNESS_UV * 0.5) {
      return FEATURE_SMILE_CURVE;
    }
  }
  if (dist_from_center < MORPH_REGION_RADIUS) {
    if (params.morph_mode == 0u) {
      let d_x = sdf_x_shape(uv, 0.03);
      if (d_x < 0.0) {
        return FEATURE_MORPH_TARGET;
      }
    }
  }
  return FEATURE_NONE;
}

fn get_animation_phase(cycle_time: f32) -> vec2f {
  var phase: f32 = 0.0;
  var progress: f32 = 0.0;
  if (cycle_time < PHASE_1_START) {
    phase = 0.0;
    progress = cycle_time / PHASE_0_IDLE;
  } else if (cycle_time < PHASE_2_START) {
    phase = 1.0;
    progress = (cycle_time - PHASE_1_START) / PHASE_1_EMERGE;
  } else if (cycle_time < PHASE_3_START) {
    phase = 2.0;
    progress = (cycle_time - PHASE_2_START) / PHASE_2_BLINK;
  } else if (cycle_time < PHASE_4_START) {
    phase = 3.0;
    progress = (cycle_time - PHASE_3_START) / PHASE_3_TWINKLE;
  } else if (cycle_time < PHASE_5_START) {
    phase = 4.0;
    progress = (cycle_time - PHASE_4_START) / PHASE_4_GLOW;
  } else if (cycle_time < PHASE_6_START) {
    phase = 5.0;
    progress = (cycle_time - PHASE_5_START) / PHASE_5_MORPH;
  } else {
    phase = 6.0;
    progress = (cycle_time - PHASE_6_START) / PHASE_6_FADE;
  }
  return vec2f(phase, clamp(progress, 0.0, 1.0));
}

fn hash_u32(n: u32) -> f32 {
  var state: u32 = n * 747796405u + 2891336453u;
  var word: u32 = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  word = (word >> 22u) ^ word;
  return f32(word) / 4294967295.0;
}

fn phase_idle(base_color: vec3f, base_bright: f32, progress: f32, global_time: f32, sat_idx: u32, sat_pos: vec3f) -> vec3f {
  let breathe = 1.0 + sin(global_time * 0.5) * 0.05;
  return base_color * base_bright * breathe;
}

fn phase_emerge(base_color: vec3f, base_bright: f32, progress: f32, feature: u32, sat_idx: u32) -> vec4f {
  let t = 1.0 - pow(1.0 - progress, 3.0);
  var target_color: vec3f;
  var target_bright: f32;
  switch (feature) {
    case FEATURE_LEFT_EYE: {
      target_color = COLOR_AMBER;
      target_bright = 1.2;
    }
    case FEATURE_RIGHT_EYE: {
      target_color = COLOR_AMBER;
      target_bright = 1.2;
    }
    case FEATURE_SMILE_CURVE: {
      target_color = COLOR_GOLDEN;
      target_bright = 1.0;
    }
    default: {
      target_color = base_color * 0.7;
      target_bright = base_bright * 0.8;
    }
  }
  let color = mix(base_color * base_bright, target_color * target_bright, t);
  return vec4f(color, 1.0);
}

fn phase_blink(base_color: vec3f, base_bright: f32, progress: f32, feature: u32, sat_idx: u32) -> vec4f {
  var color: vec3f;
  var bright: f32;
  switch (feature) {
    case FEATURE_LEFT_EYE: {
      let blink_phase = fract(progress * 2.0);
      let blink = 1.0 - smoothstep(0.45, 0.5, blink_phase) * smoothstep(0.55, 0.5, blink_phase);
      color = COLOR_AMBER;
      bright = 1.2 * blink;
    }
    case FEATURE_RIGHT_EYE: {
      let blink_phase = fract(progress * 2.0 + 0.5);
      let blink = 1.0 - smoothstep(0.45, 0.5, blink_phase) * smoothstep(0.55, 0.5, blink_phase);
      color = COLOR_AMBER;
      bright = 1.2 * blink;
    }
    case FEATURE_SMILE_CURVE: {
      color = COLOR_GOLDEN;
      bright = 1.0 + sin(progress * 6.28318) * 0.1;
    }
    default: {
      color = base_color * 0.7;
      bright = base_bright * 0.8;
    }
  }
  return vec4f(color * bright, 1.0);
}

fn phase_twinkle(base_color: vec3f, base_bright: f32, progress: f32, feature: u32, sat_idx: u32, uv: vec2f) -> vec4f {
  var color: vec3f;
  var bright: f32;
  switch (feature) {
    case FEATURE_LEFT_EYE, FEATURE_RIGHT_EYE: {
      color = COLOR_AMBER;
      bright = 1.1 + sin(progress * 4.0) * 0.1;
    }
    case FEATURE_SMILE_CURVE: {
      let normalized_x = (uv.x - SMILE_X_MIN) / (SMILE_X_MAX - SMILE_X_MIN);
      let wave_pos = fract(progress * 3.0);
      let dist_to_wave = abs(normalized_x - wave_pos);
      let wave_sparkle = 1.0 + smoothstep(0.15, 0.0, dist_to_wave) * 0.6;
      let hash_val = hash_u32(sat_idx);
      let individual_twinkle = 1.0 + sin(hash_val * 100.0 + progress * 15.0) * 0.2;
      color = COLOR_GOLDEN;
      bright = 1.0 * wave_sparkle * individual_twinkle;
    }
    default: {
      color = base_color * 0.7;
      bright = base_bright * 0.8;
    }
  }
  return vec4f(color * bright, 1.0);
}

fn phase_glow(base_color: vec3f, base_bright: f32, progress: f32, feature: u32, sat_idx: u32) -> vec4f {
  let pulse = 1.0 + sin(progress * 3.14159) * 0.5;
  var color: vec3f;
  var bright: f32;
  switch (feature) {
    case FEATURE_LEFT_EYE, FEATURE_RIGHT_EYE: {
      let eye_color = mix(COLOR_AMBER, COLOR_WARM_WHITE, pulse - 1.0);
      color = eye_color;
      bright = 1.2 * pulse;
    }
    case FEATURE_SMILE_CURVE: {
      let smile_color = mix(COLOR_GOLDEN, COLOR_WARM_WHITE, pulse - 1.0);
      color = smile_color;
      bright = 1.0 * pulse;
    }
    default: {
      color = base_color;
      bright = base_bright * (0.8 + pulse * 0.2);
    }
  }
  return vec4f(color * bright, 1.0);
}

fn phase_morph(base_color: vec3f, base_bright: f32, progress: f32, feature: u32, sat_idx: u32) -> vec4f {
  let morph_t = smoothstep(0.0, 1.0, progress);
  var color: vec3f;
  var bright: f32;
  switch (feature) {
    case FEATURE_LEFT_EYE, FEATURE_RIGHT_EYE: {
      let dim = 1.0 - morph_t * 0.7;
      color = COLOR_AMBER * dim;
      bright = 1.2 * dim;
    }
    case FEATURE_SMILE_CURVE: {
      let dim = 1.0 - morph_t * 0.6;
      color = COLOR_GOLDEN * dim;
      bright = 1.0 * dim;
    }
    case FEATURE_MORPH_TARGET: {
      if (params.morph_mode == 0u) {
        color = mix(COLOR_X_LOGO, COLOR_CYAN_ACCENT, morph_t * 0.5);
      } else {
        color = mix(COLOR_WARM_WHITE, COLOR_GROK_GLOW, morph_t);
      }
      bright = 1.5 + sin(progress * 6.28318 * 2.0) * 0.3;
    }
    default: {
      color = base_color * 0.5;
      bright = base_bright * 0.6;
    }
  }
  return vec4f(color * bright, 1.0);
}

fn phase_fade(base_color: vec3f, base_bright: f32, progress: f32, feature: u32, sat_idx: u32) -> vec4f {
  let t = progress * progress;
  var target_color: vec3f;
  var target_bright: f32;
  switch (feature) {
    case FEATURE_LEFT_EYE: {
      target_color = COLOR_AMBER;
      target_bright = 1.2;
    }
    case FEATURE_RIGHT_EYE: {
      target_color = COLOR_AMBER;
      target_bright = 1.2;
    }
    case FEATURE_SMILE_CURVE: {
      target_color = COLOR_GOLDEN;
      target_bright = 1.0;
    }
    case FEATURE_MORPH_TARGET: {
      if (params.morph_mode == 0u) {
        target_color = COLOR_X_LOGO;
      } else {
        target_color = COLOR_GROK_GLOW;
      }
      target_bright = 1.5;
    }
    default: {
      target_color = base_color * 0.7;
      target_bright = base_bright * 0.8;
    }
  }
  let color = mix(target_color * target_bright, base_color * base_bright, t);
  return vec4f(color, 1.0);
}

fn smile_pattern(sat_pos: vec3f, sat_idx: u32, base_color: vec3f, base_bright: f32, cycle_time: f32, global_time: f32) -> vec4f {
  let earth_dir = normalize(-sat_pos);
  let uv = gnomonic_project_satellite(sat_pos, earth_dir);
  let feature = get_smile_feature(uv);
  let phase_info = get_animation_phase(cycle_time);
  let phase = u32(phase_info.x);
  let phase_progress = phase_info.y;
  var result: vec4f;
  switch (phase) {
    case 0u: {
      result = vec4f(phase_idle(base_color, base_bright, phase_progress, global_time, sat_idx, sat_pos), 1.0);
    }
    case 1u: {
      result = phase_emerge(base_color, base_bright, phase_progress, feature, sat_idx);
    }
    case 2u: {
      result = phase_blink(base_color, base_bright, phase_progress, feature, sat_idx);
    }
    case 3u: {
      result = phase_twinkle(base_color, base_bright, phase_progress, feature, sat_idx, uv);
    }
    case 4u: {
      result = phase_glow(base_color, base_bright, phase_progress, feature, sat_idx);
    }
    case 5u: {
      result = phase_morph(base_color, base_bright, phase_progress, feature, sat_idx);
    }
    case 6u: {
      result = phase_fade(base_color, base_bright, phase_progress, feature, sat_idx);
    }
    default: {
      result = vec4f(base_color * base_bright, 1.0);
    }
  }
  let feature_alpha = f32(feature) / 4.0;
  return vec4f(result.rgb, feature_alpha);
}

fn chaos_mode(sat_pos: vec3f, sat_idx: u32, base_color: vec3f, base_bright: f32, global_time: f32) -> vec4f {
  let hash_val = hash_u32(sat_idx);
  let twinkle1 = 0.5 + 0.5 * sin(global_time * (0.5 + hash_val * 0.5) + hash_val * 10.0);
  let twinkle2 = 0.5 + 0.5 * sin(global_time * (0.3 + hash_val * 0.3) + hash_val * 20.0);
  let combined_twinkle = 0.7 + 0.3 * (twinkle1 * 0.6 + twinkle2 * 0.4);
  let color_shift = 1.0 + (hash_val - 0.5) * 0.1;
  let color = base_color * color_shift * base_bright * combined_twinkle;
  return vec4f(color, 0.0);
}

fn apply_transition(smile_output: vec4f, chaos_output: vec4f, alpha: f32) -> vec4f {
  let smooth_alpha = smoothstep(0.0, 1.0, alpha);
  let color = mix(chaos_output.rgb, smile_output.rgb, smooth_alpha);
  let feature = mix(chaos_output.a, smile_output.a, smooth_alpha);
  return vec4f(color, feature);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let sat_idx = gid.x;
  if (sat_idx >= NUM_SATELLITES) {
    return;
  }
  let sat_data = sat_positions[sat_idx];
  let sat_pos = sat_data.xyz;
  let cdat = sat_data.w;
  let cidx = u32(abs(cdat)) % 7u;
  var base_color: vec3f;
  switch (cidx) {
    case 0u: { base_color = vec3f(1.0, 0.18, 0.18); }
    case 1u: { base_color = vec3f(0.18, 1.0, 0.18); }
    case 2u: { base_color = vec3f(0.25, 0.45, 1.0); }
    case 3u: { base_color = vec3f(1.0, 1.0, 0.1); }
    case 4u: { base_color = vec3f(0.1, 1.0, 1.0); }
    case 5u: { base_color = vec3f(1.0, 0.1, 1.0); }
    default: { base_color = vec3f(1.0, 1.0, 1.0); }
  }
  let base_bright = 1.0;
  let smile_output = smile_pattern(sat_pos, sat_idx, base_color, base_bright, params.cycle_time, params.global_time);
  let chaos_output = chaos_mode(sat_pos, sat_idx, base_color, base_bright, params.global_time);
  var final_output: vec4f;
  if (params.target_mode < 0.5) {
    final_output = apply_transition(smile_output, chaos_output, params.transition_alpha);
  } else {
    final_output = apply_transition(smile_output, chaos_output, params.transition_alpha);
  }
  sat_output[sat_idx] = final_output;
}
`;
