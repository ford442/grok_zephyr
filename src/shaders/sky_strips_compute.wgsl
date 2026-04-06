/**
 * Sky Strips Compute Shader - Per-Satellite LED Pattern Modulation
 * 
 * Transforms satellites into addressable pixels in a massive orbital LED array.
 * Each satellite gets individual brightness modulation based on pattern type.
 * 
 * Pattern Types:
 *   0 = PULSE    - Sinusoidal brightness pulse
 *   1 = CHASE    - Moving chase light with trail
 *   2 = WAVE     - Sine wave propagation across indices
 *   3 = BEAT_SYNC- Audio-reactive pulse (controlled by uniform)
 *   4 = MORSE    - Binary on/off for text transmission
 *   5 = SPARKLE  - Random twinkle effect
 * 
 * Buffer Layout:
 *   - pattern_data: vec4f per satellite [brightness_mod, pattern_id, phase_offset, speed_mult]
 *   - sat_colors: RGBA8 output buffer (existing)
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const NUM_SAT: u32 = 1048576u;           // 2^20 satellites
const PI: f32 = 3.14159265359;
const TAU: f32 = 6.28318530718;

// Pattern type constants
const PATTERN_PULSE: u32 = 0u;
const PATTERN_CHASE: u32 = 1u;
const PATTERN_WAVE: u32 = 2u;
const PATTERN_BEAT_SYNC: u32 = 3u;
const PATTERN_MORSE: u32 = 4u;
const PATTERN_SPARKLE: u32 = 5u;

// Base color palette (shell-based, matching existing)
const SHELL_COLORS: array<vec3f, 3> = array<vec3f, 3>(
  vec3f(0.2, 0.5, 1.0),   // Shell 0: Blue (340km)
  vec3f(1.0, 1.0, 1.0),   // Shell 1: White (550km)
  vec3f(1.0, 0.8, 0.2)    // Shell 2: Gold (1150km)
);

// ============================================================================
// UNIFORM STRUCT (matches CPU layout)
// ============================================================================

struct SkyStripUniforms {
  time: f32,                    // Global simulation time
  beat_intensity: f32,          // Audio-reactive intensity (0-1)
  beat_pulse: f32,              // Instant beat pulse (0-1)
  bpm: f32,                     // Beats per minute for sync
  
  global_brightness: f32,       // Master brightness multiplier
  pattern_blend: f32,           // Blend factor between patterns
  morse_speed: f32,             // Morse code WPM
  sparkle_density: f32,         // Sparkle probability
  
  // 16-byte padding to 32 bytes total
  reserved: vec4f,
};

@group(0) @binding(0) var<uniform> sky_uniforms: SkyStripUniforms;

// ============================================================================
// STORAGE BUFFERS
// ============================================================================

/**
 * Pattern data per satellite (16 bytes each)
 * Layout: vec4f per satellite
 *   x: brightness_modulator (0-1, base brightness multiplier)
 *   y: pattern_id (u32 encoded as f32)
 *   z: phase_offset (radians, for pattern synchronization)
 *   w: speed_multiplier (pattern speed factor, 0.5 = half speed)
 */
@group(0) @binding(1) var<storage, read> pattern_data: array<vec4f>;

/**
 * Satellite positions (read-only, for distance/visibility calc)
 * xyz: position in km, w: packed visibility data
 */
@group(0) @binding(2) var<storage, read> sat_positions: array<vec4f>;

/**
 * Orbital elements (read-only, for shell determination)
 * w component contains shell index
 */
@group(0) @binding(3) var<storage, read> orb_elements: array<vec4f>;

/**
 * Output colors (RGBA8 packed as u32, matches existing color buffer)
 * Written by this compute shader, read by render shader
 */
@group(0) @binding(4) var<storage, read_write> sat_colors: array<u32>;

// ============================================================================
// RANDOM NUMBER GENERATOR (PCG)
// ============================================================================

