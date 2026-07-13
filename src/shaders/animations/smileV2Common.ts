export const SMILE_V2_COMMON = /* wgsl */ `// =================================================================================
// CONSTANTS & CONFIGURATION
// =================================================================================

// Total satellite count (2^20 = 1,048,576)
const NUM_SATELLITES: u32 = 1048576u;

// Earth radius in km (for gnomonic projection calculations)
const EARTH_RADIUS_KM: f32 = 6371.0;

// Feature IDs encoded in output alpha channel
const FEATURE_NONE: u32 = 0u;           // Not part of smile
const FEATURE_LEFT_EYE: u32 = 1u;       // Left eye (-0.3, 0.2) in UV
const FEATURE_RIGHT_EYE: u32 = 2u;      // Right eye (0.3, 0.2) in UV
const FEATURE_SMILE_CURVE: u32 = 3u;    // Parabolic smile arc
const FEATURE_MORPH_TARGET: u32 = 4u;   // X logo or "GROK" text (phase 5)

// Face geometry in normalized UV space (gnomonic projection coordinates)
// UV range: [-1, 1] covers the projected face area
const FACE_UV_RADIUS: f32 = 1.0;        // Radius of face in UV space

// Eye positions (normalized UV coordinates)
const LEFT_EYE_CENTER: vec2f = vec2f(-0.3, 0.2);
const RIGHT_EYE_CENTER: vec2f = vec2f(0.3, 0.2);
const EYE_RADIUS_UV: f32 = 0.15;        // Eye circle radius in UV

// Smile curve: y = 0.1 + 0.3*x^2, x in [-0.4, 0.4]
const SMILE_CURVE_A: f32 = 0.3;         // Parabola coefficient
const SMILE_CURVE_Y0: f32 = 0.1;        // Base Y offset
const SMILE_X_MIN: f32 = -0.4;          // Left extent
const SMILE_X_MAX: f32 = 0.4;           // Right extent
const SMILE_THICKNESS_UV: f32 = 0.08;   // Line thickness in UV

// Morph target region (center area for X logo / text)
const MORPH_REGION_RADIUS: f32 = 0.25;  // Central region for phase 5

// Earth-facing threshold
// dot(normalize(sat_pos), -earth_dir) > FACING_THRESHOLD
const FACING_THRESHOLD: f32 = 0.7;      // ~45 degrees from nadir

// Animation timing (48-second total cycle)
const CYCLE_DURATION_SECONDS: f32 = 48.0;

// Phase durations (in seconds)
const PHASE_0_IDLE: f32 = 4.0;          // Subtle breathing, no smile
const PHASE_1_EMERGE: f32 = 6.0;        // Smile fades in
const PHASE_2_BLINK: f32 = 8.0;         // Eyes blink in sequence
const PHASE_3_TWINKLE: f32 = 10.0;      // Sparkle wave on smile
const PHASE_4_GLOW: f32 = 8.0;          // Full brightness pulse
const PHASE_5_MORPH: f32 = 8.0;         // Transform to X/GROK logo
const PHASE_6_FADE: f32 = 4.0;          // Fade back to idle

// Phase transition thresholds (cumulative time in seconds)
const PHASE_1_START: f32 = 4.0;         // End of idle
const PHASE_2_START: f32 = 10.0;        // End of emerge (4+6)
const PHASE_3_START: f32 = 18.0;        // End of blink (10+8)
const PHASE_4_START: f32 = 28.0;        // End of twinkle (18+10)
const PHASE_5_START: f32 = 36.0;        // End of glow (28+8)
const PHASE_6_START: f32 = 44.0;        // End of morph (36+8)

// Color palette (inspired by Alex Grey + Studio Ghibli warmth)
const COLOR_AMBER: vec3f = vec3f(1.0, 0.702, 0.278);       // Warm amber eyes
const COLOR_GOLDEN: vec3f = vec3f(1.0, 0.843, 0.0);        // Golden smile
const COLOR_WARM_WHITE: vec3f = vec3f(1.0, 0.95, 0.85);    // Gentle glow
const COLOR_DEEP_ORANGE: vec3f = vec3f(1.0, 0.5, 0.1);     // Intense phase
const COLOR_CYAN_ACCENT: vec3f = vec3f(0.2, 0.9, 1.0);     // Morph accent
const COLOR_X_LOGO: vec3f = vec3f(0.0, 0.0, 0.0);          // X logo black
const COLOR_GROK_GLOW: vec3f = vec3f(0.8, 0.3, 1.0);       // Purple GROK glow

// Workgroup configuration
const WORKGROUP_SIZE: u32 = 256u;

// =================================================================================
// UNIFORM BUFFER
// =================================================================================

/**
 * Smile v2 Animation Parameters
 * 
 * These uniforms control the animation state and interruptibility.
 * The CPU updates these each frame based on the global animation timeline.
 */
struct SmileV2Params {
  // Animation timing
  cycle_time: f32,          // Current time within the 48-second cycle [0, 48]
  global_time: f32,         // Absolute time for continuous effects
  speed_multiplier: f32,    // Animation speed multiplier (1.0 = normal)
  _pad0: f32,               // Padding for alignment
  
  // Interruptibility
  transition_alpha: f32,    // 0-1: 1=full pattern, 0=off/chaos
  target_mode: f32,         // 0=normal smile, 1=chaos/idle mode
  transition_duration: f32, // Seconds for cross-fade (typically 2.0)
  _pad1: f32,               // Padding for alignment
  
  // Gnomonic projection reference frame
  // These define the tangent plane for Earth-surface projection
  ref_nadir: vec3f,         // Center point on Earth surface (unit vector * R_earth)
  ref_east: vec3f,          // Unit vector pointing east at ref_nadir
  ref_north: vec3f,         // Unit vector pointing north at ref_nadir
  
  // Morph target selection
  morph_mode: u32,          // 0=X logo, 1="GROK" text
  _pad2: vec3f,             // Padding to 64-byte alignment
};

@group(0) @binding(0) var<uniform> params: SmileV2Params;

// =================================================================================
// STORAGE BUFFERS
// =================================================================================

/**
 * Satellite positions buffer (read-only)
 * Layout: vec4f per satellite
 *   xyz: Position in ECI coordinates (km)
 *   w:   Shell/plane index data (for base color)
 */
@group(0) @binding(1) var<storage, read> sat_positions: array<vec4f>;

/**
 * Output color buffer (read-write)
 * Layout: vec4f per satellite
 *   rgb: Output color for this satellite
 *   a:   Feature ID (0-4) encoded as normalized value
 * 
 * Feature ID encoding: 
 *   0.0 = none, 0.25 = left eye, 0.5 = right eye, 
 *   0.75 = smile, 1.0 = morph
 */
@group(0) @binding(2) var<storage, read_write> sat_output: array<vec4f>;

/**
 * Feature assignment buffer (optional, for caching)
 * Stores precomputed feature IDs to avoid recalculation
 */
@group(0) @binding(3) var<storage, read_write> feature_cache: array<u32>;
`;
