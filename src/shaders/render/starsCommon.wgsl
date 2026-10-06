// Shared by the procedural starfield (stars.wgsl) and the Hipparcos catalog
// points (starsCatalog.wgsl). Expects `uni` from "uniforms.wgsl" to be imported
// first. See docs/SKY.md.

struct AtmosphereSettings {
  scatteringEnabled: u32,
  _pad0: u32,
  hazeStrength: f32,
  _pad1: f32,
}

@group(0) @binding(1) var atmosphereLUT: texture_2d<f32>;
@group(0) @binding(2) var atmosphereSampler: sampler;
@group(0) @binding(3) var<uniform> atmosphereSettings: AtmosphereSettings;

const PI: f32 = 3.14159265;
const RAYLEIGH_COEFF = vec3f(5.8e-3, 13.5e-3, 33.1e-3);
const MIE_COEFF = vec3f(2.1e-2);
// Angular radius of Earth as seen from the Moon (~0.949°).
const EARTH_ANG_RAD: f32 = 0.01655;

// ── Blackbody color (Tanner Helland approximation, O/B/A/F/G/K/M range) ─────

fn blackbodyColor(temp:f32)->vec3f {
  let t = clamp(temp, 1000.0, 40000.0) / 1000.0;
  var r: f32 = 1.0;
  if (t > 6.6) { r = clamp(1.292 - 0.1292*t + 0.0054*t*t - 0.00007*t*t*t, 0.0, 1.0); }
  var g: f32;
  if (t <= 6.6) { g = clamp(0.04 + 0.319*t - 0.026*t*t + 0.0009*t*t*t, 0.0, 1.0); }
  else          { g = clamp(1.016 - 0.0638*t + 0.0014*t*t, 0.0, 1.0); }
  var b: f32;
  if      (t < 4.0) { b = clamp(0.07 * t, 0.0, 1.0); }
  else if (t < 6.6) { b = clamp(-1.839 + 0.839*t - 0.0956*t*t + 0.0036*t*t*t, 0.0, 1.0); }
  else              { b = 1.0; }
  return vec3f(r, g, b);
}

// Magnitude-weighted HDR cap — keeps the bulk of the field sub-bloom.
fn starHdrLuminance(mag: f32) -> f32 {
  let raw = pow(2.512, -mag) * 2.35;
  let cap = mix(1.25, 2.55, smoothstep(2.2, 0.2, mag));
  return min(raw, cap);
}

// ── Star catalog (?sky=hip) ──────────────────────────────────────────────────
//
// `frame_*` are the rows of the ICRS → render-frame rotation (identity under
// ?frame=gcrf&sun=astro, GCRF→TEME of date otherwise; src/render/SkyCatalog.ts).
// Only the catalog entry points touch group 1, so the procedural `fs` keeps its
// original pipeline layout.

struct SkyCatalogSettings {
  frame_x: vec4f,   // xyz = row 0, w = magnitude limit
  frame_y: vec4f,   // xyz = row 1, w = brightness gain
  frame_z: vec4f,   // xyz = row 2, w = point half-size (px)
  count: u32,
  flags: u32,
  _pad0: u32,
  _pad1: u32,
}

@group(1) @binding(1) var<uniform> skyCatalog: SkyCatalogSettings;

fn catalogToRender(d: vec3f) -> vec3f {
  return vec3f(dot(skyCatalog.frame_x.xyz, d), dot(skyCatalog.frame_y.xyz, d), dot(skyCatalog.frame_z.xyz, d));
}

fn renderToCatalog(d: vec3f) -> vec3f {
  return skyCatalog.frame_x.xyz * d.x + skyCatalog.frame_y.xyz * d.y + skyCatalog.frame_z.xyz * d.z;
}

// Ground-view attenuation and Moon-view dimming next to the Earth disk — the
// same factors the procedural `fs` applies to its star layers.
fn catalogStarScale(dir: vec3f) -> f32 {
  let isGroundView = ((uni.view_mode >> 16u) & 1u) == 1u;
  let isGroundBg = uni.background_mode == 2u;
  var s = select(1.0, 0.62, isGroundView || isGroundBg);
  if ((uni.view_mode & 0xFFFFu) == 4u) {
    let cosEarth = dot(dir, normalize(-uni.camera_pos.xyz));
    s *= mix(1.0, 0.22, smoothstep(cos(EARTH_ANG_RAD * 1.12), 0.99998, cosEarth));
  }
  return s;
}

fn skyModeBoost() -> f32 {
  return select(0.88, select(1.02, 1.05, uni.background_mode == 1u), uni.background_mode == 2u);
}

// Atmospheric extinction + reddening toward the horizon, as in `fs`. Uses an
// explicit LOD so it is valid outside uniform control flow.
fn skyExtinction(dir: vec3f) -> vec3f {
  if (atmosphereSettings.scatteringEnabled == 0u) { return vec3f(1.0); }
  let upDir = normalize(uni.camera_pos.xyz);
  let cosViewZenith = clamp(dot(dir, upDir), -1.0, 1.0);
  let cosSunZenith = clamp(dot(normalize(uni.sun_position.xyz), upDir), -1.0, 1.0);
  let lutUV = vec2f(cosViewZenith * 0.5 + 0.5, cosSunZenith * 0.5 + 0.5);
  let od = textureSampleLevel(atmosphereLUT, atmosphereSampler, lutUV, 0.0).rg;
  let transmittance = exp(-(RAYLEIGH_COEFF * od.r + MIE_COEFF * od.g));
  let sunOD = textureSampleLevel(atmosphereLUT, atmosphereSampler, vec2f(1.0, cosSunZenith * 0.5 + 0.5), 0.0).rg;
  let sunTint = exp(-(RAYLEIGH_COEFF * sunOD.r + MIE_COEFF * sunOD.g));
  let horizon = smoothstep(0.35, -0.15, cosViewZenith);
  let extinction = mix(vec3f(1.0), transmittance, clamp(atmosphereSettings.hazeStrength * horizon, 0.0, 1.0));
  let redden = mix(vec3f(1.0), sunTint, clamp(horizon * 0.8, 0.0, 0.8));
  return extinction * redden;
}
