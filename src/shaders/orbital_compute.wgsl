/**
 * Orbital Compute Shader - GPU-based Satellite Propagation
 * 
 * Implements:
 * - J2 perturbation for Earth's oblateness
 * - RK4 integration for high-precision position updates
 * - Walker constellation position calculation
 * - Visibility-aware computation culling
 * 
 * Buffer Layout:
 * - Uniforms: view/proj matrices, camera position, time, frustum planes
 * - Orbital Elements: storage buffer with keplerian elements
 * - Positions: read-write storage for computed positions
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const NUM_SAT: u32 = 1048576u;           // 2^20 satellites
const EARTH_R: f32 = 6371.0;             // km
const MU: f32 = 398600.4418;             // km³/s²
const J2: f32 = 0.00108263;              // Earth's oblateness
const J4: f32 = -0.000002370912;         // Higher-order J4 term (optional)

// Starlink shell altitudes (km)
const SHELL_1_ALT: f32 = 550.0;
const SHELL_2_ALT: f32 = 540.0;
const SHELL_3_ALT: f32 = 570.0;

// Precomputed mean motion for each shell (rad/s)
// n = sqrt(μ / a³) where a = EARTH_R + altitude
const SHELL_1_N: f32 = 0.001131;         // 550km
const SHELL_2_N: f32 = 0.001143;         // 540km  
const SHELL_3_N: f32 = 0.001103;         // 570km

// ============================================================================
// UNIFORM STRUCT (matches CPU layout)
// ============================================================================

struct Uni {
  view_proj      : mat4x4f,              // offset   0, size 64
  camera_pos     : vec4f,                // offset  64, size 16
  camera_right   : vec4f,                // offset  80, size 16
  camera_up      : vec4f,                // offset  96, size 16
  time           : f32,                  // offset 112
  delta_time     : f32,                  // offset 116
  view_mode      : u32,                  // offset 120
  physics_mode   : u32,                  // offset 124 (0=simple, 1=J2, 2=RK4)
  frustum        : array<vec4f, 6>,      // offset 128, size 96
  screen_size    : vec2f,                // offset 224
  lod_distance   : f32,                  // offset 232 (distance for detail level)
  pad0           : f32,                  // offset 236
};                                       // total 240 → padded to 256

@group(0) @binding(0) var<uniform> uni : Uni;

// ============================================================================
// STORAGE BUFFERS
// ============================================================================

/**
 * Orbital Elements Storage (16 bytes per satellite)
 * Layout: vec4f per satellite
 *   x: RAAN (right ascension of ascending node) - radians
 *   y: inclination - radians
 *   z: mean anomaly at epoch - radians
 *   w: color/pattern data (packed)
 */
@group(0) @binding(1) var<storage, read> orb_elem : array<vec4f>;

/**
 * Extended Elements Storage (64 bytes per satellite) - optional
 * Used for advanced propagation modes
 * Layout per satellite (16 floats):
 *   [0]: semi-major axis (km)
 *   [1]: eccentricity
 *   [2]: inclination (rad)
 *   [3]: RAAN (rad)
 *   [4]: argument of perigee (rad)
 *   [5]: mean anomaly (rad)
 *   [6]: mean motion (rad/s)
 *   [7]: reserved
 *   [8-10]: position (filled by compute)
 *   [11]: reserved
 *   [12-14]: velocity (filled by compute)
 *   [15]: epoch
 */
@group(0) @binding(2) var<storage, read_write> ext_elem : array<f32>;

/**
 * Output Positions (16 bytes per satellite)
 * Layout: vec4f per satellite
 *   xyz: position in km (ECI frame)
 *   w: color/visibility data
 */
@group(0) @binding(3) var<storage, read_write> sat_pos : array<vec4f>;

/**
 * Visibility flags (4 bytes per satellite)
 * CPU can read this for culling decisions
 */
@group(0) @binding(4) var<storage, read_write> visibility : array<u32>;