fn pcg_hash(seed: u32) -> u32 {
  var state = seed * 747796405u + 2891336453u;
  var word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn random_f01(seed: u32) -> f32 {
  return f32(pcg_hash(seed)) / 4294967295.0;
}

// ============================================================================
// COLOR UTILITIES
// ============================================================================

fn rgb_to_rgba8(color: vec3f, alpha: f32) -> u32 {
  let r = u32(clamp(color.r * 255.0, 0.0, 255.0));
  let g = u32(clamp(color.g * 255.0, 0.0, 255.0));
  let b = u32(clamp(color.b * 255.0, 0.0, 255.0));
  let a = u32(clamp(alpha * 255.0, 0.0, 255.0));
  return (a << 24u) | (b << 16u) | (g << 8u) | r;
}

fn get_shell_index(cdat: f32) -> u32 {
  return (u32(cdat) >> 8u) & 0xFFu;
}

// ============================================================================
// PATTERN CALCULATIONS
// ============================================================================

/**
 * PULSE pattern: Simple sinusoidal brightness modulation
 * flare = base * (0.3 + 0.7 * sin(time * freq + phase))
 */
fn calculate_pulse(
  time: f32,
  phase: f32,
  speed: f32,
  beat_intensity: f32
) -> f32 {
  let freq = 2.0 * speed;  // Base frequency
  let t = time * freq + phase;
  
  // Basic pulse
  var pulse = 0.3 + 0.7 * (0.5 + 0.5 * sin(t));
  
  // Add beat-reactive boost
  pulse = pulse * (1.0 + beat_intensity * 0.5);
  
  return clamp(pulse, 0.0, 1.0);
}

/**
 * CHASE pattern: Moving light with exponential trail
 * Creates a "comet" effect moving through satellite indices
 */
fn calculate_chase(
  sat_idx: u32,
  time: f32,
  phase: f32,
  speed: f32,
  beat_pulse: f32
) -> f32 {
  // Normalize index to 0-1 range (assuming max 1M satellites)
  let idx_norm = f32(sat_idx) / 1000000.0;
  
  // Moving head position (wraps around)
  let head_pos = fract(time * 0.1 * speed + phase / TAU);
  
  // Distance from head (circular wrapping)
  var dist = abs(idx_norm - head_pos);
  dist = min(dist, 1.0 - dist);
  
  // Trail falloff (sharper with beat pulse)
  let trail_width = 0.05 / (1.0 + beat_pulse);
  let intensity = exp(-dist / trail_width);
  
  // Secondary head (opposite side for continuous loop feel)
  let head2_pos = fract(head_pos + 0.5);
  var dist2 = abs(idx_norm - head2_pos);
  dist2 = min(dist2, 1.0 - dist2);
  let intensity2 = exp(-dist2 / trail_width);
  
  return clamp(max(intensity, intensity2) * 0.3, 0.0, 1.0);
}

/**
 * WAVE pattern: Sine wave propagating across orbital shells
 * Creates ripple effects that follow orbital mechanics
 */
fn calculate_wave(
  sat_idx: u32,
  raan: f32,
  mean_anomaly: f32,
  time: f32,
  phase: f32,
  speed: f32
) -> f32 {
  // Wave propagates around the orbit
  let orbital_phase = mean_anomaly + time * speed * 0.5 + phase;
  
  // Multiple wave frequencies for richness
  let wave1 = sin(orbital_phase);
  let wave2 = sin(orbital_phase * 2.3 + raan);
  let wave3 = sin(orbital_phase * 0.7 - time * 0.3);
  
  // Combine waves
  let combined = (wave1 + wave2 * 0.5 + wave3 * 0.3) / 1.8;
  
  // Map to 0-1 range
  return 0.2 + 0.8 * (0.5 + 0.5 * combined);
}

/**
 * BEAT_SYNC pattern: Audio-reactive pulsing
 * Uses uniform beat_intensity and beat_pulse for synchronization
 */
fn calculate_beat_sync(
  sat_idx: u32,
  time: f32,
  phase: f32,
  beat_intensity: f32,
  beat_pulse: f32
) -> f32 {
  // Per-satellite phase offset creates wave effect across constellation
  let idx_offset = f32(sat_idx % 1000u) * 0.01;
  let t = time * 4.0 + phase + idx_offset;
  
  // Base rhythm
  let base = 0.5 + 0.5 * sin(t);
  
  // Beat pulse adds sharp transient
  let pulse = beat_pulse * exp(-f32(sat_idx % 10u) * 0.1);
  
  // Intensity modulates overall brightness
  let intensity = 0.3 + beat_intensity * 0.7;
  
  return clamp((base + pulse) * intensity, 0.0, 1.0);
}

/**
 * MORSE pattern: Binary on/off for text transmission
 * Simulates satellites blinking in Morse code patterns
 */
fn calculate_morse(
  sat_idx: u32,
  time: f32,
  phase: f32,
  speed: f32
) -> f32 {
  // Dot duration in seconds
  let dot_duration = 1.2 / speed;
  
  // Group satellites into "message groups"
  let group_idx = sat_idx / 100u;
  let in_group_idx = sat_idx % 100u;
  
  // Time within current group cycle
  let group_time = time + phase * dot_duration;
  let cycle_pos = fract(group_time / (dot_duration * 10.0));
  
  // Simple repeating pattern: .--. .--. (morse for "P" twice)
  // Pattern timing: dot=1, dash=3, gap=1, letter_gap=3
  var is_on = false;
  
  // Create pattern based on in-group index
  let pattern_pos = in_group_idx % 20u;
  
  // Pattern: short, long, long, short (simplified P)
  if (pattern_pos < 2u) {
    is_on = fract(cycle_pos * 5.0) < 0.3;  // Dot
  } else if (pattern_pos < 6u) {
    is_on = fract(cycle_pos * 5.0) < 0.7;  // Dash
  } else if (pattern_pos < 10u) {
    is_on = fract(cycle_pos * 5.0) < 0.7;  // Dash
  } else if (pattern_pos < 12u) {
    is_on = fract(cycle_pos * 5.0) < 0.3;  // Dot
  }
  
  return select(0.05, 1.0, is_on);
}

/**
 * SPARKLE pattern: Random twinkle effect
 * Creates star-like twinkling across the constellation
 */
fn calculate_sparkle(
  sat_idx: u32,
  time: f32,
  phase: f32,
  density: f32
) -> f32 {
  // Unique sparkle seed per satellite
  let seed = sat_idx * 12345u + u32(time * 0.5);
  
  // Random sparkle trigger
  let sparkle_rand = random_f01(seed);
  let sparkle_on = sparkle_rand < density;
  
  // Sparkle decay
  let decay_time = fract(time * 2.0 + phase / TAU);
  let decay = exp(-decay_time * 3.0);
  
  // Base brightness with occasional sparkle
  let base = 0.2 + random_f01(seed * 2u) * 0.3;
  let sparkle = select(0.0, decay, sparkle_on);
  
  return clamp(base + sparkle * 0.8, 0.0, 1.0);
}

// ============================================================================
// MAIN COMPUTE SHADER
// ============================================================================

@compute @workgroup_size(256, 1, 1)
fn updateSkyStrips(@builtin(global_invocation_id) id: vec3u) {
  let idx = id.x;
  if (idx >= NUM_SAT) { return; }
  
  // Load pattern data for this satellite
  let pdata = pattern_data[idx];
  let brightness_mod = pdata.x;
  let pattern_id = u32(pdata.y);
  let phase = pdata.z;
  let speed = pdata.w;
  
  // Load orbital data for shell color
  let oelem = orb_elements[idx];
  let shell_idx = get_shell_index(oelem.w) % 3u;
  let base_color = SHELL_COLORS[shell_idx];
  
  // Load position for visibility/distance effects
  let spos = sat_positions[idx];
  let visibility = fract(spos.w);
  
  // Skip if not visible
  if (visibility < 0.01) {
    sat_colors[idx] = rgb_to_rgba8(base_color * 0.1, 0.2);
    return;
  }
  
  // Calculate pattern brightness
  var pattern_brightness: f32 = 0.5;  // Default
  let t = sky_uniforms.time;
  
  switch (pattern_id) {
    case PATTERN_PULSE: {
      pattern_brightness = calculate_pulse(t, phase, speed, sky_uniforms.beat_intensity);
    }
    case PATTERN_CHASE: {
      pattern_brightness = calculate_chase(idx, t, phase, speed, sky_uniforms.beat_pulse);
    }
    case PATTERN_WAVE: {
      pattern_brightness = calculate_wave(idx, oelem.x, oelem.z, t, phase, speed);
    }
    case PATTERN_BEAT_SYNC: {
      pattern_brightness = calculate_beat_sync(idx, t, phase, sky_uniforms.beat_intensity, sky_uniforms.beat_pulse);
    }
    case PATTERN_MORSE: {
      pattern_brightness = calculate_morse(idx, t, phase, sky_uniforms.morse_speed * speed);
    }
    case PATTERN_SPARKLE: {
      pattern_brightness = calculate_sparkle(idx, t, phase, sky_uniforms.sparkle_density);
    }
    default: {
      pattern_brightness = 0.5;
    }
  }
  
  // Apply brightness modulator from pattern data
  let final_brightness = pattern_brightness * brightness_mod * sky_uniforms.global_brightness;
  
  // Distance fade (dim distant satellites)
  let dist_fade = clamp(visibility * 2.0, 0.3, 1.0);
  
  // Final color with HDR boost for bloom
  let hdr_boost = 1.0 + sky_uniforms.beat_pulse * 2.0;
  let final_color = base_color * final_brightness * dist_fade * hdr_boost;
  let final_alpha = final_brightness * dist_fade;
  
  // Pack and store
  sat_colors[idx] = rgb_to_rgba8(final_color, final_alpha);
}

// ============================================================================
// PATTERN INITIALIZATION KERNEL
// ============================================================================

/**
 * Initialize pattern data with default values
 * Run once at startup or when resetting patterns
 */
@compute @workgroup_size(256, 1, 1)
fn initializePatterns(@builtin(global_invocation_id) id: vec3u) {
  let idx = id.x;
  if (idx >= NUM_SAT) { return; }
  
  // Default: all satellites pulse slowly with slight phase variation
  let phase = f32(idx % 1000u) * 0.01;  // Distributed phase
  let seed = idx * 12345u;
  
  // Varied pattern assignment based on orbital position
  let pattern_id = (idx / 10000u) % 4u;  // Groups of 10k get same pattern
  let speed = 0.8 + random_f01(seed) * 0.4;  // 0.8-1.2x speed variation
  let brightness = 0.7 + random_f01(seed * 2u) * 0.3;
  
  pattern_data[idx] = vec4f(brightness, f32(pattern_id), phase, speed);
  
  // Initialize colors to shell defaults
  let oelem = orb_elements[idx];
  let shell_idx = get_shell_index(oelem.w) % 3u;
  sat_colors[idx] = rgb_to_rgba8(SHELL_COLORS[shell_idx] * 0.5, 0.5);
}
