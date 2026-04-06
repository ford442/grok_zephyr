/**
 * "Smile from the Moon v2" WGSL Compute Shader
 * 
 * Grok Zephyr Signature Animation
 * Creates a giant animated smiley face visible from Earth-facing satellites.
 * 
 * Features:
 * - Gnomonic projection for accurate Earth-surface mapping
 * - SDF-based feature detection (eyes, smile curve, morph target)
 * - 48-second cycle with 7 distinct phases
 * - Interruptibility with cross-fade to chaos/idle mode
 * - Branch-coherent compute for 1M+ satellites
 * 
 * Output format: vec4f(rgb, feature_id) where feature_id is in alpha
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 * REFERENCE & DESIGN
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Visual Design inspired by:
 * - The classic "Man in the Moon" pareidolia
 * - Alex Grey's visionary art (sacred geometry meets cosmic scale)
 * - Studio Ghibli's warmth in facial expressions
 * 
 * The smile spans approximately 2000km across, visible from 720km altitude
 * and from ground observation points. Satellites form the features by
 * modulating their brightness and color based on their ground-track position.
 */

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

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

// ============================================================================
// UNIFORM BUFFER
// ============================================================================

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

// ============================================================================
// STORAGE BUFFERS
// ============================================================================

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

// ============================================================================
// GNOMONIC PROJECTION
// ============================================================================

/**
 * GNOMONIC (CENTRAL) PROJECTION
 * 
 * The gnomonic projection maps points from a sphere onto a tangent plane.
 * It's the fundamental geometric operation for this shader - it allows us to
 * determine which ground pixel each satellite "owns" when viewed from the
 * Earth's center (or equivalently, which pattern element the satellite should
 * display when viewed from Earth).
 * 
 * Mathematical Derivation:
 * 
 * Given:
 *   - Satellite position P_sat (ECI coordinates, km from Earth center)
 *   - Reference nadir point P_ref (point on Earth surface, defines tangent plane)
 *   - Reference east/north vectors at P_ref (define tangent plane coordinates)
 * 
 * Step 1: Find sub-satellite point
 *   The sub-satellite point is where the line from Earth center to satellite
 *   intersects the Earth's surface:
 *     P_sub = normalize(P_sat) * R_earth
 * 
 * Step 2: Project onto tangent plane
 *   The tangent plane at P_ref has normal N = normalize(P_ref).
 *   Vector from P_ref to P_sub:
 *     delta = P_sub - P_ref
 *   
 *   Project delta onto tangent plane (remove normal component):
 *     delta_tangent = delta - N * dot(delta, N)
 *   
 *   This gives us the vector in 3D space along the tangent plane.
 * 
 * Step 3: Convert to 2D UV coordinates
 *   Express delta_tangent in east/north basis:
 *     u = dot(delta_tangent, ref_east)   [east-west coordinate, km]
 *     v = dot(delta_tangent, ref_north)  [north-south coordinate, km]
 * 
 *   Normalize to [-1, 1] range based on face radius:
 *     uv = (u, v) / FACE_RADIUS_KM
 * 
 * Properties of Gnomonic Projection:
 * - Preserves straight lines (great circles map to straight lines)
 * - Ideal for image formation from constellation patterns
 * - Singularity at horizon (projection goes to infinity)
 * - Conformal at center, increasing distortion toward edges
 * 
 * Reference: See constellation_optics.wgsl for additional details
 */

/**
 * Project satellite position to normalized UV coordinates on tangent plane.
 * 
 * Returns vec2f(u, v) in normalized [-inf, +inf] range, or vec2f(999.0) 
 * if satellite is not Earth-facing (facing < threshold).
 * 
 * @param sat_pos   Satellite position in ECI coordinates (km)
 * @param earth_dir Direction from satellite to Earth center (normalized)
 * @return UV coordinates in face space, or sentinel if not facing
 */
