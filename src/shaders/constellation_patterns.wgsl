/**
 * Constellation Pattern Animation Shader
 * 
 * Coordinated satellite patterns including:
 * - "Smile from the Moon" - giant smiley face animation
 * - Digital Rain - Matrix-style cascading columns
 * - Heartbeat - constellation-wide rhythm pulse
 * - Fireworks - explosive burst patterns
 */

#import "uniforms.wgsl"

@group(0) @binding(1) var<storage, read> sat_pos : array<vec4f>;

// Pattern mode constants
const PATTERN_CHAOS: u32 = 0u;
const PATTERN_GROK: u32 = 1u;
const PATTERN_X: u32 = 2u;
const PATTERN_SMILE: u32 = 3u;
const PATTERN_DIGITAL_RAIN: u32 = 4u;
const PATTERN_HEARTBEAT: u32 = 5u;
const PATTERN_FIREWORKS: u32 = 6u;

// Smile animation phases
const SMILE_PHASE_EMERGE: i32 = 0;
const SMILE_PHASE_GLOW: i32 = 1;
const SMILE_PHASE_TWINKLE: i32 = 2;
const SMILE_PHASE_FADE: i32 = 3;
const SMILE_PHASE_DURATION: f32 = 8.0; // seconds per phase

struct PatternParams {
  pattern_mode: u32,
  animation_time: f32,
  seed: f32,
  padding: f32,
}

@group(0) @binding(2) var<uniform> params : PatternParams;

struct VOut {
  @builtin(position) cp : vec4f,
  @location(0) uv       : vec2f,
  @location(1) color    : vec3f,
  @location(2) bright   : f32,
  @location(3) pattern_id: f32,
}

// Hash function for randomness
fn hash(n: u32) -> f32 {
  return fract(sin(f32(n) * 43758.5453) * 43758.5453);
}

fn hash2(n: u32, seed: f32) -> f32 {
  return fract(sin(f32(n) * 12.9898 + seed * 78.233) * 43758.5453);
}

// Noise function for smooth variation
fn noise(p: f32) -> f32 {
  let i = floor(p);
  let f = fract(p);
  return mix(hash(u32(i)), hash(u32(i) + 1u), smoothstep(0.0, 1.0, f));
}

// Base satellite colors
fn sat_color(idx: u32) -> vec3f {
  let c = idx % 7u;
  switch c {
    case 0u: { return vec3f(1.0, 0.18, 0.18); }  // Red
    case 1u: { return vec3f(0.18, 1.0, 0.18); }  // Green
    case 2u: { return vec3f(0.25, 0.45, 1.0); }  // Blue
    case 3u: { return vec3f(1.0, 1.0, 0.1); }    // Yellow
    case 4u: { return vec3f(0.1, 1.0, 1.0); }    // Cyan
    case 5u: { return vec3f(1.0, 0.1, 1.0); }    // Magenta
    default: { return vec3f(1.0, 1.0, 1.0); }    // White
  }
}

// Transform satellite position to Earth-facing coordinate system
fn to_earth_facing_coords(sat_pos: vec3f) -> vec3f {
  // Earth is at origin (0,0,0)
  // Transform so that we're looking at Earth from satellite position
  let to_earth = normalize(-sat_pos);
  let up = vec3f(0.0, 0.0, 1.0);
  let right = normalize(cross(to_earth, up));
  let local_up = cross(right, to_earth);
  
  // Create a coordinate system relative to Earth direction
  // X: right, Y: up (relative to Earth view), Z: distance from Earth
  let local_x = dot(sat_pos, right);
  let local_y = dot(sat_pos, local_up);
  let local_z = dot(sat_pos, -to_earth); // Distance component
  
  return vec3f(local_x, local_y, local_z);
}

