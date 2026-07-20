/**
 * Satellite Billboard Shader
 * Lens flare glow, shell differentiation, solar panel glint,
 * plus animation patterns (Smile, Digital Rain, Heartbeat)
 */

import { UNIFORM_STRUCT } from '../uniforms.js';

export const SATELLITE_SHADER =
  UNIFORM_STRUCT +
  /* wgsl */ `
@group(0) @binding(1) var<storage, read> sat_pos : array<vec4f>;
@group(0) @binding(2) var<storage, read> group_ids : array<u32>;

struct GroupParams {
  baseColor   : vec3f,
  brightness  : f32,
  sizeScale   : f32,
  visible     : f32,
  pad         : vec2f,
}
@group(0) @binding(7) var<uniform> groups : array<GroupParams, 8>;

// Pattern parameters (updated from CPU when animation buttons are clicked)
struct PatternParams {
  pattern_mode: u32,
  animation_time: f32,
  seed: f32,
  selected_satellite: u32,
}
@group(0) @binding(3) var<uniform> params : PatternParams;

struct MotionBlurUni {
  prev_view_proj : mat4x4f,
  inv_view_proj : mat4x4f,
  camera_strength : f32,
  satellite_stretch : f32,
  delta_time : f32,
  tap_count : u32,
  host_velocity : vec3f,
  fleet_pad : f32,
}
@group(0) @binding(4) var<uniform> motion : MotionBlurUni;

struct SatelliteVisualUni {
  core_outer       : f32,
  core_inner       : f32,
  halo_outer       : f32,
  halo_inner       : f32,
  halo_strength    : f32,
  core_boost       : f32,
  distance_cull_km : f32,
  animation_intensity : f32,
  animation_contrast  : f32,
}
@group(0) @binding(5) var<uniform> satVisual : SatelliteVisualUni;

struct VOut {
  @builtin(position) cp : vec4f,
  @location(0) uv       : vec2f,
  @location(1) color    : vec3f,
  @location(2) bright   : f32,
  @location(3) shell    : f32,
  @location(4) highlight: f32,
  @location(5) world_dist: f32,
  @location(6) pattern_feature: f32,
};

const PI: f32 = 3.14159265;

// Pattern mode constants
const PATTERN_X_LOGO: u32 = 2u;
const PATTERN_SMILE: u32 = 3u;
const PATTERN_DIGITAL_RAIN: u32 = 4u;
const PATTERN_HEARTBEAT: u32 = 5u;

// Smile animation phases
const SMILE_PHASE_EMERGE: i32 = 0;
const SMILE_PHASE_GLOW: i32 = 1;
const SMILE_PHASE_TWINKLE: i32 = 2;
const SMILE_PHASE_FADE: i32 = 3;
const SMILE_PHASE_DURATION: f32 = 8.0;

// Vertex bright tiers — tuned for bloom floor 1.5 + fs core_boost (~3.5× at center).
// Effective HDR ≈ tier * strength * (1 + core_boost) at billboard core.
const PATTERN_TIER_BG: f32 = 0.30;      // sub-bloom background sats (~1.0 HDR)
const PATTERN_TIER_GLOW: f32 = 0.40;    // logo glow band, soft accents (~1.4 HDR)
const PATTERN_TIER_TRAIL: f32 = 0.50;   // digital rain trails (~1.75 HDR)
const PATTERN_TIER_FEATURE: f32 = 0.64; // smile curve, rain head (~2.2 HDR)
const PATTERN_TIER_HERO: f32 = 0.76;    // eyes, 𝕏 stroke (~2.7 HDR)

struct PatternSample {
  rgb: vec3f,
  strength: f32,
  tier: f32,
  feature: f32, // 0=bg, 1=accent, 2=hero — drives fragment kernel/boost
}

fn patternVertexBright(sample: PatternSample, atten: f32, selectionBoost: f32, pattern: u32) -> f32 {
  let distFade = mix(1.0, atten, 0.32);
  var strength = sample.strength * sample.tier * distFade * selectionBoost;
  strength *= satVisual.animation_intensity;
  strength *= patternViewIntensityBoost(pattern);
  // Contrast < 1 lifts shadow tier (heartbeat diastole); > 1 crushes bg bleed.
  let gamma = 1.0 / max(satVisual.animation_contrast, 0.5);
  return pow(clamp(strength, 0.0, 1.5), gamma);
}

// Per-pattern view-mode scalars layered on profile animationIntensity.
fn patternViewIntensityBoost(pattern: u32) -> f32 {
  let vm = uni.view_mode & 0xFFFFu;
  switch pattern {
    case PATTERN_SMILE: {
      if (vm == 3u) { return 1.12; }  // Ground: face outline readable
      if (vm == 1u) { return 0.88; }  // God: reduce halo bleed
      return 1.0;
    }
    case PATTERN_DIGITAL_RAIN: {
      if (vm == 4u) { return 0.68; }  // Moon: faint columns
      if (vm == 0u) { return 1.0; }   // Horizon: medium
      if (vm == 1u) { return 0.85; }  // God: less column soup
      return 1.0;
    }
    case PATTERN_HEARTBEAT: {
      if (vm == 2u || vm == 1u) { return 0.92; }  // Fleet/God: diastole headroom
      return 1.0;
    }
    default: { return 1.0; }
  }
}

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

// Canonical integer hash = [0, 1)
fn hashU32(n: u32) -> f32 {
  var x = n;
  x = x ^ (x >> 16u);
  x = x * 0x45d9f3bu;
  x = x ^ (x >> 16u);
  return f32(x & 0xFFFFu) / 65535.0;
}

// Time-seeded variant for animation patterns
fn hashAnimated(n: u32, seed: f32) -> f32 {
  return fract(sin(f32(n) * 12.9898 + seed * 78.233) * 43758.5453);
}

// Transform satellite position to a Camera-facing coordinate system
fn to_earth_facing_coords(sat_pos: vec3f) -> vec3f {
  // Fix: Use the camera position as the global reference axis, not the local sat_pos!
  let center_dir = normalize(uni.camera_pos.xyz);
  let up = vec3f(0.0, 0.0, 1.0);
  let right = normalize(cross(up, center_dir));
  let true_up = cross(center_dir, right);

  // Project satellite onto the 2D plane facing the camera
  let local_x = dot(sat_pos, right);
  let local_y = dot(sat_pos, true_up);
  let local_z = dot(sat_pos, center_dir);

  return vec3f(local_x, local_y, local_z);
}

// Classify satellite for smile pattern
// Returns: 0=background, 1=left_eye, 2=right_eye, 3=smile_curve
fn classify_smile_feature(sat_pos: vec3f, earth_dir: vec3f) -> u32 {
  let local = to_earth_facing_coords(sat_pos);

  // Fix: Only render the smile on the hemisphere facing the camera
  if (local.z < 1000.0) { return 0u; }

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
fn smile_pattern(sat_idx: u32, sat_pos: vec3f, time: f32, earth_dir: vec3f) -> PatternSample {
  let cycle_time = f32(4) * SMILE_PHASE_DURATION;
  let phase = i32(time % cycle_time / SMILE_PHASE_DURATION);
  let t = fract(time % cycle_time / SMILE_PHASE_DURATION);

  let feature = classify_smile_feature(sat_pos, earth_dir);

  let eye_color = vec3f(1.0, 0.82, 0.35);
  let smile_color = vec3f(1.0, 0.88, 0.15);
  let bg_color = sat_color(sat_idx) * 0.18;

  if (feature == 0u) {
    var bg_strength = 0.35;
    let isGodView = (uni.view_mode & 0xFFFFu) == 1u;
    if (isGodView) { bg_strength *= 0.82; }
    switch phase {
      case SMILE_PHASE_EMERGE: { bg_strength = mix(0.55, 0.35, t); }
      case SMILE_PHASE_GLOW: { bg_strength = 0.32; }
      case SMILE_PHASE_TWINKLE: { bg_strength = 0.32 + 0.08 * sin(t * 10.0); }
      case SMILE_PHASE_FADE: { bg_strength = mix(0.35, 0.55, t); }
      default: {}
    }
    return PatternSample(bg_color, bg_strength, PATTERN_TIER_BG, 0.0);
  }

  var col: vec3f;
  var strength: f32 = 1.0;
  var tier = PATTERN_TIER_FEATURE;
  var feat = 2.0;

  if (feature == 1u || feature == 2u) {
    col = eye_color;
    tier = PATTERN_TIER_HERO;
    let blink_period = select(3.0, 3.2, feature == 2u);
    let blink = smoothstep(0.0, 0.1, abs(sin(time * 3.14159 / blink_period)));
    strength = 0.85 + 0.15 * blink;
  } else {
    col = smile_color;
    tier = PATTERN_TIER_FEATURE;
    feat = 1.0;
    let wave = sin(to_earth_facing_coords(sat_pos).x * 0.01 + time * 2.0);
    col *= 0.88 + 0.12 * wave;
    strength = 0.92;
  }

  switch phase {
    case SMILE_PHASE_EMERGE: {
      let fade = smoothstep(0.0, 0.35, t);
      col *= fade;
      strength *= fade;
    }
    case SMILE_PHASE_GLOW: {
      let pulse = 0.92 + 0.08 * sin(t * 3.14159);
      col *= pulse;
      strength *= pulse;
    }
    case SMILE_PHASE_TWINKLE: {
      let sparkle = hashAnimated(sat_idx, time * 10.0);
      let tw = 0.78 + 0.44 * sparkle;
      col *= tw;
      strength *= tw;
    }
    case SMILE_PHASE_FADE: {
      let dissolve = 1.0 - smoothstep(0.65, 1.0, t);
      col *= dissolve;
      strength *= dissolve;
    }
    default: {}
  }

  return PatternSample(col, strength, tier, feat);
}

// Digital Rain pattern (Matrix-style)
fn digital_rain_pattern(sat_idx: u32, sat_pos: vec3f, time: f32) -> PatternSample {
  let local = to_earth_facing_coords(sat_pos);

  // Hide rain on the back face of the constellation
  if (local.z < 0.0) {
    return PatternSample(vec3f(0.0), 0.0, PATTERN_TIER_BG, 0.0);
  }

  let column = floor(local.x / 100.0);
  let drop_speed = 1.0 + fract(f32(column) * 0.37) * 2.0;
  let drop_pos = fract(time * drop_speed + f32(column) * 0.1);

  let normalized_height = 1.0 - ((local.y + 6921.0) / 13842.0);
  var dist_to_drop = normalized_height - drop_pos;
  if (dist_to_drop < 0.0) { dist_to_drop += 1.0; }

  let head = 1.0 - smoothstep(0.0, 0.035, dist_to_drop);
  let trail = (1.0 - smoothstep(0.0, 0.42, dist_to_drop)) * 0.55;

  let is_head = head > 0.35;
  let strength = max(head, trail);
  if (strength < 0.04) {
    let bg = sat_color(sat_idx) * 0.14;
    return PatternSample(bg, 0.28, PATTERN_TIER_BG, 0.0);
  }

  let green = 0.55 + 0.45 * hashU32(sat_idx);
  let col = vec3f(0.05, green, 0.12);
  let tier = select(PATTERN_TIER_TRAIL, PATTERN_TIER_FEATURE, is_head);
  let feat = select(1.0, 2.0, is_head);
  return PatternSample(col, strength, tier, feat);
}

// Heartbeat pattern
fn heartbeat_pattern(sat_idx: u32, sat_pos: vec3f, time: f32) -> PatternSample {
  let local = to_earth_facing_coords(sat_pos);

  let beat = time % 0.8;
  let first_beat = smoothstep(0.0, 0.1, beat) * (1.0 - smoothstep(0.1, 0.2, beat));
  let second_beat = smoothstep(0.3, 0.35, beat) * (1.0 - smoothstep(0.35, 0.45, beat));
  let pulse = max(first_beat, second_beat * 0.6);

  let dist_from_center = length(local.xy);
  let wave_delay = dist_from_center * 0.0001;
  let wave_pulse = smoothstep(0.0, 0.1, fract((time - wave_delay) * 1.25)) * 0.45;

  let total_pulse = max(pulse, wave_pulse);
  // Lift diastole floor when contrast < 1 (Fleet/God profiles).
  let diastole_floor = mix(0.0, 0.07, 1.0 - satVisual.animation_contrast);
  total_pulse = max(total_pulse, diastole_floor);
  let pinkness = 0.35 + 0.45 * total_pulse;
  let col = vec3f(1.0, pinkness, pinkness);

  if (total_pulse < 0.08) {
    let bg = sat_color(sat_idx) * 0.16;
    return PatternSample(bg, 0.30, PATTERN_TIER_BG, 0.0);
  }

  let tier = mix(PATTERN_TIER_GLOW, PATTERN_TIER_FEATURE, smoothstep(0.15, 0.75, total_pulse));
  let feat = select(1.0, 2.0, total_pulse > 0.55);
  return PatternSample(col, total_pulse, tier, feat);
}

// ====== = LOGO PATTERN ====================================================================================================================================================================================

const ORBIT_RADIUS_KM: f32 = 6921.0;  // LEO orbit radius (Earth radius + 550 km altitude)
const INV_SQRT2: f32 = 0.70710678;    // 1 / sqrt(2), used for 45deg diagonal distances

fn x_logo_pattern(sat_idx: u32, sat_pos: vec3f, time: f32, start_time: f32) -> PatternSample {
  let local = to_earth_facing_coords(sat_pos);

  let bg_strength = 0.32;
  let bg_mod = 0.032 + 0.012 * hashU32(sat_idx ^ (u32(time * 4.0) & 255u));
  let bg_col = sat_color(sat_idx) * bg_mod;

  if (local.z < 1000.0) {
    return PatternSample(bg_col, bg_strength, PATTERN_TIER_BG, 0.0);
  }

  let px = local.x / ORBIT_RADIUS_KM;
  let py = local.y / ORBIT_RADIUS_KM;

  let LOGO_HALF: f32 = 0.48;
  let STROKE_HALF: f32 = 0.068;
  let GLOW_HALF: f32  = 0.11;

  let in_box = abs(px) < LOGO_HALF && abs(py) < LOGO_HALF;
  let d1 = abs(py - px) * INV_SQRT2;
  let d2 = abs(py + px) * INV_SQRT2;
  let nearest = min(d1, d2);

  let on_logo  = in_box && nearest < STROKE_HALF;
  let on_glow  = in_box && !on_logo && nearest < GLOW_HALF;

  let elapsed = time - start_time;
  let reveal  = smoothstep(0.0, 2.8, elapsed);

  if (on_logo) {
    let wave = 0.5 + 0.5 * sin(time * 2.6 + f32(sat_idx % 128u) * 0.049);
    let pulse = mix(0.88, 1.0, wave);
    let edge_frac = nearest / STROKE_HALF;
    let base_col = mix(vec3f(0.0, 0.95, 1.0), vec3f(0.05, 0.55, 1.0), edge_frac);
    return PatternSample(base_col, pulse * reveal, PATTERN_TIER_HERO, 2.0);

  } else if (on_glow) {
    let glow_frac = (nearest - STROKE_HALF) / (GLOW_HALF - STROKE_HALF);
    let glow_amt = (1.0 - glow_frac) * 0.42 * reveal;
    let glow_col = vec3f(0.0, 0.62, 1.0);
    return PatternSample(glow_col, glow_amt, PATTERN_TIER_GLOW, 1.0);

  } else {
    return PatternSample(bg_col, bg_strength, PATTERN_TIER_BG, 0.0);
  }
}

@vertex
fn satellite_vs(
  @builtin(vertex_index)   vi : u32,
  satIdx : u32,
) -> VOut {
  let pd = sat_pos[satIdx];
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

  // Shell detection from satellite index (~1M satellites / 3 shells = 349525 per shell)
  let shellIdx = satIdx / 349525u;
  let shellSize = shellSizeScale(shellIdx);

  let gid = group_ids[satIdx];
  let gp = groups[gid];
  let multiGroup = groups[0].pad.x > 0.5;

  let groundScale = select(1.0, 0.72, ((uni.view_mode >> 16u) & 1u) == 1u);
  // Moon view (mode 4) sits at 384,400 km — scale billboards up and lift the 150k km cutoff
  // so the constellation appears as a visible glowing ring around Earth.
  let isMoonView = (uni.view_mode & 0xFFFFu) == 4u;
  let moonBillboardScale = select(1.0, 750.0, isMoonView);
  let maxVisibleDist = max(satVisual.distance_cull_km, 1000.0);
  var bsize = clamp(1200.0 / max(dist, 50.0), 0.4, 60.0) * moonBillboardScale *
              select(0.0, 1.0, dist < maxVisibleDist) * shellSize * groundScale;
  if (gp.visible < 0.5) {
    bsize = 0.0;
  } else {
    bsize = bsize * gp.sizeScale;
  }
  let offset = (qv.x * right + qv.y * up) * bsize;
  let curClip = uni.view_proj * vec4f(wp, 1.0);
  let prevClip = motion.prev_view_proj * vec4f(wp, 1.0);
  let curNdc = curClip.xy / max(curClip.w, 1e-5);
  let prevNdc = prevClip.xy / max(prevClip.w, 1e-5);

  // Approximate orbital tangent when true per-satellite velocity is unavailable.
  var axis = vec3f(0.0, 0.0, 1.0);
  if (abs(dot(normalize(wp), axis)) > 0.96) {
    axis = vec3f(0.0, 1.0, 0.0);
  }
  let isFleetViewVs = (uni.view_mode & 0xFFFFu) == 2u;
  var tangent = normalize(cross(axis, normalize(wp)));
  if (isFleetViewVs && length(motion.host_velocity) > 1e-5) {
    tangent = normalize(motion.host_velocity);
  }
  let simDt = motion.delta_time * max(uni.time_scale, 0.0);
  let futurePos = wp + tangent * (7.6 * max(simDt, 0.0));
  let futureClip = uni.view_proj * vec4f(futurePos, 1.0);
  let futureNdc = futureClip.xy / max(futureClip.w, 1e-5);

  let cameraMotion = curNdc - prevNdc;
  let orbitalMotion = futureNdc - curNdc;
  let screenMotion = cameraMotion + orbitalMotion;
  let motionLen = length(screenMotion);
  let motionDir2 = select(vec2f(0.0, 0.0), screenMotion / motionLen, motionLen > 1e-5);
  let trailingMask = clamp(dot(-qv, motionDir2), 0.0, 1.0);
  let stretchScale = select(1.0, clamp(sqrt(uni.time_scale), 1.0, 10.0), isFleetViewVs);
  let stretch = clamp(motionLen * 380.0 * motion.satellite_stretch * stretchScale, 0.0, 2.4) * trailingMask;
  let stretchWorld = (motionDir2.x * right + motionDir2.y * up) * bsize * stretch;

  let fpos = wp + offset + stretchWorld;

  let baseColor = sat_color(u32(abs(cdat)) % 7u);
  var shellTint = shellColorShift(shellIdx);
  let isGodViewVs = (uni.view_mode & 0xFFFFu) == 1u;
  let camDist = length(uni.camera_pos.xyz);
  let zoomOut = smoothstep(12000.0, 45000.0, camDist);
  if (isGodViewVs && shellIdx == 0u) {
    shellTint *= mix(vec3f(1.0), vec3f(1.14, 1.06, 0.92), zoomOut);
  }
  var col = baseColor * shellTint;
  if (multiGroup) {
    col = gp.baseColor * gp.brightness;
  }
  let isHighlighted = select(0.0, 1.0, satIdx == params.selected_satellite);
  if (isHighlighted > 0.0) {
    col = mix(col, vec3f(1.0, 0.92, 0.6), 0.75);
  }

  let phase = cdat * 0.15 + uni.time * 0.8;
  let pattern = 0.35 + 0.65 * (0.5 + 0.5 * sin(phase));
  // From the Moon (~384k km), atten would be ~0.003; boost it so the constellation glows visibly.
  let moonAttenBoost = select(1.0, 250.0, isMoonView);
  let atten = 1.0 / (1.0 + dist * 0.00075) * moonAttenBoost;
  let selectionBoost = 1.0 + isHighlighted * 1.5;

  // Solar panel glint simulation
  let glintHash = hashU32(satIdx);
  let glintPhase = fract(uni.time * 0.1 + glintHash * 10.0);
  let glintAlignment = 1.0 - abs(glintPhase - 0.5) * 2.0;
  let glint = pow(glintAlignment, 8.0) * 0.8;

  var out: VOut;
  out.cp = uni.view_proj * vec4f(fpos, 1.0);
  out.uv = (qv + 1.0) * 0.5;

  if (params.pattern_mode > 0u) {
    let earth_dir = normalize(-wp);
    var sample: PatternSample;
    switch params.pattern_mode {
      case PATTERN_X_LOGO: {
        sample = x_logo_pattern(satIdx, wp, uni.time, params.animation_time);
      }
      case PATTERN_SMILE: {
        sample = smile_pattern(satIdx, wp, uni.time, earth_dir);
      }
      case PATTERN_DIGITAL_RAIN: {
        sample = digital_rain_pattern(satIdx, wp, uni.time);
      }
      case PATTERN_HEARTBEAT: {
        sample = heartbeat_pattern(satIdx, wp, uni.time);
      }
      default: {
        sample = PatternSample(col, 1.0, PATTERN_TIER_BG, 0.0);
      }
    }
    out.color = sample.rgb;
    out.bright = patternVertexBright(sample, atten, selectionBoost, params.pattern_mode);
    out.pattern_feature = sample.feature;
  } else {
    out.color = col;
    out.bright = (pattern * atten + glint * atten) * selectionBoost;
    out.pattern_feature = 0.0;
  }

  let trailFade = 1.0 - clamp(trailingMask * motionLen * 90.0, 0.0, 0.5);
  out.bright *= trailFade;

  out.shell = f32(shellIdx);
  out.highlight = isHighlighted;
  out.world_dist = dist;
  return out;
}

@vertex
fn vs(
  @builtin(vertex_index)   vi : u32,
  @builtin(instance_index) ii : u32,
) -> VOut {
  return satellite_vs(vi, ii);
}

// ── Distance LOD kernels (near / mid / far) ───────────────────────────────────
const LOD_NEAR_KM: f32 = 5000.0;
const LOD_MID_KM: f32 = 25000.0;
const LOD_NEAR_BLEND_KM: f32 = 1000.0;
const LOD_MID_BLEND_KM: f32 = 3000.0;
// God View cinematography bands — sharper near, softer far (#GodView)
const GOD_LOD_NEAR_KM: f32 = 15000.0;
const GOD_LOD_MID_KM: f32 = 40000.0;
const GOD_LOD_NEAR_BLEND_KM: f32 = 2500.0;
const GOD_LOD_MID_BLEND_KM: f32 = 4000.0;
const FLEET_LOD_NEAR_KM: f32 = 50.0;
const MOON_BILLBOARD_SCALE: f32 = 750.0;

fn lodTierWeights(lodDist: f32, nearKm: f32, midKm: f32, nearBlend: f32, midBlend: f32) -> vec3f {
  let nearToMid = smoothstep(nearKm - nearBlend, nearKm + nearBlend, lodDist);
  let midToFar = smoothstep(midKm - midBlend, midKm + midBlend, lodDist);
  let nearW = 1.0 - nearToMid;
  let farW = midToFar;
  let midW = max(0.0, nearToMid - farW);
  return vec3f(nearW, midW, farW);
}

struct LodKernel {
  core_outer: f32,
  core_inner: f32,
  halo_outer: f32,
  halo_inner: f32,
  halo_strength: f32,
  core_boost: f32,
}

fn resolveLodKernel(lodDist: f32, isGodView: bool, isFleetView: bool) -> LodKernel {
  var w: vec3f;
  if (isGodView) {
    w = lodTierWeights(lodDist, GOD_LOD_NEAR_KM, GOD_LOD_MID_KM, GOD_LOD_NEAR_BLEND_KM, GOD_LOD_MID_BLEND_KM);
  } else {
    w = lodTierWeights(lodDist, LOD_NEAR_KM, LOD_MID_KM, LOD_NEAR_BLEND_KM, LOD_MID_BLEND_KM);
  }

  let n_outer = satVisual.core_outer;
  let n_inner = satVisual.core_inner;
  let n_halo_o = satVisual.halo_outer;
  let n_halo_i = satVisual.halo_inner;
  let n_halo_s = satVisual.halo_strength;
  let n_boost = satVisual.core_boost;

  let m_outer = satVisual.core_outer * 0.78;
  let m_inner = satVisual.core_inner * 0.65;
  let m_halo_o = satVisual.halo_outer * 0.88;
  let m_halo_i = satVisual.halo_inner * 0.88;
  let m_halo_s = satVisual.halo_strength * 0.5;
  let m_boost = satVisual.core_boost * 0.9;

  let f_outer = 0.32;
  let f_inner = 0.08;
  let f_halo_o = 0.38;
  let f_halo_i = 0.20;
  let f_halo_s = 0.0;
  let f_boost = satVisual.core_boost * 0.55;

  var k: LodKernel;
  k.core_outer = w.x * n_outer + w.y * m_outer + w.z * f_outer;
  k.core_inner = w.x * n_inner + w.y * m_inner + w.z * f_inner;
  k.halo_outer = w.x * n_halo_o + w.y * m_halo_o + w.z * f_halo_o;
  k.halo_inner = w.x * n_halo_i + w.y * m_halo_i + w.z * f_halo_i;
  k.halo_strength = w.x * n_halo_s + w.y * m_halo_s + w.z * f_halo_s;
  k.core_boost = w.x * n_boost + w.y * m_boost + w.z * f_boost;

  if (isFleetView) {
    let nearFleet = 1.0 - smoothstep(FLEET_LOD_NEAR_KM * 0.35, FLEET_LOD_NEAR_KM, lodDist);
    k.core_outer = mix(k.core_outer, k.core_outer * 0.82, nearFleet);
    k.core_inner = mix(k.core_inner, k.core_inner * 0.82, nearFleet);
  }

  return k;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let uvDist = distance(in.uv, vec2f(0.5));

  let isMoonView = (uni.view_mode & 0xFFFFu) == 4u;
  var lodDist = in.world_dist / select(1.0, MOON_BILLBOARD_SCALE, isMoonView);
  lodDist = min(lodDist, select(lodDist, LOD_NEAR_KM * 0.35, in.highlight > 0.5));

  let isGodView = (uni.view_mode & 0xFFFFu) == 1u;
  let isFleetView = (uni.view_mode & 0xFFFFu) == 2u;
  let k = resolveLodKernel(lodDist, isGodView, isFleetView);

  // Pattern-specific kernel tweaks (only when an animation pattern is active).
  var core_outer = k.core_outer;
  var core_inner = k.core_inner;
  var pat_boost = k.core_boost;
  if (params.pattern_mode > 0u) {
    if (in.pattern_feature > 1.5) {
      core_outer = min(k.core_outer * 1.06, 0.50);
      core_inner = min(k.core_inner * 1.04, 0.32);
    } else if (in.pattern_feature < 0.5) {
      pat_boost = k.core_boost * 0.48;
    } else {
      pat_boost = k.core_boost * 0.72;
    }
  }

  let core = smoothstep(core_outer, core_inner, uvDist);
  let halo = smoothstep(k.halo_outer, k.halo_inner, uvDist) * k.halo_strength;

  let alpha = (core + halo) * in.bright;

  if (isFleetView) {
    let nearFleet = 1.0 - smoothstep(FLEET_LOD_NEAR_KM * 0.35, FLEET_LOD_NEAR_KM, lodDist);
    pat_boost = pat_boost * (1.0 + 0.4 * nearFleet);
  }

  let alphaCutoff = select(0.02, 0.03, lodDist > LOD_MID_KM);
  if (alpha < alphaCutoff) {
    discard;
  }

  let intensity_boost = 1.0 + (core * pat_boost);
  let final_color = in.color * intensity_boost * in.bright;

  return vec4f(final_color, alpha);
}
`;

export const SATELLITE_CULLED_SHADER = SATELLITE_SHADER.replace(
  'struct VOut {',
  `@group(0) @binding(6) var<storage, read> visible_indices : array<u32>;

struct VOut {`,
).replace(
  `@vertex
fn vs(
  @builtin(vertex_index)   vi : u32,
  @builtin(instance_index) ii : u32,
) -> VOut {
  return satellite_vs(vi, ii);
}`,
  `@vertex
fn vs_culled(
  @builtin(vertex_index)   vi : u32,
  @builtin(instance_index) ii : u32,
) -> VOut {
  return satellite_vs(vi, visible_indices[ii]);
}`,
);