fn gnomonic_project_satellite(
  sat_pos: vec3f,
  earth_dir: vec3f
) -> vec2f {
  // Check Earth-facing condition
  // dot(normalize(sat_pos), -earth_dir) > FACING_THRESHOLD
  let sat_dir = normalize(sat_pos);
  let facing = dot(sat_dir, -earth_dir);
  
  // Early exit for non-facing satellites
  if (facing < FACING_THRESHOLD) {
    return vec2f(999.0, 999.0);  // Sentinel value
  }
  
  // Step 1: Calculate sub-satellite point on Earth surface
  // P_sub = normalize(sat_pos) * EARTH_RADIUS
  let sat_radius = length(sat_pos);
  let sub_sat = sat_dir * EARTH_RADIUS_KM;
  
  // Step 2: Project onto tangent plane at reference nadir
  // Vector from reference nadir to sub-satellite point
  let delta = sub_sat - params.ref_nadir;
  
  // Reference normal (up direction at tangent point)
  let ref_normal = normalize(params.ref_nadir);
  
  // Remove component along surface normal to project onto tangent plane
  let delta_tangent = delta - ref_normal * dot(delta, ref_normal);
  
  // Step 3: Convert to 2D UV coordinates using east/north basis
  // u = east component, v = north component
  let u = dot(delta_tangent, params.ref_east);
  let v = dot(delta_tangent, params.ref_north);
  
  // Normalize by face radius to get [-1, 1] range
  // Face radius on ground = FACE_UV_RADIUS * projection_scale
  // For 1000km face at 6371km radius, UV range covers ~1000km
  let face_radius_km = 1000.0;  // km on ground
  
  return vec2f(u / face_radius_km, v / face_radius_km);
}

// ============================================================================
// SDF (SIGNED DISTANCE FUNCTION) HELPERS
// ============================================================================

/**
 * Circle SDF
 * Returns signed distance from point p to circle with center c and radius r.
 * Negative = inside, Positive = outside
 */
fn sdf_circle(p: vec2f, c: vec2f, r: f32) -> f32 {
  return length(p - c) - r;
}

/**
 * Parabolic arc SDF
 * 
 * Curve: y = a * x^2 + y0, for x in [xmin, xmax]
 * 
 * Returns approximate signed distance from point p to the curve segment.
 * Uses analytic projection onto parabola for accurate distance.
 */
fn sdf_parabola(p: vec2f, a: f32, y0: f32, xmin: f32, xmax: f32) -> f32 {
  // Find closest point on infinite parabola y = a*x^2 + y0
  // Solve: minimize (x - p.x)^2 + (a*x^2 + y0 - p.y)^2
  // 
  // Taking derivative and setting to 0:
  // 2(x - p.x) + 2(a*x^2 + y0 - p.y) * 2ax = 0
  // (x - p.x) + 2ax(a*x^2 + y0 - p.y) = 0
  // x - p.x + 2a^2*x^3 + 2a*x*(y0 - p.y) = 0
  // 2a^2*x^3 + (1 + 2a*(y0 - p.y))*x - p.x = 0
  // 
  // This is a cubic. For performance, we use Newton iteration or approximation.
  
  // Initial guess: x = clamp(p.x, xmin, xmax)
  var x = clamp(p.x, xmin, xmax);
  
  // Newton iteration to find closest point
  for (var i: i32 = 0; i < 3; i = i + 1) {
    let y = a * x * x + y0;
    let dy_dx = 2.0 * a * x;
    
    // Distance vector from p to curve point
    let dx = x - p.x;
    let dy = y - p.y;
    
    // Derivative of distance squared
    // d/dx[(x-px)^2 + (y-py)^2] = 2(x-px) + 2(y-py)*dy_dx
    let f = dx + dy * dy_dx;
    let fp = 1.0 + dy_dx * dy_dx + dy * 2.0 * a;  // derivative
    
    x = x - f / fp;
    x = clamp(x, xmin, xmax);
  }
  
  // Calculate closest point on curve
  let closest_y = a * x * x + y0;
  let closest = vec2f(x, closest_y);
  
  // Return distance (not signed for open curves)
  return length(p - closest);
}

