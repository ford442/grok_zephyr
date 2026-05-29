/**
 * Earth and Atmosphere Shader
 * 
 * Renders Earth sphere with procedural land/ocean and atmospheric limb glow.
 * Critical for the 720km horizon view showing Earth curvature.
 * 
 * Features:
 *   - FBM-based land/ocean terrain with biome colours
 *   - PBR ocean with Schlick Fresnel and sun glint
 *   - FBM city lights with coastal/latitude density weighting
 *   - Rayleigh scattering atmospheric limb glow
 *   - Earth curvature visualization
 *   - 720km horizon view optimization
 */

//=================================================================================
// Bindings
//=================================================================================

#import "uniforms.wgsl"

const PI: f32 = 3.14159265;

//=================================================================================
// Vertex Structures
//=================================================================================

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

//=================================================================================
// Earth Constants
//=================================================================================

const EARTH_RADIUS_KM : f32 = 6371.0;
const ATM_SCALE       : f32 = 6471.0 / 6371.0;

const RAYLEIGH_SCALE_HEIGHT : f32 = 8.0;
const MIE_SCALE_HEIGHT      : f32 = 1.2;
const ATMOSPHERE_THICKNESS  : f32 = 100.0;

const AMBIENT_LIGHT : f32 = 0.04;
const DIFFUSE_SCALE : f32 = 0.92;

//=================================================================================
// Noise & FBM helpers
//=================================================================================

// Noise helpers (127.1, 311.7, 74.7, 43758.5453 are standard hash primes for PRNG)
fn hash3a(p: vec3f) -> f32 {
  return fract(sin(dot(p, vec3f(127.1, 311.7, 74.7))) * 43758.5453);
}

fn noise3a(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3a(i+vec3f(0,0,0)), hash3a(i+vec3f(1,0,0)), u.x),
        mix(hash3a(i+vec3f(0,1,0)), hash3a(i+vec3f(1,1,0)), u.x), u.y),
    mix(mix(hash3a(i+vec3f(0,0,1)), hash3a(i+vec3f(1,0,1)), u.x),
        mix(hash3a(i+vec3f(0,1,1)), hash3a(i+vec3f(1,1,1)), u.x), u.y),
    u.z);
}

fn fbmTerrain3(pos: vec3f) -> f32 {
  var v = 0.0; var a = 0.5; var freq = 1.0; var mx = 0.0;
  for (var i = 0; i < 4; i++) {
    v += a * noise3a(pos * freq); mx += a; a *= 0.5; freq *= 2.0;
  }
  return v / mx;
}

fn hash2a(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

fn noise2a(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2a(i+vec2f(0,0)), hash2a(i+vec2f(1,0)), u.x),
             mix(hash2a(i+vec2f(0,1)), hash2a(i+vec2f(1,1)), u.x), u.y);
}

fn fbmCity2(p: vec2f) -> f32 {
  var v = 0.0; var a = 0.5; var x = p;
  for (var i = 0; i < 4; i++) { v += a * noise2a(x); x *= 2.0; a *= 0.5; }
  return v;
}

//=================================================================================
// PBR helpers
//=================================================================================

