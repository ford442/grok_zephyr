/**
 * Earth and Atmosphere Shader
 * 
 * Renders Earth sphere with procedural land/ocean and atmospheric limb glow.
 * Critical for the 720km horizon view showing Earth curvature.
 * 
 * Features:
 *   - Procedural land/ocean using spherical harmonics
 *   - City lights on night side
 *   - Rayleigh scattering atmospheric limb glow
 *   - Earth curvature visualization
 *   - 720km horizon view optimization
 */

//==============================================================================
// Bindings
//==============================================================================

#import common

//==============================================================================
// Vertex Structures
//==============================================================================

struct VertexInput {
  @location(0) position : vec3f,
  @location(1) normal   : vec3f,
};

struct VertexOutput {
  @builtin(position) clip_position : vec4f,
  @location(0)       world_pos     : vec3f,
  @location(1)       normal        : vec3f,
  @location(2)       view_dir      : vec3f,
};

//==============================================================================
// Earth Constants
//==============================================================================

// Earth radius in km
const EARTH_RADIUS_KM : f32 = 6371.0;

// Atmosphere scale (100km atmosphere thickness)
const ATM_SCALE : f32 = 6471.0 / 6371.0;

// Atmospheric scattering constants
const RAYLEIGH_SCALE_HEIGHT : f32 = 8.0;     // km
const MIE_SCALE_HEIGHT      : f32 = 1.2;     // km
const ATMOSPHERE_THICKNESS  : f32 = 100.0;   // km

// Sun direction (fixed for now, could be parameterized)
const SUN_DIR : vec3f = vec3f(1.0, 0.4, 0.2);

// Lighting constants
const AMBIENT_LIGHT : f32 = 0.04;
const DIFFUSE_SCALE : f32 = 0.92;

// Procedural generation constants
const LAND_SCALE_1  : f32 = 4.0;
const LAND_SCALE_2  : f32 = 6.0;
const LON_SCALE_1   : f32 = 3.0;
const LON_SCALE_2   : f32 = 5.0;
const CITY_FREQ     : f32 = 18.0;

//==============================================================================
// Procedural Earth Generation
//==============================================================================

// 2D hash for land generation
fn hash2e(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

// Calculate latitude and longitude from normal
fn get_lat_lon(N: vec3f) -> vec2f {
  let lat = asin(clamp(N.z, -1.0, 1.0));
  let lon = atan2(N.y, N.x);
  return vec2f(lat, lon);
}

// Procedural land/ocean pattern using spherical harmonics
fn calculate_land_factor(lat: f32, lon: f32) -> f32 {
  let f1 = sin(lat * LAND_SCALE_1 + 0.5) * cos(lon * LON_SCALE_1 + 1.2);
  let f2 = cos(lat * LAND_SCALE_2) * sin(lon * LON_SCALE_2 + 0.8);
  let combined = f1 * 0.6 + f2 * 0.4;
  
  return smoothstep_f32(0.15, 0.35, combined);
}

// Earth color palette
const OCEAN_COLOR : vec3f = vec3f(0.04, 0.10, 0.30);
const LAND_COLOR  : vec3f = vec3f(0.15, 0.22, 0.06);
const ICE_COLOR   : vec3f = vec3f(0.70, 0.75, 0.80);

// Calculate surface color
fn calculate_surface_color(N: vec3f, sun_dir: vec3f) -> vec3f {
  let lat_lon = get_lat_lon(N);
  let lat = lat_lon.x;
  let lon = lat_lon.y;
  
  // Land factor
  let land = calculate_land_factor(lat, lon);
  
  // Polar ice caps
  let pole = smoothstep_f32(1.1, 1.4, abs(lat));
  
  // Base surface color
  var surf = mix(mix(OCEAN_COLOR, LAND_COLOR, land), ICE_COLOR, pole);
  
  return surf;
}

// Calculate city lights on night side
fn calculate_city_lights(N: vec3f, sun_dir: vec3f, land: f32, lat: f32, lon: f32) -> vec3f {
  // Night side factor (sun below horizon)
  let night = smoothstep_f32(0.08, -0.08, dot(N, sun_dir));
  
  // City lights only on land
  let city_mask = smoothstep_f32(0.4, 0.6, land);
  
  // City pattern (grid-like)
  let city_pattern = 0.5 + 0.5 * sin(lon * CITY_FREQ + lat * 14.0);
  
  // City light color (warm yellow)
  let city_color = vec3f(1.0, 0.85, 0.4);
  
  return night * 0.025 * city_color * city_mask * city_pattern;
}

//==============================================================================
// Earth Vertex Shader
//==============================================================================

@vertex
fn vs_earth(v: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  
  out.clip_position = uni.view_proj * vec4f(v.position, 1.0);
  out.world_pos = v.position;
  out.normal = v.normal;
  out.view_dir = normalize(uni.camera_pos.xyz - v.position);
  
  return out;
}

// Alias for compatibility
@vertex
fn vs(v: VertexInput) -> VertexOutput {
  return vs_earth(v);
}

//==============================================================================
// Earth Fragment Shader
//==============================================================================

@fragment
fn fs_earth(in: VertexOutput) -> @location(0) vec4f {
  let N = normalize(in.normal);
  let sun_dir = normalize(SUN_DIR);
  
  // Diffuse lighting
  let diff = max(dot(N, sun_dir), 0.0);
  
  // Get lat/lon for procedural generation
  let lat_lon = get_lat_lon(N);
  let lat = lat_lon.x;
  let lon = lat_lon.y;
  
  // Land factor (reused for cities)
  let land = calculate_land_factor(lat, lon);
  
  // Surface color
  let surf = calculate_surface_color(N, sun_dir);
  
  // Apply lighting
  let lit = surf * (diff * DIFFUSE_SCALE + AMBIENT_LIGHT);
  
  // City lights
  let city = calculate_city_lights(N, sun_dir, land, lat, lon);
  
  return vec4f(lit + city, 1.0);
}

// Alias for compatibility
@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  return fs_earth(in);
}