/**
 * X shape SDF
 * Two crossing diagonal lines forming an X.
 * Used for the X logo morph target in phase 5.
 */
fn sdf_x_shape(p: vec2f, thickness: f32) -> f32 {
  // Line 1: diagonal / (y = x)
  // Distance to line y = x: |y - x| / sqrt(2)
  let d1 = abs(p.y - p.x) / 1.41421356;
  
  // Line 2: diagonal \ (y = -x)
  // Distance to line y = -x: |y + x| / sqrt(2)
  let d2 = abs(p.y + p.x) / 1.41421356;
  
  // Clip to center region for X shape
  let dist_from_center = length(p);
  let center_mask = 1.0 - smoothstep(0.15, 0.25, dist_from_center);
  
  // Return minimum distance to either line, masked
  return min(d1, d2) * center_mask + (dist_from_center - 0.25) * (1.0 - center_mask);
}

/**
 * "GROK" text approximation SDF
 * Simplified letter shapes arranged horizontally.
 * Used as alternative morph target in phase 5.
 */
fn sdf_grok_text(p: vec2f, thickness: f32) -> f32 {
  // Horizontal layout: G-R-O-K
  // Each letter ~0.15 wide, spaced by 0.05
  
  var min_dist: f32 = 999.0;
  
  // Letter positions (centers)
  let letter_width: f32 = 0.15;
  let letter_spacing: f32 = 0.05;
  
  // G at x = -0.35
  let pG = p - vec2f(-0.35, 0.0);
  let distG = length(pG) - 0.08;  // Circle approximation
  // Cutout for G shape
  let distG_cut = pG.x - 0.02;
  let dG = max(distG, -distG_cut);
  min_dist = min(min_dist, dG);
  
  // R at x = -0.15
  let pR = p - vec2f(-0.15, 0.0);
  let distR_stem = abs(pR.x) - 0.02;
  let distR_bowl = length(pR - vec2f(0.0, 0.02)) - 0.06;
  let distR_leg = abs(pR.y - pR.x * 0.8 + 0.02) / 1.28;
  let dR = min(min(distR_stem, distR_bowl), distR_leg);
  min_dist = min(min_dist, dR);
  
  // O at x = 0.05
  let pO = p - vec2f(0.05, 0.0);
  let dO = length(pO) - 0.08;
  min_dist = min(min_dist, dO);
  
  // K at x = 0.25
  let pK = p - vec2f(0.25, 0.0);
  let distK_stem = abs(pK.x + 0.06) - 0.02;
  let distK_diag1 = abs(pK.y - (pK.x - 0.02) * 1.5) / 1.802;
  let distK_diag2 = abs(pK.y + (pK.x - 0.02) * 1.5) / 1.802;
  let dK = min(min(distK_stem, distK_diag1), distK_diag2);
  min_dist = min(min_dist, dK);
  
  return min_dist - thickness * 0.5;
}

// ============================================================================
// FEATURE DETECTION
// ============================================================================

/**
 * Detect which smile feature a satellite belongs to.
 * 
 * Feature mapping:
 *   0 = none (not part of smile)
 *   1 = left eye (SDF circle at (-0.3, 0.2))
 *   2 = right eye (SDF circle at (0.3, 0.2))
 *   3 = smile curve (SDF arc, y = 0.1 + 0.3*x^2, x in [-0.4, 0.4])
 *   4 = morph target (X logo or "GROK" text, active in phase 5)
 * 
 * @param uv Normalized UV coordinates from gnomonic projection
 * @return Feature ID (0-4)
 */
