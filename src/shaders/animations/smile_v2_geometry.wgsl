// =================================================================================
// GNOMONIC PROJECTION
// =================================================================================

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

// =================================================================================
// SDF (SIGNED DISTANCE FUNCTION) HELPERS
// =================================================================================

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

// =================================================================================
// FEATURE DETECTION
// =================================================================================

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