// ============================================================================
// J2 PERTURBATION CALCULATIONS
// ============================================================================

/**
 * Calculate J2 perturbation acceleration at a position
 * 
 * The J2 perturbation accounts for Earth's oblateness:
 * a_j2 = 3/2 * J2 * μ * Re² / r⁵ * [
 *   x * (5z²/r² - 1),
 *   y * (5z²/r² - 1),
 *   z * (5z²/r² - 3)
 * ]
 */
fn j2Acceleration(pos: vec3f) -> vec3f {
  let r2 = dot(pos, pos);
  let r = sqrt(r2);
  let r3 = r2 * r;
  let r5 = r2 * r3;
  let r7 = r2 * r5;
  
  let z2 = pos.z * pos.z;
  
  // J2 factor: 3/2 * J2 * μ * Re²
  let j2_factor = 1.5 * J2 * MU * EARTH_R * EARTH_R;
  
  let z2r2 = z2 / r2;
  
  return vec3f(
    j2_factor * pos.x * (5.0 * z2r2 - 1.0) / r5,
    j2_factor * pos.y * (5.0 * z2r2 - 1.0) / r5,
    j2_factor * pos.z * (5.0 * z2r2 - 3.0) / r5
  );
}

/**
 * Calculate two-body gravitational acceleration
 */
fn twoBodyAcceleration(pos: vec3f) -> vec3f {
  let r2 = dot(pos, pos);
  let r3 = r2 * sqrt(r2);
  return -MU * pos / r3;
}

/**
 * Calculate total acceleration including J2 perturbation
 */
fn totalAcceleration(pos: vec3f) -> vec3f {
  return twoBodyAcceleration(pos) + j2Acceleration(pos);
}

/**
 * Calculate J2 nodal precession rate (RAAN dot)
 * 
 * Ω̇ = -3/2 * J2 * (Re/p)² * n * cos(i)
 * 
 * For circular orbits: p = a
 */
fn nodalPrecessionRate(a: f32, i: f32) -> f32 {
  let n = sqrt(MU / (a * a * a));
  let re_over_a = EARTH_R / a;
  return -1.5 * J2 * re_over_a * re_over_a * n * cos(i);
}

/**
 * Calculate J2 perigee precession rate (argument of perigee dot)
 * 
 * ω̇ = 3/4 * J2 * (Re/p)² * n * (5cos²(i) - 1)
 */
fn perigeePrecessionRate(a: f32, i: f32) -> f32 {
  let n = sqrt(MU / (a * a * a));
  let re_over_a = EARTH_R / a;
  let cos_i = cos(i);
  return 0.75 * J2 * re_over_a * re_over_a * n * (5.0 * cos_i * cos_i - 1.0);
}

// ============================================================================
// ORBITAL ELEMENT TO POSITION CONVERSIONS
// ============================================================================

/**
 * Solve Kepler's equation: M = E - e*sin(E)
 * Uses Newton-Raphson iteration
 */
fn solveKepler(M: f32, e: f32) -> f32 {
  // Normalize M to [0, 2π]
  var E = M;
  if (e > 0.8) {
    E = 3.14159265359; // π for high eccentricity
  }
  
  // Newton-Raphson iteration (max 10 iterations for GPU)
  for (var i = 0; i < 10; i++) {
    let sinE = sin(E);
    let cosE = cos(E);
    let f = E - e * sinE - M;
    let fp = 1.0 - e * cosE;
    let dE = -f / fp;
    E = E + dE;
    
    if (abs(dE) < 1.0e-7) {
      break;
    }
  }
  
  return E;
}

/**
 * Convert Keplerian elements to position using mean anomaly
 * For circular orbits (e ≈ 0), mean anomaly ≈ true anomaly
 */