// Classify satellite for smile pattern
// Returns: 0=background, 1=left_eye, 2=right_eye, 3=smile_curve
fn classify_smile_feature(sat_pos: vec3f, earth_dir: vec3f) -> u32 {
  // Check if satellite is on Earth-facing hemisphere
  let facing_earth = dot(normalize(sat_pos), -earth_dir) > 0.7;
  if (!facing_earth) {
    return 0u;
  }
  
  // Transform to Earth-facing local coordinates
  let local = to_earth_facing_coords(sat_pos);
  
  // Normalize to constellation scale (typical orbit radius ~6921km)
  let scale = 1.0 / 6921.0;
  let x = local.x * scale;
  let y = local.y * scale;
  
  // Eye positions (relative coordinates)
  let left_eye_dist = length(vec2f(x - (-0.3), y - 0.3));
  let right_eye_dist = length(vec2f(x - 0.3, y - 0.3));
  
  // Smile curve: parabola y = -0.5 * x^2 - 0.2
  let smile_y = -0.5 * x * x - 0.2;
  let smile_curve = abs(y - smile_y);
  
  if (left_eye_dist < 0.08) { return 1u; } // Left eye
  if (right_eye_dist < 0.08) { return 2u; } // Right eye
  if (smile_curve < 0.05 && y < -0.1) { return 3u; } // Smile
  return 0u; // Background
}