//==============================================================================
// Atmosphere Shader
//==============================================================================

// Atmosphere vertex shader (scaled sphere)
@vertex
fn vs_atm(v: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  
  // Scale up for atmosphere shell
  let p = v.position * ATM_SCALE;
  
  out.clip_position = uni.view_proj * vec4f(p, 1.0);
  out.world_pos = p;
  out.normal = v.normal;
  out.view_dir = normalize(uni.camera_pos.xyz - p);
  
  return out;
}

// Rayleigh scattering phase function
fn rayleigh_phase(cos_theta: f32) -> f32 {
  return (3.0 / (16.0 * 3.14159265)) * (1.0 + cos_theta * cos_theta);
}

// Calculate atmospheric density at altitude
fn atmospheric_density(altitude_km: f32) -> f32 {
  return exp(-altitude_km / RAYLEIGH_SCALE_HEIGHT);
}

// Atmosphere fragment shader with limb glow
@fragment
fn fs_atm(in: VertexOutput) -> @location(0) vec4f {
  let N = normalize(in.normal);
  let V = normalize(uni.camera_pos.xyz - in.world_pos);
  
  // Rim factor based on view angle
  // At horizon: N·V ≈ 0, rim ≈ 1
  // At center: N·V ≈ 1, rim ≈ 0
  let cos_view = dot(N, V);
  let rim = 1.0 - abs(cos_view);
  
  // Power functions for different scattering layers
  let limb = pow(rim, 3.5);    // Main blue layer
  let limb2 = pow(rim, 7.0);   // Outer teal layer
  
  // Atmospheric colors
  let blue = vec3f(0.08, 0.38, 1.0) * limb * 2.8;
  let teal = vec3f(0.0, 0.7, 0.45) * limb2 * 0.6;
  
  // Combined color with alpha
  let color = blue + teal;
  let alpha = limb * 0.85;
  
  // Sun scatter effect
  let sun_dir = normalize(SUN_DIR);
  let sun_dot = dot(V, sun_dir);
  let sun_glow = pow(max(sun_dot, 0.0), 8.0) * 0.3 * limb;
  
  return vec4f(color + vec3f(sun_glow), alpha);
}

//==============================================================================
// Horizon-Optimized Atmosphere (720km view)
//==============================================================================

// Optimized atmosphere for horizon view with enhanced curvature
@vertex
fn vs_atm_horizon(v: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  
  // Larger scale for extended atmosphere visible at horizon
  let horizon_scale = ATM_SCALE * 1.05;
  let p = v.position * horizon_scale;
  
  out.clip_position = uni.view_proj * vec4f(p, 1.0);
  out.world_pos = p;
  out.normal = v.normal;
  out.view_dir = normalize(uni.camera_pos.xyz - p);
  
  return out;
}

// Enhanced limb glow for horizon view
@fragment
fn fs_atm_horizon(in: VertexOutput) -> @location(0) vec4f {
  let N = normalize(in.normal);
  let V = normalize(uni.camera_pos.xyz - in.world_pos);
  
  // Enhanced rim for horizon curvature visibility
  let cos_view = dot(N, V);
  let rim = 1.0 - abs(cos_view);
  
  // Stronger, more saturated colors for 720km view
  let limb = pow(rim, 2.5);
  let limb2 = pow(rim, 5.0);
  
  // Brighter blue for horizon glow
  let deep_blue = vec3f(0.05, 0.25, 0.95) * limb * 3.5;
  let cyan = vec3f(0.1, 0.8, 0.6) * limb2 * 1.2;
  
  // Extended alpha falloff
  let alpha = limb * 0.95;
  
  return vec4f(deep_blue + cyan, alpha);
}