fn keplerianToPosition(
  a: f32,
  e: f32,
  i: f32,
  raan: f32,
  argPerigee: f32,
  meanAnomaly: f32
) -> vec3f {
  // Solve for eccentric anomaly
  let E = solveKepler(meanAnomaly, e);
  
  // True anomaly
  let cosE = cos(E);
  let sinE = sin(E);
  let sqrt1me2 = sqrt(1.0 - e * e);
  
  // Distance from center
  let r = a * (1.0 - e * cosE);
  
  // Position in orbital plane
  let x_orb = a * (cosE - e);
  let y_orb = a * sqrt1me2 * sinE;
  
  // Rotation to inertial frame
  let cosΩ = cos(raan);
  let sinΩ = sin(raan);
  let cosω = cos(argPerigee);
  let sinω = sin(argPerigee);
  let cosI = cos(i);
  let sinI = sin(i);
  
  // Transform to ECI
  let x = (cosΩ * cosω - sinΩ * sinω * cosI) * x_orb + 
          (-cosΩ * sinω - sinΩ * cosω * cosI) * y_orb;
  let y = (sinΩ * cosω + cosΩ * sinω * cosI) * x_orb + 
          (-sinΩ * sinω + cosΩ * cosω * cosI) * y_orb;
  let z = (sinω * sinI) * x_orb + (cosω * sinI) * y_orb;
  
  return vec3f(x, y, z);
}

/**
 * Calculate position for circular orbit (simplified)
 * Used for the basic Starlink-like circular orbits
 */
fn circularOrbitPosition(
  radius: f32,
  raan: f32,
  inc: f32,
  meanAnomaly: f32
) -> vec3f {
  let cM = cos(meanAnomaly);
  let sM = sin(meanAnomaly);
  let cR = cos(raan);
  let sR = sin(raan);
  let cI = cos(inc);
  let sI = sin(inc);
  
  return vec3f(
    radius * (cR * cM - sR * sM * cI),
    radius * (sR * cM + cR * sM * cI),
    radius * sM * sI
  );
}

// ============================================================================
// RK4 INTEGRATION
// ============================================================================

/**
 * State vector for RK4 integration
 */
struct OrbitState {
  pos: vec3f,
  vel: vec3f,
}

/**
 * RK4 integration step
 * 
 * Given state at time t, compute state at time t + dt
 */
fn rk4Step(state: OrbitState, dt: f32) -> OrbitState {
  let k1v = totalAcceleration(state.pos);
  let k1r = state.vel;
  
  let p2 = state.pos + k1r * dt * 0.5;
  let v2 = state.vel + k1v * dt * 0.5;
  let k2v = totalAcceleration(p2);
  let k2r = v2;
  
  let p3 = state.pos + k2r * dt * 0.5;
  let v3 = state.vel + k2v * dt * 0.5;
  let k3v = totalAcceleration(p3);
  let k3r = v3;
  
  let p4 = state.pos + k3r * dt;
  let v4 = state.vel + k3v * dt;
  let k4v = totalAcceleration(p4);
  let k4r = v4;
  
  return OrbitState(
    state.pos + (k1r + 2.0 * k2r + 2.0 * k3r + k4r) * dt / 6.0,
    state.vel + (k1v + 2.0 * k2v + 2.0 * k3v + k4v) * dt / 6.0
  );
}

// ============================================================================
// VISIBILITY CALCULATIONS
// ============================================================================

/**
 * Check if position is within camera frustum
 */
fn isInFrustum(pos: vec3f) -> bool {
  for (var p: u32 = 0u; p < 6u; p++) {
    let plane = uni.frustum[p];
    if (dot(plane.xyz, pos) + plane.w < -500.0) {
      return false;
    }
  }
  return true;
}

/**
 * Check if satellite is occluded by Earth
 */