fn get_smile_feature(uv: vec2f) -> u32 {
  // Check sentinel value (non-facing satellite)
  if (uv.x > 100.0) {
    return FEATURE_NONE;
  }
  
  // Check if within overall face bounds
  let dist_from_center = length(uv);
  if (dist_from_center > FACE_UV_RADIUS * 1.1) {
    return FEATURE_NONE;
  }
  
  // Check left eye (priority 1)
  let d_left_eye = sdf_circle(uv, LEFT_EYE_CENTER, EYE_RADIUS_UV);
  if (d_left_eye < 0.0) {
    return FEATURE_LEFT_EYE;
  }
  
  // Check right eye (priority 2)
  let d_right_eye = sdf_circle(uv, RIGHT_EYE_CENTER, EYE_RADIUS_UV);
  if (d_right_eye < 0.0) {
    return FEATURE_RIGHT_EYE;
  }
  
  // Check smile curve (priority 3)
  // Only check if within x bounds of smile
  if (uv.x >= SMILE_X_MIN && uv.x <= SMILE_X_MAX) {
    let d_smile = sdf_parabola(uv, SMILE_CURVE_A, SMILE_CURVE_Y0, SMILE_X_MIN, SMILE_X_MAX);
    if (d_smile < SMILE_THICKNESS_UV * 0.5) {
      return FEATURE_SMILE_CURVE;
    }
  }
  
  // Check morph target region (priority 4, phase-dependent)
  // Only active when in morph phase (handled by caller using phase info)
  if (dist_from_center < MORPH_REGION_RADIUS) {
    // Check X logo or GROK text based on morph_mode
    if (params.morph_mode == 0u) {
      // X logo
      let d_x = sdf_x_shape(uv, 0.03);
      if (d_x < 0.0) {
        return FEATURE_MORPH_TARGET;
      }
    } else {
      // GROK text
      let d_grok = sdf_grok_text(uv, 0.04);
      if (d_grok < 0.0) {
        return FEATURE_MORPH_TARGET;
      }
    }
  }
  
  return FEATURE_NONE;
}

// ============================================================================
// ANIMATION PHASE CALCULATIONS
// ============================================================================

/**
 * Calculate animation phase and local progress within phase.
 * 
 * @param cycle_time Current time in cycle [0, 48]
 * @return vec2f(phase_index, phase_progress)
 */
fn get_animation_phase(cycle_time: f32) -> vec2f {
  var phase: f32 = 0.0;
  var progress: f32 = 0.0;
  
  if (cycle_time < PHASE_1_START) {
    // Phase 0: Idle
    phase = 0.0;
    progress = cycle_time / PHASE_0_IDLE;
  } else if (cycle_time < PHASE_2_START) {
    // Phase 1: Emerge
    phase = 1.0;
    progress = (cycle_time - PHASE_1_START) / PHASE_1_EMERGE;
  } else if (cycle_time < PHASE_3_START) {
    // Phase 2: Blink
    phase = 2.0;
    progress = (cycle_time - PHASE_2_START) / PHASE_2_BLINK;
  } else if (cycle_time < PHASE_4_START) {
    // Phase 3: Twinkle
    phase = 3.0;
    progress = (cycle_time - PHASE_3_START) / PHASE_3_TWINKLE;
  } else if (cycle_time < PHASE_5_START) {
    // Phase 4: Glow
    phase = 4.0;
    progress = (cycle_time - PHASE_4_START) / PHASE_4_GLOW;
  } else if (cycle_time < PHASE_6_START) {
    // Phase 5: Morph
    phase = 5.0;
    progress = (cycle_time - PHASE_5_START) / PHASE_5_MORPH;
  } else {
    // Phase 6: Fade
    phase = 6.0;
    progress = (cycle_time - PHASE_6_START) / PHASE_6_FADE;
  }
  
  return vec2f(phase, clamp(progress, 0.0, 1.0));
}

/**
 * Generate deterministic random value from satellite index.
 * Used for twinkling and other per-satellite variations.
 */
fn hash_u32(n: u32) -> f32 {
  // PCG hash variant for good distribution
  var state: u32 = n * 747796405u + 2891336453u;
  var word: u32 = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  word = (word >> 22u) ^ word;
  return f32(word) / 4294967295.0;  // Normalize to [0, 1]
}

