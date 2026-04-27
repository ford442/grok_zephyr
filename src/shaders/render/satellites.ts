/**
 * Satellite Billboard Shader
 * Lens flare glow, shell differentiation, solar panel glint,
 * plus animation patterns (Smile, Digital Rain, Heartbeat)
 */

import { UNIFORM_STRUCT } from '../uniforms.js';

export const SATELLITE_SHADER = UNIFORM_STRUCT + /* wgsl */ `
@group(0) @binding(1) var<storage, read> sat_pos : array<vec4f>;

// Pattern parameters (updated from CPU when animation buttons are clicked)
struct PatternParams {
  animation_time: f32,
  pattern_mode: u32,
  seed: u32,
  padding: u32,
}
@group(0) @binding(3) var<uniform> params : PatternParams;

struct VOut {
  @builtin(position) cp : vec4f,
  @location(0) uv       : vec2f,
  @location(1) color    : vec3f,
  @location(2) bright   : f32,
  @location(3) shell    : f32,
};

const PI: f32 = 3.14159265;

// Pattern mode constants
const PATTERN_SMILE: u32 = 3u;
const PATTERN_DIGITAL_RAIN: u32 = 4u;
const PATTERN_HEARTBEAT: u32 = 5u;

// Smile animation phases
const SMILE_PHASE_EMERGE: i32 = 0;
const SMILE_PHASE_GLOW: i32 = 1;
const SMILE_PHASE_TWINKLE: i32 = 2;
const SMILE_PHASE_FADE: i32 = 3;
const SMILE_PHASE_DURATION: f32 = 8.0;

fn sat_color(idx: u32) -> vec3f {
  let c = idx % 7u;
  switch c {
    case 0u: { return vec3f(1.0, 0.18, 0.18); }
    case 1u: { return vec3f(0.18, 1.0, 0.18); }
    case 2u: { return vec3f(0.25, 0.45, 1.0); }
    case 3u: { return vec3f(1.0, 1.0, 0.1); }
    case 4u: { return vec3f(0.1, 1.0, 1.0); }
    case 5u: { return vec3f(1.0, 0.1, 1.0); }
    default: { return vec3f(1.0, 1.0, 1.0); }
  }
}

// Shell color temperature shifts
fn shellColorShift(shell: u32) -> vec3f {
  switch shell {
    case 0u: { return vec3f(1.0, 0.85, 0.6); }   // LEO: warm amber
    case 1u: { return vec3f(1.0, 1.0, 1.0); }     // Mid: neutral white
    case 2u: { return vec3f(0.7, 0.85, 1.0); }    // High: cool cyan
    default: { return vec3f(1.0, 1.0, 1.0); }
  }
}

fn shellSizeScale(shell: u32) -> f32 {
  switch shell {
    case 0u: { return 0.8; }    // LEO: smaller, tighter
    case 1u: { return 1.0; }    // Mid: reference
    case 2u: { return 1.3; }    // High: larger, diffuse
    default: { return 1.0; }
  }
}

// Simple hash for glint calculation
fn hash_u32(n: u32) -> f32 {
  var x = n;
  x = x ^ (x >> 16u);
  x = x * 0x45d9f3bu;
  x = x ^ (x >> 16u);
  return f32(x & 0xFFFFu) / 65535.0;
}

// Pattern hash functions
fn hash(n: u32) -> f32 {
  return fract(sin(f32(n) * 43758.5453) * 43758.5453);
}

fn hash2(n: u32, seed: f32) -> f32 {
  return fract(sin(f32(n) * 12.9898 + seed * 78.233) * 43758.5453);
}

// Transform satellite position to Earth-facing coordinate system
fn to_earth_facing_coords(sat_pos: vec3f) -> vec3f {
  let to_earth = normalize(-sat_pos);
  let up = vec3f(0.0, 0.0, 1.0);
  let right = normalize(cross(to_earth, up));
  let local_up = cross(right, to_earth);
  let local_x = dot(sat_pos, right);
  let local_y = dot(sat_pos, local_up);
  let local_z = dot(sat_pos, -to_earth);
  return vec3f(local_x, local_y, local_z);
}

// Classify satellite for smile pattern
// Returns: 0=background, 1=left_eye, 2=right_eye, 3=smile_curve
fn classify_smile_feature(sat_pos: vec3f, earth_dir: vec3f) -> u32 {
  let local = to_earth_facing_coords(sat_pos);
  let scale = 1.0 / 6921.0;
  let x = local.x * scale;
  let y = local.y * scale;

  let left_eye_dist = length(vec2f(x - (-0.3), y - 0.3));
  let right_eye_dist = length(vec2f(x - 0.3, y - 0.3));

  let smile_y = -0.5 * x * x - 0.2;
  let smile_curve = abs(y - smile_y);

  if (left_eye_dist < 0.08) { return 1u; }
  if (right_eye_dist < 0.08) { return 2u; }
  if (smile_curve < 0.05 && y < -0.1) { return 3u; }
  return 0u;
}

// Smile animation color calculation
fn smile_pattern(sat_idx: u32, sat_pos: vec3f, time: f32, earth_dir: vec3f) -> vec4f {
  let cycle_time = f32(4) * SMILE_PHASE_DURATION;
  let phase = i32(time % cycle_time / SMILE_PHASE_DURATION);
  let t = fract(time % cycle_time / SMILE_PHASE_DURATION);

  let feature = classify_smile_feature(sat_pos, earth_dir);

  let eye_color = vec3f(1.0, 0.7, 0.28);
  let smile_color = vec3f(1.0, 0.84, 0.0);
  let bg_color = sat_color(sat_idx) * 0.2;

  if (feature == 0u) {
    var bg_alpha = 0.2;
    switch phase {
      case SMILE_PHASE_EMERGE: { bg_alpha = mix(1.0, 0.2, t); }
      case SMILE_PHASE_GLOW: { bg_alpha = 0.2; }
      case SMILE_PHASE_TWINKLE: { bg_alpha = 0.2 + 0.1 * sin(t * 10.0); }
      case SMILE_PHASE_FADE: { bg_alpha = mix(0.2, 1.0, t); }
      default: {}
    }
    return vec4f(bg_color * bg_alpha, bg_alpha);
  }

  var col: vec3f;
  var alpha: f32 = 1.0;

  if (feature == 1u || feature == 2u) {
    col = eye_color;
    let blink_period = select(3.0, 3.2, feature == 2u);
    let blink = smoothstep(0.0, 0.1, abs(sin(time * 3.14159 / blink_period)));
    col *= blink;
  } else {
    col = smile_color;
    let wave = sin(to_earth_facing_coords(sat_pos).x * 0.01 + time * 2.0);
    col *= 0.8 + 0.2 * wave;
  }

  switch phase {
    case SMILE_PHASE_EMERGE: {
      let fade = smoothstep(0.0, 0.3, t);
      col *= fade;
      alpha = fade;
    }
    case SMILE_PHASE_GLOW: {
      let pulse = 0.9 + 0.1 * sin(t * 3.14159);
      col *= pulse;
    }
    case SMILE_PHASE_TWINKLE: {
      let sparkle = hash2(sat_idx, time * 10.0);
      col *= 0.7 + 0.6 * sparkle;
    }
    case SMILE_PHASE_FADE: {
      let dissolve = 1.0 - smoothstep(0.7, 1.0, t);
      col *= dissolve;
      alpha = dissolve;
    }
    default: {}
  }

  return vec4f(col, alpha);
}

// Digital Rain pattern (Matrix-style)
fn digital_rain_pattern(sat_idx: u32, sat_pos: vec3f, time: f32) -> vec4f {
  let column = floor(sat_pos.x / 50.0);
  let drop_speed = 2.0 + fract(f32(column) * 0.37) * 3.0;
  let drop_pos = fract(time * drop_speed + f32(column) * 0.1);

  let normalized_height = (sat_pos.y + 1000.0) / 2000.0;
  let dist_to_drop = abs(normalized_height - drop_pos);

  let intensity = 1.0 - smoothstep(0.0, 0.15, dist_to_drop);
  let trail = smoothstep(0.15, 0.3, dist_to_drop) * 0.3;

  let final_intensity = max(intensity, trail);

  let green = 0.5 + 0.5 * hash(sat_idx);
  return vec4f(0.0, green * final_intensity, 0.0, final_intensity);
}

// Heartbeat pattern
fn heartbeat_pattern(sat_idx: u32, sat_pos: vec3f, time: f32) -> vec4f {
  let beat = time % 0.8;
  let first_beat = smoothstep(0.0, 0.1, beat) * (1.0 - smoothstep(0.1, 0.2, beat));
  let second_beat = smoothstep(0.3, 0.35, beat) * (1.0 - smoothstep(0.35, 0.45, beat));
  let pulse = max(first_beat, second_beat * 0.6);

  let dist_from_center = length(sat_pos.xy);
  let wave_delay = dist_from_center * 0.0001;
  let wave_pulse = smoothstep(0.0, 0.1, fract((time - wave_delay) * 1.25));

  let total_pulse = max(pulse, wave_pulse * 0.3);

  let pinkness = 0.3 + 0.4 * total_pulse;
  let col = vec3f(1.0, pinkness, pinkness);

  return vec4f(col * total_pulse, total_pulse);
}

@vertex
fn vs(
  @builtin(vertex_index)   vi : u32,
  @builtin(instance_index) ii : u32,
) -> VOut {
  let pd = sat_pos[ii];
  let wp = pd.xyz;
  let cdat = pd.w;
  let cam = uni.camera_pos.xyz;
  let dist = length(wp - cam);

  const quad = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0,  1.0), vec2f(1.0, -1.0), vec2f( 1.0, 1.0)
  );

  let qv = quad[vi];
  let right = uni.camera_right.xyz;
  let up = uni.camera_up.xyz;

  // Shell detection from instance index (~1M satellites / 3 shells = 349525 per shell)
  let shellIdx = ii / 349525u;
  let shellSize = shellSizeScale(shellIdx);

  // Increased max distance from 14000 to 150000 to support ground/Moon views
  let bsize = clamp(1200.0 / max(dist, 50.0), 0.4, 60.0) *
              select(0.0, 1.0, dist < 150000.0) * shellSize;
  let offset = (qv.x * right + qv.y * up) * bsize;
  let fpos = wp + offset;

  let baseColor = sat_color(u32(abs(cdat)) % 7u);
  let shellTint = shellColorShift(shellIdx);
  let col = baseColor * shellTint;

  let phase = cdat * 0.15 + uni.time * 0.8;
  let pattern = 0.35 + 0.65 * (0.5 + 0.5 * sin(phase));
  let atten = 1.0 / (1.0 + dist * 0.00075);

  // Solar panel glint simulation
  let glintHash = hash_u32(ii);
  let glintPhase = fract(uni.time * 0.1 + glintHash * 10.0);
  let glintAlignment = 1.0 - abs(glintPhase - 0.5) * 2.0;
  let glint = pow(glintAlignment, 8.0) * 0.8;

  var out: VOut;
  out.cp = uni.view_proj * vec4f(fpos, 1.0);
  out.uv = (qv + 1.0) * 0.5;

  // Apply animation patterns if active (modes 3-5)
  if (params.pattern_mode > 0u) {
    let earth_dir = normalize(-wp);
    var pattern_col: vec4f;
    switch params.pattern_mode {
      case PATTERN_SMILE: {
        pattern_col = smile_pattern(ii, wp, uni.time, earth_dir);
      }
      case PATTERN_DIGITAL_RAIN: {
        pattern_col = digital_rain_pattern(ii, wp, uni.time);
      }
      case PATTERN_HEARTBEAT: {
        pattern_col = heartbeat_pattern(ii, wp, uni.time);
      }
      default: {
        pattern_col = vec4f(col, 1.0);
      }
    }
    out.color = pattern_col.rgb;
    out.bright = pattern_col.a * atten;
    // Boost bright pattern features for visibility
    if (pattern_col.a > 0.5) {
      out.bright *= 1.5;
    }
  } else {
    out.color = col;
    out.bright = pattern * atten + glint * atten;
  }

  out.shell = f32(shellIdx);
  return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let centered = in.uv - 0.5;
  let d = length(centered) * 2.0;
  if (d > 1.0) { discard; }

  let angle = atan2(centered.y, centered.x);

  // Core glow (Gaussian)
  let core = exp(-d * d * 8.0);

  // Multi-octave halos (lens flare rings)
  var halos = 0.0;
  halos += exp(-pow((d - 0.25) / 0.08, 2.0)) * 0.4;
  halos += exp(-pow((d - 0.50) / 0.06, 2.0)) * 0.2;
  halos += exp(-pow((d - 0.75) / 0.05, 2.0)) * 0.1;

  // 4-point diffraction spikes
  let spike = pow(abs(cos(angle * 2.0)), 16.0) * exp(-d * 3.0) * 0.4;

  // Outer glow falloff
  let outerGlow = exp(-d * 2.5) * 0.3;

  // Shell-dependent glow width (shells clamped to [0,2] range)
  let shellGlowMod = mix(1.2, 0.7, clamp(in.shell, 0.0, 2.0) / 2.0);
  let total = (core * 2.0 + halos * shellGlowMod + spike + outerGlow) * in.bright;

  // Color: core white-hot, edges colored
  let coreWhite = vec3f(1.0, 1.0, 1.0);
  let finalColor = mix(in.color, coreWhite, core * 0.6);

  let hdr = finalColor * total * 2.8;
  let alpha = clamp(total, 0.0, 1.0);

  return vec4f(hdr, alpha);
}
`;