fn isEarthOccluded(satPos: vec3f, camPos: vec3f) -> bool {
  let satDir = satPos - camPos;
  let satDist = length(satDir);
  let satDirN = satDir / satDist;
  
  // Project onto camera-to-Earth-center direction
  let camR = length(camPos);
  let cosAngle = -dot(camPos, satDirN) / camR;
  
  // Check if satellite is behind Earth
  // Earth angular radius from camera
  let sinEarthAng = EARTH_R / camR;
  let cosEarthAng = sqrt(1.0 - sinEarthAng * sinEarthAng);
  
  // If satellite is behind the Earth disk
  return cosAngle > cosEarthAng;
}

/**
 * Calculate visibility level
 * Returns: 0 = not visible, 1 = low detail, 2 = full detail
 */
fn calculateVisibility(pos: vec3f) -> u32 {
  let camPos = uni.camera_pos.xyz;
  let dist = length(pos - camPos);
  
  // Distance cull
  if (dist > 15000.0) {
    return 0u;
  }
  
  // Frustum cull
  if (!isInFrustum(pos)) {
    return 0u;
  }
  
  // Earth occlusion
  if (isEarthOccluded(pos, camPos)) {
    return 0u;
  }
  
  // LOD based on distance
  if (dist > uni.lod_distance) {
    return 1u;
  }
  
  return 2u;
}

// ============================================================================
// MAIN COMPUTE SHADER
// ============================================================================

@compute @workgroup_size(64, 1, 1)
fn updateSatellites(@builtin(global_invocation_id) id: vec3u) {
  let idx = id.x;
  if (idx >= NUM_SAT) { return; }
  
  // Load orbital elements
  let elem = orb_elem[idx];
  let raan = elem.x;
  let inc = elem.y;
  let m0 = elem.z;
  let cdat = elem.w;
  
  var position: vec3f;
  var visibilityLevel: u32 = 2u;
  
  // Select physics mode
  switch (uni.physics_mode) {
    case 0u: {
      // Simple circular orbit (original method)
      let meanMotion = sqrt(MU / (6921.0 * 6921.0 * 6921.0)); // 550km altitude
      let M = m0 + meanMotion * uni.time;
      position = circularOrbitPosition(6921.0, raan, inc, M);
    }
    case 1u: {
      // J2 perturbation only (element-based)
      // Get extended elements
      let extIdx = idx * 16u;
      let a = ext_elem[extIdx + 0u];
      let e = ext_elem[extIdx + 1u];
      let i = ext_elem[extIdx + 2u];
      let Ω = ext_elem[extIdx + 3u];
      let ω = ext_elem[extIdx + 4u];
      let M0 = ext_elem[extIdx + 5u];
      let n = ext_elem[extIdx + 6u];
      
      // Apply J2 precession
      let Ωdot = nodalPrecessionRate(a, i);
      let ωdot = perigeePrecessionRate(a, i);
      
      let Ω_current = Ω + Ωdot * uni.time;
      let ω_current = ω + ωdot * uni.time;
      let M_current = M0 + n * uni.time;
      
      position = keplerianToPosition(a, e, i, Ω_current, ω_current, M_current);
      
      // Update stored elements for next frame
      ext_elem[extIdx + 3u] = Ω_current;
      ext_elem[extIdx + 4u] = ω_current;
      ext_elem[extIdx + 5u] = M_current;
      ext_elem[extIdx + 8u] = position.x;
      ext_elem[extIdx + 9u] = position.y;
      ext_elem[extIdx + 10u] = position.z;
    }
    case 2u: {
      // Full RK4 integration
      // Load current state from extended buffer or compute from elements
      let extIdx = idx * 16u;
      
      var state: OrbitState;
      
      // Check if we have a valid stored position
      let storedX = ext_elem[extIdx + 8u];
      if (storedX != 0.0) {
        // Use stored position/velocity
        state.pos = vec3f(
          storedX,
          ext_elem[extIdx + 9u],
          ext_elem[extIdx + 10u]
        );
        state.vel = vec3f(
          ext_elem[extIdx + 12u],
          ext_elem[extIdx + 13u],
          ext_elem[extIdx + 14u]
        );
      } else {
        // Initialize from elements
        let a = ext_elem[extIdx + 0u];
        let e = ext_elem[extIdx + 1u];
        let i = ext_elem[extIdx + 2u];
        let Ω = ext_elem[extIdx + 3u];
        let ω = ext_elem[extIdx + 4u];
        let M = ext_elem[extIdx + 5u];
        
        state.pos = keplerianToPosition(a, e, i, Ω, ω, M);
        
        // Calculate initial velocity
        let n = sqrt(MU / (a * a * a));
        let p = a * (1.0 - e * e);
        let h = sqrt(MU * p);
        
        // Simplified velocity for circular orbit
        let v = sqrt(MU * (2.0 / length(state.pos) - 1.0 / a));
        
        // Velocity perpendicular to position
        let r_norm = normalize(state.pos);
        let perp = normalize(cross(r_norm, vec3f(0.0, 0.0, 1.0)));
        state.vel = perp * v;
      }
      
      // Limit dt for stability
      let dt = min(uni.delta_time, 10.0);
      
      // RK4 integration step
      state = rk4Step(state, dt);
      
      // Store updated state
      ext_elem[extIdx + 8u] = state.pos.x;
      ext_elem[extIdx + 9u] = state.pos.y;
      ext_elem[extIdx + 10u] = state.pos.z;
      ext_elem[extIdx + 12u] = state.vel.x;
      ext_elem[extIdx + 13u] = state.vel.y;
      ext_elem[extIdx + 14u] = state.vel.z;
      
      position = state.pos;
    }
    default: {
      // Fallback to simple orbit
      let meanMotion = sqrt(MU / (6921.0 * 6921.0 * 6921.0));
      let M = m0 + meanMotion * uni.time;
      position = circularOrbitPosition(6921.0, raan, inc, M);
    }
  }
  
  // Calculate visibility
  visibilityLevel = calculateVisibility(position);
  
  // Store visibility flag
  visibility[idx] = visibilityLevel;
  
  // Store position with encoded visibility in w component
  let visEncoded = f32(visibilityLevel);
  sat_pos[idx] = vec4f(position, cdat + visEncoded * 0.01);
}