/**
 * PHASE 0: IDLE
 * Subtle breathing, satellites at base brightness.
 * No smile visible yet.
 */
fn phase_idle(
  base_color: vec3f,
  base_bright: f32,
  progress: f32,
  global_time: f32,
  sat_idx: u32,
  sat_pos: vec3f
) -> vec3f {
  // Very subtle global breathing
  let breathe = 1.0 + sin(global_time * 0.5) * 0.05;
  return base_color * base_bright * breathe;
}

/**
 * PHASE 1: EMERGE
 * Smile fades in from base color to target colors.
 * Ease-out cubic interpolation for smooth appearance.
 */
fn phase_emerge(
  base_color: vec3f,
  base_bright: f32,
  progress: f32,
  feature: u32,
  sat_idx: u32
) -> vec4f {
  // Smooth ease-out: 1 - (1 - t)^3
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
      // Non-feature satellites dim slightly
      target_color = base_color * 0.7;
      target_bright = base_bright * 0.8;
    }
  }
  
  let color = mix(base_color * base_bright, target_color * target_bright, t);
  return vec4f(color, 1.0);
}

/**
 * PHASE 2: BLINK
 * Eyes blink in alternating sequence.
 * Left eye blinks at 25% and 75% of phase.
 * Right eye blinks at 0%, 50%, and 100% (opposite).
 */
fn phase_blink(
  base_color: vec3f,
  base_bright: f32,
  progress: f32,
  feature: u32,
  sat_idx: u32
) -> vec4f {
  var color: vec3f;
  var bright: f32;
  
  switch (feature) {
    case FEATURE_LEFT_EYE: {
      // Blink at 0.25 and 0.75
      let blink_phase = fract(progress * 2.0);
      let blink = 1.0 - smoothstep(0.45, 0.5, blink_phase) * smoothstep(0.55, 0.5, blink_phase);
      color = COLOR_AMBER;
      bright = 1.2 * blink;
    }
    case FEATURE_RIGHT_EYE: {
      // Blink at 0.0, 0.5, 1.0 (offset by 0.5)
      let blink_phase = fract(progress * 2.0 + 0.5);
      let blink = 1.0 - smoothstep(0.45, 0.5, blink_phase) * smoothstep(0.55, 0.5, blink_phase);
      color = COLOR_AMBER;
      bright = 1.2 * blink;
    }
    case FEATURE_SMILE_CURVE: {
      // Smile maintains steady golden glow
      color = COLOR_GOLDEN;
      bright = 1.0 + sin(progress * 6.28318) * 0.1;  // Subtle pulse
    }
    default: {
      color = base_color * 0.7;
      bright = base_bright * 0.8;
    }
  }
  
  return vec4f(color * bright, 1.0);
}

/**
 * PHASE 3: TWINKLE
 * Traveling sparkle wave moves left to right across smile.
 * Individual random twinkles on smile satellites.
 */