// Smile animation color calculation
fn smile_pattern(sat_idx: u32, sat_pos: vec3f, time: f32, earth_dir: vec3f) -> vec4f {
  let cycle_time = f32(4) * SMILE_PHASE_DURATION;
  let phase = i32(time % cycle_time / SMILE_PHASE_DURATION);
  let t = fract(time % cycle_time / SMILE_PHASE_DURATION);
  
  let feature = classify_smile_feature(sat_pos, earth_dir);
  
  // Colors for smile elements
  let eye_color = vec3f(1.0, 0.7, 0.28);     // Warm amber #FFB347
  let smile_color = vec3f(1.0, 0.84, 0.0);   // Golden yellow #FFD700
  let bg_color = sat_color(sat_idx) * 0.2;    // Dimmed background
  
  if (feature == 0u) {
    // Background - fade to 20% during smile
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
    // Eyes
    col = eye_color;
    // Offset blink between eyes (3s and 3.2s periods)
    let blink_period = select(3.0, 3.2, feature == 2u);
    let blink = smoothstep(0.0, 0.1, abs(sin(time * 3.14159 / blink_period)));
    col *= blink;
  } else {
    // Smile
    col = smile_color;
    // Gentle pulse wave traveling left to right
    let wave = sin(to_earth_facing_coords(sat_pos).x * 0.01 + time * 2.0);
    col *= 0.8 + 0.2 * wave;
  }
  
  // Phase-specific animations
  switch phase {
    case SMILE_PHASE_EMERGE: {
      // Fade in from black
      let fade = smoothstep(0.0, 0.3, t);
      col *= fade;
      alpha = fade;
    }
    case SMILE_PHASE_GLOW: {
      // Warm yellow pulse
      let pulse = 0.9 + 0.1 * sin(t * 3.14159);
      col *= pulse;
    }
    case SMILE_PHASE_TWINKLE: {
      // Sparkle effect
      let sparkle = hash2(sat_idx, time * 10.0);
      col *= 0.7 + 0.6 * sparkle;
    }
    case SMILE_PHASE_FADE: {
      // Dissolve back to chaos
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
  let column = floor(sat_pos.x / 50.0); // 50km columns
  let drop_speed = 2.0 + fract(f32(column) * 0.37) * 3.0;
  let drop_pos = fract(time * drop_speed + f32(column) * 0.1);
  
  // Normalize height to 0-1 range around typical orbit
  let normalized_height = (sat_pos.y + 1000.0) / 2000.0;
  let dist_to_drop = abs(normalized_height - drop_pos);
  
  // Check Earth-facing side
  let earth_dir = normalize(-sat_pos);
  let facing = dot(normalize(sat_pos), earth_dir) < -0.5;
  
  if (!facing) {
    return vec4f(0.0, 0.0, 0.0, 0.0);
  }
  
  let intensity = 1.0 - smoothstep(0.0, 0.15, dist_to_drop);
  let trail = smoothstep(0.15, 0.3, dist_to_drop) * 0.3; // Fading trail
  
  let final_intensity = max(intensity, trail);
  
  // Green with slight variation
  let green = 0.5 + 0.5 * hash(sat_idx);
  return vec4f(0.0, green * final_intensity, 0.0, final_intensity);
}

// Heartbeat pattern
fn heartbeat_pattern(sat_idx: u32, sat_pos: vec3f, time: f32) -> vec4f {
  // "Lub-dub" rhythm: 0.8s period
  let beat = time % 0.8;
  let first_beat = smoothstep(0.0, 0.1, beat) * (1.0 - smoothstep(0.1, 0.2, beat));
  let second_beat = smoothstep(0.3, 0.35, beat) * (1.0 - smoothstep(0.35, 0.45, beat));
  let pulse = max(first_beat, second_beat * 0.6);
  
  // Radial wave from constellation center
  let dist_from_center = length(sat_pos.xy);
  let wave_delay = dist_from_center * 0.0001;
  let wave_pulse = smoothstep(0.0, 0.1, fract((time - wave_delay) * 1.25));
  
  let total_pulse = max(pulse, wave_pulse * 0.3);
  
  // Red to pink color shift
  let pinkness = 0.3 + 0.4 * total_pulse;
  let col = vec3f(1.0, pinkness, pinkness);
  
  return vec4f(col * total_pulse, total_pulse);
}

// Fireworks pattern
fn fireworks_pattern(sat_idx: u32, sat_pos: vec3f, time: f32) -> vec4f {
  // Determine if this satellite is a burst center
  let burst_interval = 3.0;
  let burst_time = time % burst_interval;
  let burst_seed = u32(time / burst_interval);
  
  // Use hash to select random burst centers
  let is_burst_center = hash2(sat_idx, f32(burst_seed)) > 0.9995;
  
  if (is_burst_center && burst_time < 1.5) {
    // This is an explosion center
    let wave = 1.0 - smoothstep(0.0, 1.5, burst_time);
    let rainbow = vec3f(
      sin(f32(sat_idx) * 0.1) * 0.5 + 0.5,
      sin(f32(sat_idx) * 0.1 + 2.0) * 0.5 + 0.5,
      sin(f32(sat_idx) * 0.1 + 4.0) * 0.5 + 0.5
    );
    return vec4f(rainbow * wave, wave);
  }
  
  // Check if affected by nearby burst
  // (Simplified - check distance to burst centers)
  var max_effect: f32 = 0.0;
  
  // Sample a few nearby potential burst centers
  for (var i = 0u; i < 8u; i = i + 1u) {
    let check_idx = (sat_idx + i * 131071u) % 1048576u; // Large prime for distribution
    if (hash2(check_idx, f32(burst_seed)) > 0.9995) {
      let check_pos = sat_pos[check_idx].xyz;
      let dist = length(sat_pos - check_pos);
      let wave_radius = burst_time * 500.0; // Expanding wave
      let wave_thickness = 100.0;
      let dist_from_wave = abs(dist - wave_radius);
      let effect = (1.0 - smoothstep(0.0, wave_thickness, dist_from_wave)) * (1.0 - burst_time / 1.5);
      max_effect = max(max_effect, effect);
    }
  }
  
  if (max_effect > 0.01) {
    let rainbow = vec3f(
      sin(f32(sat_idx) * 0.1) * 0.5 + 0.5,
      sin(f32(sat_idx) * 0.1 + 2.0) * 0.5 + 0.5,
      sin(f32(sat_idx) * 0.1 + 4.0) * 0.5 + 0.5
    );
    return vec4f(rainbow * max_effect, max_effect);
  }
  
  return vec4f(0.0);
}

// Calculate pattern-based color
fn calculate_pattern_color(sat_idx: u32, sat_pos: vec3f, time: f32) -> vec4f {
  let earth_dir = normalize(-sat_pos);
  
  switch params.pattern_mode {
    case PATTERN_SMILE: {
      return smile_pattern(sat_idx, sat_pos, params.animation_time, earth_dir);
    }
    case PATTERN_DIGITAL_RAIN: {
      return digital_rain_pattern(sat_idx, sat_pos, params.animation_time);
    }
    case PATTERN_HEARTBEAT: {
      return heartbeat_pattern(sat_idx, sat_pos, params.animation_time);
    }
    case PATTERN_FIREWORKS: {
      return fireworks_pattern(sat_idx, sat_pos, params.animation_time);
    }
    default: {
      // Fall back to chaos pattern
      let col = sat_color(sat_idx);
      let phase = f32(sat_idx) * 0.0001 + time * 0.5;
      let pattern = 0.35 + 0.65 * (0.5 + 0.5 * sin(phase));
      return vec4f(col * pattern, pattern);
    }
  }
}

@vertex
fn vs(
  @builtin(vertex_index)   vi : u32,
  @builtin(instance_index) ii : u32,
) -> VOut {
  let pd = sat_pos[ii];
  let wp = pd.xyz;
  let cam = uni.camera_pos.xyz;
  let dist = length(wp - cam);
  
  // Extended distance cull for Moon view
  var visible = dist <= 500000.0;
  
  // Frustum cull
  if (visible) {
    for (var p = 0u; p < 6u; p++) {
      let pl = uni.frustum[p];
      if (dot(pl.xyz, wp) + pl.w < -200.0) {
        visible = false;
        break;
      }
    }
  }
  
  var out: VOut;
  if (!visible) {
    out.cp = vec4f(10.0, 10.0, 10.0, 1.0);
    out.uv = vec2f(0.0);
    out.color = vec3f(0.0);
    out.bright = 0.0;
    out.pattern_id = -1.0;
    return out;
  }
  
  // LOD-based billboard sizing
  var bsize: f32;
  if (dist < 500.0) {
    bsize = clamp(1200.0 / max(dist, 50.0), 0.8, 80.0);
  } else if (dist < 2000.0) {
    bsize = clamp(1200.0 / max(dist, 50.0), 0.5, 40.0);
  } else if (dist < 8000.0) {
    bsize = clamp(800.0 / max(dist, 100.0), 0.3, 20.0);
  } else {
    bsize = max(2.0, 20000.0 / max(dist, 1000.0));
  }
  
  const quad = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0,  1.0), vec2f(1.0, -1.0), vec2f( 1.0, 1.0)
  );
  
  let qv = quad[vi];
  let right = uni.camera_right.xyz;
  let up = uni.camera_up.xyz;
  let offset = (qv.x * right + qv.y * up) * bsize;
  let fpos = wp + offset;
  
  // Get pattern color
  let pattern_color = calculate_pattern_color(ii, wp, uni.time);
  
  // Distance attenuation
  let atten = 1.0 / (1.0 + dist * 0.00075);
  let bright = pattern_color.a * atten;
  
  out.cp = uni.view_proj * vec4f(fpos, 1.0);
  out.uv = (qv + 1.0) * 0.5;
  out.color = pattern_color.rgb;
  out.bright = bright;
  out.pattern_id = f32(params.pattern_mode);
  return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let d = length(in.uv - 0.5) * 2.0;
  if (d > 1.0) { discard; }
  
  // LOD-based rendering
  var hdr: vec3f;
  var alpha: f32;
  
  // Simple soft circle for all patterns
  let fade = 1.0 - d * d;
  alpha = fade * in.bright;
  hdr = in.color * fade * in.bright * 3.0;
  
  return vec4f(hdr, alpha);
}
