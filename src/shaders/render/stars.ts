/**
 * Cinematic Starfield Background Shader
 *
 * Features:
 *  - Camera-direction-based sky ray reconstruction so stars and the Milky Way
 *    rotate correctly with camera orientation (no more screen-space tiling).
 *  - Magnitude-based brightness (Pogson's law) with realistic stellar density.
 *  - Full O/B/A/F/G/K/M spectral-type color temperature via blackbody curve.
 *  - Procedural Milky Way band keyed on galactic coordinates of the view ray.
 *  - Subtle TAA-friendly twinkling driven by uni.time + per-star hash offset.
 *  - HDR output values (no clamp to 1) so bright stars drive bloom correctly.
 */

import { UNIFORM_STRUCT } from '../uniforms.js';

export const STARS_SHADER = UNIFORM_STRUCT + /* wgsl */ `
struct VSOut { @builtin(position) pos:vec4f, @location(0) uv:vec2f };

struct AtmosphereSettings {
  scatteringEnabled: u32,
  _pad0: u32,
  hazeStrength: f32,
  _pad1: f32,
}

@group(0) @binding(1) var atmosphereLUT: texture_2d<f32>;
@group(0) @binding(2) var atmosphereSampler: sampler;
@group(0) @binding(3) var<uniform> atmosphereSettings: AtmosphereSettings;

@vertex fn vs(@builtin(vertex_index) vi:u32) -> VSOut {
  const pts = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
  var o:VSOut;
  o.pos = vec4f(pts[vi],0,1);
  o.uv  = pts[vi]*0.5 + 0.5;
  return o;
}

const PI: f32 = 3.14159265;
const RAYLEIGH_COEFF = vec3f(5.8e-3, 13.5e-3, 33.1e-3);
const MIE_COEFF = vec3f(2.1e-2);
// Angular radius of Earth as seen from the Moon (~0.949°).
const EARTH_ANG_RAD: f32 = 0.01655;

// ── Hash / noise ─────────────────────────────────────────────────────────────

fn hash2(p:vec2f)->f32 {
  return fract(sin(dot(p,vec2f(127.1,311.7)))*43758.5453);
}

fn hash3d(p:vec3f)->f32 {
  return fract(sin(dot(p,vec3f(127.1,311.7,74.7)))*43758.5453);
}

fn noise3d(p:vec3f)->f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3d(i+vec3f(0,0,0)), hash3d(i+vec3f(1,0,0)), u.x),
        mix(hash3d(i+vec3f(0,1,0)), hash3d(i+vec3f(1,1,0)), u.x), u.y),
    mix(mix(hash3d(i+vec3f(0,0,1)), hash3d(i+vec3f(1,0,1)), u.x),
        mix(hash3d(i+vec3f(0,1,1)), hash3d(i+vec3f(1,1,1)), u.x), u.y),
    u.z
  );
}

fn fbm(p:vec3f)->f32 {
  var v = 0.0; var amp = 0.5; var freq = 1.0; var mx = 0.0;
  for (var i=0; i<4; i++) {
    v  += amp * noise3d(p * freq);
    mx += amp;
    amp  *= 0.5;
    freq *= 2.0;
  }
  return v / mx;
}

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

// ── Camera-space sky direction ────────────────────────────────────────────────
//
// Reconstructs the world-space ray for a fullscreen-triangle pixel using the
// camera right/up vectors supplied in the uniform buffer.
//
// Derivation: in mat4lookAt, r = cross(f, up_world) and u = cross(r, f), so
// cross(u, r) = cross(r, cross(r, f)) = r*(r.f) - f*(r.r) = -f, therefore
// f = -cross(u,r) = cross(up, right).  Verified for the right-handed lookAt.
//
// The NDC x/y are left unscaled (no FOV division) which is fine: normalize()
// produces the correct angular direction and stars are anchored in sky space.

fn skyDir(uv:vec2f) -> vec3f {
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let right   = uni.camera_right.xyz;
  let up      = uni.camera_up.xyz;
  let forward = normalize(cross(up, right));
  return normalize(forward + ndc.x * right + ndc.y * up);
}

// ── Milky Way ─────────────────────────────────────────────────────────────────
//
// Takes the world-space view ray (not screen UV) so the band rotates correctly
// with camera orientation.  Galactic pole and center vectors are ICRS J2000.

fn renderMilkyWay(dir:vec3f) -> vec3f {
  let galNorth  = normalize(vec3f(-0.0548,  0.4941, 0.8677));
  let galCenter = normalize(vec3f(-0.0558, -0.8744, 0.4821));

  let galLat = asin(clamp(dot(dir, galNorth), -1.0, 1.0));
  let proj   = normalize(dir - galNorth * dot(dir, galNorth) + vec3f(0.0001));
  let galLon = atan2(dot(proj, cross(galNorth, galCenter)),
                     dot(proj, galCenter));

  // Gaussian vertical profile (σ ≈ 8.6°) + radial intensity toward the centre
  let vertProfile   = exp(-galLat * galLat / (2.0 * 0.15 * 0.15));
  let r             = length(vec2f(cos(galLon) - 0.1, sin(galLon)));
  let radialProfile = 0.3 * exp(-r * 3.0) + 0.7 * exp(-r * 0.8);

  // Procedural dust-lane detail
  let noiseCoord = dir * 8.0 + vec3f(100.0);
  let detail     = fbm(noiseCoord) * 0.4 + 0.6;

  let bandColor = mix(vec3f(0.9, 0.85, 0.7), vec3f(0.75, 0.8, 1.0), clamp(r, 0.0, 1.0));
  let intensity = vertProfile * radialProfile * detail * 0.18;
  return bandColor * intensity;
}

// ── Horizon atmospheric glow ──────────────────────────────────────────────────

fn horizonFog(uv:vec2f, mode:u32) -> vec3f {
  let glow         = pow(max(0.0, 0.38 - uv.y), 2.8);
  let horizonColor = vec3f(0.26, 0.16, 0.08);
  let warm         = vec3f(0.20, 0.12, 0.06);
  let cold         = vec3f(0.07, 0.09, 0.16);
  let horizonScale = select(0.0, 0.42, mode == 1u) + select(0.0, 0.88, mode == 2u);
  let glowLayer    = horizonColor * glow * horizonScale;
  let scatter      = mix(cold, warm, smoothstep(0.55, 0.90, uv.y));
  let scatterStr   = pow(clamp(1.0 - uv.y * 1.2, 0.0, 1.0), 2.6)
                     * select(0.18, 0.32, mode == 1u)
                     + select(0.0, 0.22, mode == 2u);
  return scatter * scatterStr + glowLayer;
}

// ── Star layer (sky-space tiling) ─────────────────────────────────────────────
//
// Stars are keyed on spherical (elevation, azimuth) coordinates of the view
// ray, so they remain fixed on the celestial sphere regardless of camera yaw/
// pitch/roll.  cellsPerRad controls angular density.
//
// Brightness follows Pogson's law: E = 2.512^(-mag).
// Twinkling amplitude is kept ≤ 8 % per layer so it stays TAA-friendly.

fn starLayer(dir:vec3f, cellsPerRad:f32, density:f32, twinklePower:f32) -> vec3f {
  let phi   = asin(clamp(dir.y, -1.0, 1.0));         // elevation  [-PI/2, PI/2]
  let theta = atan2(dir.z, dir.x);                    // azimuth    [-PI,   PI  ]
  let cell  = floor(vec2f(theta, phi) * cellsPerRad);

  let a = hash2(cell);
  let b = hash2(cell + vec2f(1.0, 0.0));
  let c = hash2(cell + vec2f(0.0, 1.0));

  // Magnitude 0.5–7.0 distribution weighted toward faint end (more dim stars)
  let mag  = mix(0.5, 7.0, pow(a, 0.55));
  let prob = pow(2.512, -mag) * density;
  let starMask = f32(b < prob);

  // HDR luminance: cap so only the brightest stars pierce bloom threshold 1.5;
  // satellite cores (boosted ~3.5+) remain the dominant bloom drivers.
  let hdrLum = starHdrLuminance(mag);

  // Spectral type temperature: O (30 000 K) through M (3 000 K)
  // Weight distribution realistically toward cooler K/M types
  let temperature = mix(3000.0, 30000.0, pow(a, 3.0));
  let color       = blackbodyColor(temperature);

  // TAA-friendly twinkling: slow frequencies, small amplitude (≤ 8 %)
  let twinkle = 1.0
    + twinklePower * 0.08 * sin(uni.time * (0.4 + b * 1.2) + a * 19.0)
    + twinklePower * 0.04 * sin(uni.time * (1.1 + c * 1.8) + b * 23.0);

  return color * hdrLum * starMask * twinkle;
}

// Magnitude-weighted HDR cap — keeps the bulk of the field sub-bloom.
fn starHdrLuminance(mag: f32) -> f32 {
  let raw = pow(2.512, -mag) * 2.35;
  let cap = mix(1.25, 2.55, smoothstep(2.2, 0.2, mag));
  return min(raw, cap);
}

// ── Fragment entry point ──────────────────────────────────────────────────────

@fragment fn fs(in:VSOut) -> @location(0) vec4f {
  // World-space sky direction for this pixel
  let dir = skyDir(in.uv);

  // Deep-space background gradient (very dark blue-black)
  let sky = mix(vec3f(0.0, 0.005, 0.015), vec3f(0.01, 0.02, 0.05),
                pow(clamp(in.uv.y, 0.0, 1.0), 1.7));

  // ── Stars: four layers spanning magnitudes 0–7 ──────────────────────────
  // cellsPerRad values: 1 rad ≈ 57° → scale sets angular star density
  //   ~480 cells/rad ≈ 0.12° per cell  (bright/sparse)
  //   ~960 cells/rad ≈ 0.06° per cell  (medium)
  //   ~1920 cells/rad ≈ 0.03° per cell (faint/dense)
  var stars = vec3f(0.0);
  stars += starLayer(dir,  240.0, 0.06, 1.0);   // sparse, bright  (high HDR lum)
  stars += starLayer(dir,  480.0, 0.20, 0.9);   // medium density
  stars += starLayer(dir,  960.0, 0.40, 0.6);   // dense, dimmer
  stars += starLayer(dir, 1920.0, 0.55, 0.3);   // very dense faint background

  // Milky Way — visible but capped so it does not flood the bloom buffer
  let milkyWay = renderMilkyWay(dir) * 1.45;
  let mwLum = dot(milkyWay, vec3f(0.2126, 0.7152, 0.0722));
  stars += milkyWay * min(1.0, 1.25 / max(mwLum, 0.01));

  // ── Atmospheric horizon glow ─────────────────────────────────────────────
  let atmosphere = horizonFog(in.uv, uni.background_mode);

  // Ground view: attenuate star HDR so Earth overlay is not washed out
  let isGroundView = ((uni.view_mode >> 16u) & 1u) == 1u;
  let isGroundBg = uni.background_mode == 2u;
  let groundStarScale = select(1.0, 0.62, isGroundView || isGroundBg);
  stars *= groundStarScale;

  // Moon View: soft blue-marble disk glow + star dimming near Earth for dynamic range.
  let isMoonView = (uni.view_mode & 0xFFFFu) == 4u;
  if (isMoonView) {
    let toEarth = normalize(-uni.camera_pos.xyz);
    let cosEarth = dot(dir, toEarth);
    let earthDiskGlow = smoothstep(cos(EARTH_ANG_RAD * 1.6), cos(EARTH_ANG_RAD * 0.75), cosEarth);
    sky += vec3f(0.08, 0.16, 0.32) * earthDiskGlow * 1.35;
    let earthDiskCos = cos(EARTH_ANG_RAD * 1.12);
    let earthMask = smoothstep(earthDiskCos, 0.99998, cosEarth);
    stars *= mix(1.0, 0.22, earthMask);
  }

  // ── Compose – HDR output; bright stars bloom, bulk stays sub-threshold ─────
  let modeBoost = select(0.88, select(1.02, 1.05, uni.background_mode == 1u),
                         uni.background_mode == 2u);
  var color = sky + stars * 1.02 + atmosphere;
  color *= modeBoost;

  if (atmosphereSettings.scatteringEnabled != 0u) {
    let upDir = normalize(uni.camera_pos.xyz);
    let cosViewZenith = clamp(dot(dir, upDir), -1.0, 1.0);
    let cosSunZenith = clamp(dot(normalize(uni.sun_position.xyz), upDir), -1.0, 1.0);
    let lutUV = vec2f(cosViewZenith * 0.5 + 0.5, cosSunZenith * 0.5 + 0.5);
    let od = textureSample(atmosphereLUT, atmosphereSampler, lutUV).rg;
    let transmittance = exp(-(RAYLEIGH_COEFF * od.r + MIE_COEFF * od.g));
    let sunOD = textureSample(atmosphereLUT, atmosphereSampler, vec2f(1.0, cosSunZenith * 0.5 + 0.5)).rg;
    let sunTint = exp(-(RAYLEIGH_COEFF * sunOD.r + MIE_COEFF * sunOD.g));
    let horizon = smoothstep(0.35, -0.15, cosViewZenith);
    let extinction = mix(vec3f(1.0), transmittance, clamp(atmosphereSettings.hazeStrength * horizon, 0.0, 1.0));
    let redden = mix(vec3f(1.0), sunTint, clamp(horizon * 0.8, 0.0, 0.8));
    color *= extinction * redden;
  }

  // Soft gamma lift (keeps very dark regions slightly luminous)
  color = pow(max(color, vec3f(0.0)), vec3f(0.96, 0.97, 0.99));

  // Return HDR (values > 1 are intentional; brightest stars only)
  return vec4f(color, 1.0);
}
`;