fn phase_twinkle(
  base_color: vec3f,
  base_bright: f32,
  progress: f32,
  feature: u32,
  sat_idx: u32,
  uv: vec2f
) -> vec4f {
  var color: vec3f;
  var bright: f32;
  
  switch (feature) {
    case FEATURE_LEFT_EYE:
    case FEATURE_RIGHT_EYE: {
      // Eyes maintain steady glow
      color = COLOR_AMBER;
      bright = 1.1 + sin(progress * 4.0) * 0.1;
    }
    case FEATURE_SMILE_CURVE: {
      // Traveling wave from left to right
      // Normalize x position to [0, 1]
      let normalized_x = (uv.x - SMILE_X_MIN) / (SMILE_X_MAX - SMILE_X_MIN);
      
      // Wave position moves with progress
      let wave_pos = fract(progress * 3.0);  // 3 waves per phase
      let dist_to_wave = abs(normalized_x - wave_pos);
      
      // Sparkle boost when near wave
      let wave_sparkle = 1.0 + smoothstep(0.15, 0.0, dist_to_wave) * 0.6;
      
      // Individual random twinkle
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

/**
 * PHASE 4: GLOW
 * Full brightness pulse, all features glow intensely.
 * Warm color shift from amber/golden toward warm white.
 */
fn phase_glow(
  base_color: vec3f,
  base_bright: f32,
  progress: f32,
  feature: u32,
  sat_idx: u32
) -> vec4f {
  // Intense pulse: 1.0 -> 1.5 -> 1.0
  let pulse = 1.0 + sin(progress * 3.14159) * 0.5;
  
  var color: vec3f;
  var bright: f32;
  
  switch (feature) {
    case FEATURE_LEFT_EYE:
    case FEATURE_RIGHT_EYE: {
      // Shift from amber toward warm white
      let eye_color = mix(COLOR_AMBER, COLOR_WARM_WHITE, pulse - 1.0);
      color = eye_color;
      bright = 1.2 * pulse;
    }
    case FEATURE_SMILE_CURVE: {
      // Shift from golden toward warm white
      let smile_color = mix(COLOR_GOLDEN, COLOR_WARM_WHITE, pulse - 1.0);
      color = smile_color;
      bright = 1.0 * pulse;
    }
    default: {
      // Non-feature satellites catch some ambient glow
      color = base_color;
      bright = base_bright * (0.8 + pulse * 0.2);
    }
  }
  
  return vec4f(color * bright, 1.0);
}

/**
 * PHASE 5: MORPH
 * Transform to X logo or "GROK" text in center region.
 * Features outside morph region fade to support the morph target.
 */
fn phase_morph(
  base_color: vec3f,
  base_bright: f32,
  progress: f32,
  feature: u32,
  sat_idx: u32
) -> vec4f {
  // Smooth morph transition
  let morph_t = smoothstep(0.0, 1.0, progress);
  
  var color: vec3f;
  var bright: f32;
  
  switch (feature) {
    case FEATURE_LEFT_EYE:
    case FEATURE_RIGHT_EYE: {
      // Eyes fade to support morph
      let dim = 1.0 - morph_t * 0.7;
      color = COLOR_AMBER * dim;
      bright = 1.2 * dim;
    }
    case FEATURE_SMILE_CURVE: {
      // Smile fades to support morph
      let dim = 1.0 - morph_t * 0.6;
      color = COLOR_GOLDEN * dim;
      bright = 1.0 * dim;
    }
    case FEATURE_MORPH_TARGET: {
      // Morph target brightens and pulses
      if (params.morph_mode == 0u) {
        // X logo - black with cyan outline
        color = mix(COLOR_X_LOGO, COLOR_CYAN_ACCENT, morph_t * 0.5);
      } else {
        // GROK text - purple glow
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

/**
 * PHASE 6: FADE
 * Fade back to idle state.
 * Ease-in interpolation for smooth disappearance.
 */
fn phase_fade(
  base_color: vec3f,
  base_bright: f32,
  progress: f32,
  feature: u32,
  sat_idx: u32
) -> vec4f {
  // Ease-in: t^2
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

// ============================================================================
// MAIN PATTERN FUNCTION
// ============================================================================

/**
 * SMILE PATTERN - Main entry point for color/brightness calculation.
 * 
 * Calculates the output color for a satellite based on:
 * - Position in smile face (via gnomonic projection)
 * - Current animation phase
 * - Per-satellite random variations
 * 
 * This function implements the exact signature specified in requirements.
 * 
 * @param sat_pos       Satellite ECI position (km)
 * @param sat_idx       Satellite index for deterministic random
 * @param base_color    Satellite's base constellation color
 * @param base_bright   Base brightness value
 * @param cycle_time    Current time in 48-second cycle
 * @param global_time   Absolute time for continuous effects
 * @return vec4f(rgb, feature_id) - feature in alpha channel
 */
fn smile_pattern(
  sat_pos: vec3f,
  sat_idx: u32,
  base_color: vec3f,
  base_bright: f32,
  cycle_time: f32,
  global_time: f32
) -> vec4f {
  // Calculate Earth direction (satellite to Earth center)
  let earth_dir = normalize(-sat_pos);
  
  // Gnomonic projection to get UV coordinates
  let uv = gnomonic_project_satellite(sat_pos, earth_dir);
  
  // Detect feature for this satellite
  let feature = get_smile_feature(uv);
  
  // Get current animation phase
  let phase_info = get_animation_phase(cycle_time);
  let phase = u32(phase_info.x);
  let phase_progress = phase_info.y;
  
  // Calculate color based on phase
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
  
  // Encode feature ID in alpha channel
  // 0=none, 1=left eye, 2=right eye, 3=smile, 4=morph
  let feature_alpha = f32(feature) / 4.0;
  
  return vec4f(result.rgb, feature_alpha);
}

// ============================================================================
// CHAOS / IDLE MODE
// ============================================================================

/**
 * Calculate chaos/idle mode output.
 * Used when target_mode = 1 (transitioning away from smile).
 * 
 * Returns subtle constellation colors with gentle random twinkling.
 */
fn chaos_mode(
  sat_pos: vec3f,
  sat_idx: u32,
  base_color: vec3f,
  base_bright: f32,
  global_time: f32
) -> vec4f {
  // Deterministic random for this satellite
  let hash_val = hash_u32(sat_idx);
  
  // Gentle twinkle at different frequencies
  let twinkle1 = 0.5 + 0.5 * sin(global_time * (0.5 + hash_val * 0.5) + hash_val * 10.0);
  let twinkle2 = 0.5 + 0.5 * sin(global_time * (0.3 + hash_val * 0.3) + hash_val * 20.0);
  let combined_twinkle = 0.7 + 0.3 * (twinkle1 * 0.6 + twinkle2 * 0.4);
  
  // Slight color variation
  let color_shift = 1.0 + (hash_val - 0.5) * 0.1;
  
  let color = base_color * color_shift * base_bright * combined_twinkle;
  return vec4f(color, 0.0);  // Alpha 0 = no feature
}

// ============================================================================
// TRANSITION / CROSS-FADE
// ============================================================================

/**
 * Apply smooth cross-fade between smile and chaos modes.
 * 
 * Uses smoothstep for smooth interpolation over transition_duration seconds.
 * 
 * @param smile_output  Result from smile_pattern()
 * @param chaos_output  Result from chaos_mode()
 * @param alpha         Current transition_alpha (0-1)
 * @return Final blended output
 */
fn apply_transition(
  smile_output: vec4f,
  chaos_output: vec4f,
  alpha: f32
) -> vec4f {
  // Smoothstep for non-linear, smoother transition
  let smooth_alpha = smoothstep(0.0, 1.0, alpha);
  
  let color = mix(chaos_output.rgb, smile_output.rgb, smooth_alpha);
  let feature = mix(chaos_output.a, smile_output.a, smooth_alpha);
  
  return vec4f(color, feature);
}

// ============================================================================
// COMPUTE SHADER ENTRY POINT
// ============================================================================

/**
 * Main compute entry point for Smile v2 animation.
 * 
 * Workgroup size: 256 threads (optimal for GPU occupancy)
 * Processes all 1,048,576 satellites with branch-coherent grouping.
 * 
 * Branch coherence strategy:
 * - Satellites are grouped by feature ID to minimize divergence
 * - Non-facing satellites exit early (best performance)
 * - Within each feature group, same code path is taken
 */
@compute @workgroup_size(256)
fn smile_v2_compute(@builtin(global_invocation_id) gid: vec3u) {
  let sat_idx = gid.x;
  
  // Bounds check
  if (sat_idx >= NUM_SATELLITES) {
    return;
  }
  
  // Load satellite data
  let sat_data = sat_positions[sat_idx];
  let sat_pos = sat_data.xyz;
  let cdat = sat_data.w;
  
  // Derive base color from cdat (shell/plane index)
  // This matches the pattern from satellites.wgsl
  let cidx = u32(abs(cdat)) % 7u;
  var base_color: vec3f;
  switch (cidx) {
    case 0u: { base_color = vec3f(1.0, 0.18, 0.18); }   // Red
    case 1u: { base_color = vec3f(0.18, 1.0, 0.18); }   // Green
    case 2u: { base_color = vec3f(0.25, 0.45, 1.0); }   // Blue
    case 3u: { base_color = vec3f(1.0, 1.0, 0.1); }     // Yellow
    case 4u: { base_color = vec3f(0.1, 1.0, 1.0); }     // Cyan
    case 5u: { base_color = vec3f(1.0, 0.1, 1.0); }     // Magenta
    default: { base_color = vec3f(1.0, 1.0, 1.0); }     // White
  }
  
  let base_bright = 1.0;
  
  // Calculate smile pattern
  let smile_output = smile_pattern(
    sat_pos,
    sat_idx,
    base_color,
    base_bright,
    params.cycle_time,
    params.global_time
  );
  
  // Calculate chaos/idle mode (for transition support)
  let chaos_output = chaos_mode(
    sat_pos,
    sat_idx,
    base_color,
    base_bright,
    params.global_time
  );
  
  // Apply transition alpha
  // transition_alpha: 1 = full smile, 0 = full chaos
  // target_mode determines which state we transition toward
  var final_output: vec4f;
  
  if (params.target_mode < 0.5) {
    // Target is normal mode (smile)
    final_output = apply_transition(smile_output, chaos_output, params.transition_alpha);
  } else {
    // Target is chaos/idle mode
    // Invert alpha logic: when target=chaos, alpha=0 means full chaos, alpha=1 means full smile
    final_output = apply_transition(smile_output, chaos_output, params.transition_alpha);
  }
  
  // Store result
  sat_output[sat_idx] = final_output;
}

// ============================================================================
// UTILITY / PRE-COMPUTE ENTRY POINTS
// ============================================================================

/**
 * Feature assignment pre-computation.
 * 
 * Can be run once at animation start to cache feature assignments,
 * avoiding redundant gnomonic projection calculations each frame.
 * 
 * Results stored in feature_cache buffer as u32 feature IDs.
 */
@compute @workgroup_size(256)
fn precompute_features(@builtin(global_invocation_id) gid: vec3u) {
  let sat_idx = gid.x;
  
  if (sat_idx >= NUM_SATELLITES) {
    return;
  }
  
  let sat_pos = sat_positions[sat_idx].xyz;
  let earth_dir = normalize(-sat_pos);
  
  // Check Earth-facing condition first
  let facing = dot(normalize(sat_pos), -earth_dir);
  
  var feature: u32;
  if (facing < FACING_THRESHOLD) {
    feature = FEATURE_NONE;
  } else {
    let uv = gnomonic_project_satellite(sat_pos, earth_dir);
    feature = get_smile_feature(uv);
  }
  
  feature_cache[sat_idx] = feature;
}

/**
 * Earth-facing check utility.
 * 
 * Populates a visibility buffer with 1.0 for facing satellites, 0.0 otherwise.
 * Useful for culling optimization on CPU side.
 */
@compute @workgroup_size(256)
fn check_facing(@builtin(global_invocation_id) gid: vec3u) {
  let sat_idx = gid.x;
  
  if (sat_idx >= NUM_SATELLITES) {
    return;
  }
  
  let sat_pos = sat_positions[sat_idx].xyz;
  let earth_dir = normalize(-sat_pos);
  let facing = dot(normalize(sat_pos), -earth_dir);
  
  // Store facing status as float in output buffer
  let facing_val = select(0.0, 1.0, facing > FACING_THRESHOLD);
  sat_output[sat_idx] = vec4f(facing_val, 0.0, 0.0, 0.0);
}