fn schlickFresnel(cosTheta: f32, F0: f32) -> f32 {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

//=================================================================================
// Surface & city-light computation
//=================================================================================

fn calculate_surface_color(N: vec3f, sun_dir: vec3f, V: vec3f) -> vec3f {
  let lat = asin(clamp(N.z, -1.0, 1.0));
  let lon = atan2(N.y, N.x);

  // FBM terrain height
  let height = fbmTerrain3(normalize(N) * 3.0);
  let isLand = height > 0.45;
  let diff   = max(dot(N, sun_dir), 0.0);
  let pole   = smoothstep(1.1, 1.4, abs(lat));

  var surf: vec3f;
  if (isLand) {
    let COASTAL = 0.48; let PLAINS = 0.55; let HILLS = 0.70; let MOUNTAIN = 0.85;
    let beach  = vec3f(0.76, 0.70, 0.50);
    let grass  = vec3f(0.22, 0.42, 0.13);
    let forest = vec3f(0.10, 0.26, 0.07);
    let rock   = vec3f(0.35, 0.32, 0.28);
    let snow   = vec3f(0.90, 0.92, 0.95);
    var c: vec3f;
    if      (height < COASTAL)  { c = mix(grass,  beach,  (height - 0.45)   / (COASTAL  - 0.45)); }
    else if (height < PLAINS)   { c = mix(beach,  grass,  (height - COASTAL) / (PLAINS   - COASTAL)); }
    else if (height < HILLS)    { c = mix(grass,  forest, (height - PLAINS)  / (HILLS    - PLAINS)); }
    else if (height < MOUNTAIN) { c = mix(forest, rock,   (height - HILLS)   / (MOUNTAIN - HILLS)); }
    else                        { c = mix(rock,   snow,   (height - MOUNTAIN)/ (1.0      - MOUNTAIN)); }
    surf = mix(c, snow, max(pole, smoothstep(0.82, 0.88, height) * (1.0 - abs(lat) / (PI / 2.0))));
    surf = surf * (diff * DIFFUSE_SCALE + AMBIENT_LIGHT);
  } else {
    // PBR ocean: Fresnel + Blinn-Phong glint
    let VdotN   = max(dot(V, N), 0.0);
    let fresnel = schlickFresnel(VdotN, 0.02);
    let NdotL   = max(dot(N, sun_dir), 0.0);
    let base    = mix(vec3f(0.02, 0.08, 0.18), vec3f(0.05, 0.25, 0.40), 0.3);
    let diffuse = base * NdotL * (1.0 - fresnel);
    let H       = normalize(V + sun_dir);
    let NdotH   = max(dot(N, H), 0.0);
    let specPow = mix(200.0, 20.0, 0.1 + 0.2 * (1.0 - VdotN));
    let glint   = pow(NdotH, specPow) * fresnel * 2.0;
    let skyRef  = vec3f(0.4, 0.7, 1.0) * fresnel * 0.5;
    surf = mix(diffuse + vec3f(glint) + skyRef, vec3f(0.90, 0.92, 0.95), pole);
  }

  // Atmosphere limb glow
  let rim  = clamp(1.0 - abs(dot(N, V)), 0.0, 1.0);
  surf    += vec3f(0.20, 0.50, 1.0) * pow(rim, 1.8) * 0.36 * (1.0 - diff) * 0.7;

  // City lights: FBM-based coastal/latitude density
  let night      = smoothstep(0.06, -0.04, dot(N, sun_dir));
  let cityCoarse = fbmCity2(vec2f(lat * 6.0, lon * 8.0));
  let cityFine   = fbmCity2(vec2f(lat * 25.0 + 1.7, lon * 19.0 + 2.3));
  let coastBias  = smoothstep(0.44, 0.52, height) * (1.0 - smoothstep(0.52, 0.76, height));
  let absLat     = abs(lat) / (PI / 2.0);
  let latWeight  = smoothstep(0.07, 0.22, absLat) * (1.0 - smoothstep(0.60, 0.80, absLat));
  let cityDens   = f32(isLand) * coastBias * latWeight * smoothstep(0.38, 0.58, cityCoarse);
  let cityMask   = cityDens * (0.55 + 0.45 * cityFine);
  surf          += (vec3f(1.0, 0.78, 0.28) * cityMask
                  + vec3f(0.9, 0.95, 1.0) * pow(cityMask, 2.5) * 0.45) * night * 0.18;

  return surf;
}

//=================================================================================
// Earth Vertex Shader
//=================================================================================

@vertex
fn vs_earth(v: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.clip_position = uni.view_proj * vec4f(v.position, 1.0);
  out.world_pos = v.position;
  out.normal = v.normal;
  out.view_dir = normalize(uni.camera_pos.xyz - v.position);
  return out;
}

@vertex
fn vs(v: VertexInput) -> VertexOutput {
  return vs_earth(v);
}

//=================================================================================
// Earth Fragment Shader
//=================================================================================

@fragment
fn fs_earth(in: VertexOutput) -> @location(0) vec4f {
  let N       = normalize(in.normal);
  let sun_dir = normalize(uni.sun_pos.xyz);
  let V       = normalize(uni.camera_pos.xyz - in.world_pos);
  let color   = calculate_surface_color(N, sun_dir, V);
  return vec4f(color, 1.0);
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  return fs_earth(in);
}

//=================================================================================
// Atmosphere Shader
//=================================================================================

@vertex
fn vs_atm(v: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let p = v.position * ATM_SCALE;
  out.clip_position = uni.view_proj * vec4f(p, 1.0);
  out.world_pos = p;
  out.normal = v.normal;
  out.view_dir = normalize(uni.camera_pos.xyz - p);
  return out;
}

fn rayleigh_phase(cos_theta: f32) -> f32 {
  return (3.0 / (16.0 * PI)) * (1.0 + cos_theta * cos_theta);
}

fn atmospheric_density(altitude_km: f32) -> f32 {
  return exp(-altitude_km / RAYLEIGH_SCALE_HEIGHT);
}

@fragment
fn fs_atm(in: VertexOutput) -> @location(0) vec4f {
  let N       = normalize(in.normal);
  let V       = normalize(uni.camera_pos.xyz - in.world_pos);
  let sun_dir = normalize(uni.sun_pos.xyz);
  let cos_view = dot(N, V);
  let rim  = 1.0 - abs(cos_view);
  let limb  = pow(rim, 3.5);
  let limb2 = pow(rim, 7.0);
  let blue  = vec3f(0.08, 0.38, 1.0) * limb  * 2.8;
  let teal  = vec3f(0.0,  0.70, 0.45) * limb2 * 0.6;
  let color = blue + teal;
  let alpha = limb * 0.85;
  let sun_dot  = dot(V, sun_dir);
  let sun_glow = pow(max(sun_dot, 0.0), 8.0) * 0.3 * limb;
  return vec4f(color + vec3f(sun_glow), alpha);
}

//=================================================================================
// Horizon-Optimized Atmosphere (720km view)
//=================================================================================

@vertex
fn vs_atm_horizon(v: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let p = v.position * (ATM_SCALE * 1.05);
  out.clip_position = uni.view_proj * vec4f(p, 1.0);
  out.world_pos = p;
  out.normal = v.normal;
  out.view_dir = normalize(uni.camera_pos.xyz - p);
  return out;
}

@fragment
fn fs_atm_horizon(in: VertexOutput) -> @location(0) vec4f {
  let N        = normalize(in.normal);
  let V        = normalize(uni.camera_pos.xyz - in.world_pos);
  let cos_view = dot(N, V);
  let rim   = 1.0 - abs(cos_view);
  let limb  = pow(rim, 2.5);
  let limb2 = pow(rim, 5.0);
  let deep_blue = vec3f(0.05, 0.25, 0.95) * limb  * 3.5;
  let cyan      = vec3f(0.1,  0.80, 0.60) * limb2 * 1.2;
  let alpha = limb * 0.95;
  return vec4f(deep_blue + cyan, alpha);
}