// ============================================================================
// UTILITY FUNCTIONS FOR OTHER SHADERS
// ============================================================================

/**
 * Get satellite color based on shell/plane
 */
fn getSatelliteColor(idx: u32, cdat: f32) -> vec3f {
  // Extract shell from cdat
  let shell = u32(floor(cdat / 2.0)) % 3u;
  let plane = u32(fract(cdat) * 10.0) % 7u;
  
  switch (shell) {
    case 0u: { // Shell 1: 550km
      return mix(
        vec3f(1.0, 0.2, 0.2),  // Red
        vec3f(1.0, 0.5, 0.0),  // Orange
        f32(plane) / 7.0
      );
    }
    case 1u: { // Shell 2: 540km
      return mix(
        vec3f(0.2, 1.0, 0.2),  // Green
        vec3f(0.0, 1.0, 0.5),  // Cyan
        f32(plane) / 7.0
      );
    }
    case 2u: { // Shell 3: 570km
      return mix(
        vec3f(0.2, 0.5, 1.0),  // Blue
        vec3f(0.5, 0.2, 1.0),  // Purple
        f32(plane) / 7.0
      );
    }
    default: {
      return vec3f(1.0, 1.0, 1.0);
    }
  }
}

/**
 * Calculate satellite size based on distance and visibility level
 */
fn getSatelliteSize(dist: f32, visLevel: u32) -> f32 {
  // Base size calculation
  var size = clamp(1200.0 / max(dist, 50.0), 0.4, 60.0);
  
  // Adjust for LOD
  switch (visLevel) {
    case 0u: { size = 0.0; }      // Not visible
    case 1u: { size *= 0.5; }     // Low detail
    case 2u: { /* full size */ }  // Full detail
    default: {}
  }
  
  return size;
}
