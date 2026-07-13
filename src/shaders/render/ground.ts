/**
 * Ground View Horizon Shader
 *
 * Screen-space horizon reconstruction for Ground View. Instead of drawing the
 * full Earth sphere mesh, a single fullscreen quad ray-traces the Earth from
 * the observer position:
 *
 *  - The per-pixel view ray is rebuilt from the shared view_proj matrix
 *    (camera basis + FOV extracted from the matrix rows).
 *  - Rays that hit the Earth sample the same procedural FBM terrain, biome
 *    palette, and city-light clusters as the orbital Earth shader
 *    (terrainCommon.ts), so the horizon matches the photoreal globe.
 *  - Rays that miss get a physically-plausible sky: twilight scattering,
 *    a low-altitude Mie haze band hugging the horizon (atmosphere LUT when
 *    enabled), and a night-side city-light glow band along the horizon.
 *  - Preset bias uniforms (GroundParams) shift the treatment per observer
 *    preset: ocean bias for the beach, urban glow for the rooftop, and an
 *    overlay fade that dims the pass where the CSS frame covers the frame.
 *
 * Sky pixels output low alpha so the starfield drawn beneath shows through.
 */

import { UNIFORM_STRUCT } from '../uniforms.js';
import { TERRAIN_COMMON } from './terrainCommon.js';

export const GROUND_TERRAIN =
  UNIFORM_STRUCT +
  TERRAIN_COMMON +
  /* wgsl */ `
struct AtmosphereSettings {
  scatteringEnabled: u32,
  _pad0: u32,
  hazeStrength: f32,
  _pad1: f32,
}

struct GroundParams {
  ocean_bias   : f32,  // >0 sinks terrain toward ocean (beach preset)
  urban_glow   : f32,  // night city-light glow strength near the horizon
  overlay_fade : f32,  // fades the pass where the CSS frame overlay covers it
  haze_boost   : f32,  // low-altitude Mie haze multiplier (per-preset)
}

@group(0) @binding(1) var atmosphereLUT: texture_2d<f32>;
@group(0) @binding(2) var atmosphereSampler: sampler;
@group(0) @binding(3) var<uniform> atmosphereSettings: AtmosphereSettings;
@group(0) @binding(4) var<uniform> ground: GroundParams;

const EARTH_R: f32 = 6371.0;

struct VOut {
  @builtin(position) cp : vec4f,
  @location(0) uv       : vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> VOut {
  const quad = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0,  1.0), vec2f(1.0, -1.0), vec2f( 1.0, 1.0)
  );

  var out: VOut;
  out.cp = vec4f(quad[vi], 0.0, 1.0);
  out.uv = quad[vi] * 0.5 + 0.5;
  return out;
}

// Rebuild the world-space view ray for a pixel from the view_proj matrix.
//
// view_proj = P * V with P a standard perspective matrix (last row [0,0,-1,0])
// and V an orthonormal lookAt. Therefore, taking rows of the upper 3x4:
//   row_w(xyz) = -viewRow2       = camera forward (unit)
//   row_x(xyz) = P00 * viewRow0  → normalize = camera right, 1/|row_x| = tan(fovX/2)
//   row_y(xyz) = P11 * viewRow1  → normalize = camera up,    1/|row_y| = tan(fovY/2)
fn viewRay(uv: vec2f) -> vec3f {
  let ndc = uv * 2.0 - 1.0;
  let m = uni.view_proj;
  let rowX = vec3f(m[0].x, m[1].x, m[2].x);
  let rowY = vec3f(m[0].y, m[1].y, m[2].y);
  let rowW = vec3f(m[0].w, m[1].w, m[2].w);
  let tanX = 1.0 / length(rowX);
  let tanY = 1.0 / length(rowY);
  return normalize(normalize(rowW)
    + ndc.x * tanX * normalize(rowX)
    + ndc.y * tanY * normalize(rowY));
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let rd = viewRay(in.uv);
  let ro = uni.camera_pos.xyz;
  let up = normalize(ro);
  let sunDir = normalize(uni.sun_position.xyz);
  let sunElev = dot(up, sunDir);          // sun elevation at the observer
  let cosVZ = dot(rd, up);                // view-zenith cosine
  let day = smoothstep(-0.08, 0.25, sunElev);
  let night = smoothstep(0.02, -0.10, sunElev);
  let twilight = smoothstep(-0.28, -0.05, sunElev) * (1.0 - smoothstep(-0.02, 0.14, sunElev));

  // Ray–sphere intersection against the Earth
  let b = dot(ro, rd);
  let c = dot(ro, ro) - EARTH_R * EARTH_R;
  let disc = b * b - c;
  let t = -b - sqrt(max(disc, 0.0));
  let hitsGround = disc > 0.0 && t > 0.0;

  var color: vec3f;
  var alpha: f32;

  if (hitsGround) {
    // ── Terrain: same body-frame sampling as the orbital Earth shader ──────
    let p = ro + rd * t;
    let N = p / EARTH_R;

    let earthRotAngle = 2.0 * PI * uni.sim_time / EARTH_SIDEREAL_PERIOD;
    let cosR = cos(earthRotAngle);
    let sinR = sin(earthRotAngle);
    let wp_rot = vec3f(
      N.x * cosR - N.y * sinR,
      N.x * sinR + N.y * cosR,
      N.z
    );

    let lat = asin(clamp(wp_rot.z, -1.0, 1.0));
    let lon = atan2(wp_rot.y, wp_rot.x);

    // Preset ocean bias sinks the terrain so beaches face open water
    let height = clamp(fbmTerrain(wp_rot * 3.0, 4) - ground.ocean_bias, 0.0, 1.0);
    let sunDot = dot(N, sunDir);
    let isLand = height > 0.45;

    var surf: vec3f;
    if (isLand) {
      // Cheap slope estimate from one offset FBM sample (forward difference)
      let eps = 0.01;
      let hX = fbmTerrain(normalize(wp_rot + vec3f(eps, 0.0, 0.0)) * 3.0, 4);
      let hY = fbmTerrain(normalize(wp_rot + vec3f(0.0, eps, 0.0)) * 3.0, 4);
      let gradient = vec2f(hX - height - ground.ocean_bias, hY - height - ground.ocean_bias) / eps;
      let slope = clamp(length(gradient) * 0.7, 0.0, 1.0);

      surf = biomeColor(height, lat, slope);

      // Polar/altitude snow, matching the orbital shader
      let pole = smoothstep(1.1, 1.4, abs(lat));
      let snowLine = smoothstep(0.82, 0.88, height) * (1.0 - abs(lat) / (PI / 2.0));
      surf = mix(surf, vec3f(0.90, 0.92, 0.95), max(pole, snowLine));

      // Terrain-perturbed lighting
      let terrNormBody = normalize(vec3f(-gradient.x, -gradient.y, 1.0));
      let terrNormECI = vec3f(
        terrNormBody.x * cosR + terrNormBody.y * sinR,
       -terrNormBody.x * sinR + terrNormBody.y * cosR,
        terrNormBody.z
      );
      let modN = normalize(N + terrNormECI * 0.3);
      let NdotL = max(dot(modN, sunDir), 0.0);
      surf = surf * (NdotL * 0.92 + 0.05);
    } else {
      // Ocean: Fresnel + sun glint + animated shimmer (beach preset)
      let w1 = noise3d(wp_rot * 700.0 + vec3f(uni.time * 0.5)) - 0.5;
      let w2 = noise3d(wp_rot * 1300.0 - vec3f(uni.time * 0.7)) - 0.5;
      let Nw = normalize(N + vec3f(w1, w2, w1 * w2) * 0.10);
      let VdotN = max(dot(-rd, Nw), 0.0);
      let fresnel = schlickFresnel(VdotN, 0.02);
      let NdotL = max(dot(Nw, sunDir), 0.0);

      let deepColor = vec3f(0.02, 0.08, 0.18);
      let shallowColor = vec3f(0.05, 0.25, 0.40);
      surf = mix(deepColor, shallowColor, 0.3) * (NdotL * 0.85 + 0.05);

      // Sun glint
      let H = normalize(-rd + sunDir);
      surf += vec3f(1.0, 0.85, 0.6) * pow(max(dot(Nw, H), 0.0), 180.0) * fresnel * 3.0;

      // Night sky/starlight sparkle on the swell — the beach shimmer
      let sparkle = smoothstep(0.78, 0.98,
        noise3d(wp_rot * 4200.0 + vec3f(uni.time * 1.7, 0.0, -uni.time * 1.3)));
      surf += vec3f(0.35, 0.45, 0.60) * sparkle * fresnel * night * 0.6;

      // Sky reflection
      surf += mix(vec3f(0.02, 0.03, 0.07), vec3f(0.40, 0.55, 0.80), day) * fresnel * 0.5;
    }

    // Twilight band along the terminator
    let twilightBand = smoothstep(-TWILIGHT_COS_HALF, 0.0, sunDot)
      * (1.0 - smoothstep(0.0, TWILIGHT_COS_HALF, sunDot));
    surf += vec3f(1.0, 0.38, 0.08) * twilightBand * 0.22;

    // Night-side city lights, boosted by the preset urban glow
    surf += cityLightEmission(lat, lon, height, isLand, sunDot) * (1.0 + ground.urban_glow * 1.6);

    // ── Aerial perspective: distance haze toward the limb ──────────────────
    let hazeAmt = clamp((1.0 - exp(-t * 0.0018)) * ground.haze_boost, 0.0, 1.0);
    var hazeColor = mix(vec3f(0.020, 0.032, 0.065), vec3f(0.42, 0.56, 0.80), day);
    hazeColor += vec3f(0.85, 0.32, 0.10) * twilight * 0.5;

    if (atmosphereSettings.scatteringEnabled != 0u) {
      let lutUV = vec2f(clamp(cosVZ, -1.0, 1.0) * 0.5 + 0.5, clamp(sunElev, -1.0, 1.0) * 0.5 + 0.5);
      // textureSampleLevel: this branch is non-uniform (per-pixel ray hit)
      let od = textureSampleLevel(atmosphereLUT, atmosphereSampler, lutUV, 0.0).rg;
      let transmittance = exp(-(RAYLEIGH_COEFF * od.r + MIE_COEFF * od.g));
      surf *= mix(vec3f(1.0), transmittance, hazeAmt * atmosphereSettings.hazeStrength);
    }

    color = mix(surf, hazeColor, hazeAmt * 0.55);
    alpha = 1.0;
  } else {
    // ── Sky: haze band, twilight scatter, and night city glow at the horizon ──
    // True horizon dip for the observer altitude
    let cosH = -sqrt(max(1.0 - (EARTH_R * EARTH_R) / dot(ro, ro), 0.0));
    let band = exp(-max(cosVZ - cosH, 0.0) * 14.0);

    let skyDay = vec3f(0.16, 0.34, 0.68);
    let skyNight = vec3f(0.008, 0.014, 0.038);
    var sky = mix(skyNight, skyDay, day) * (0.22 + 0.78 * band);

    // Twilight glow, strongest toward the sun's azimuth
    let sunH = sunDir - up * sunElev;
    let rdH = rd - up * cosVZ;
    let toward = max(dot(normalize(sunH + vec3f(1e-5)), normalize(rdH + vec3f(1e-5))), 0.0);
    sky += vec3f(1.0, 0.42, 0.14) * twilight * band * (0.25 + 0.75 * pow(toward, 3.0)) * 0.9;

    // Night-side city-light band: clumpy warm glow hugging the horizon,
    // matching the Earth shader's night lights in tone
    let north = normalize(vec3f(0.0, 0.0, 1.0) - up * up.z + vec3f(1e-5));
    let east = cross(north, up);
    let azim = atan2(dot(rdH, east), dot(rdH, north));
    let clump = fbmCity(vec2f(azim * 3.0 + uni.sim_time * 0.00007, 1.7));
    let cityBand = smoothstep(0.35, 0.75, clump) * band * band * night;
    sky += vec3f(1.0, 0.62, 0.26) * cityBand * (0.12 + ground.urban_glow * 0.55);
    sky += vec3f(0.30, 0.24, 0.34) * band * band * night * ground.urban_glow * 0.20;

    // Low-altitude Mie haze via the atmosphere LUT
    if (atmosphereSettings.scatteringEnabled != 0u) {
      let lutUV = vec2f(clamp(cosVZ, -1.0, 1.0) * 0.5 + 0.5, clamp(sunElev, -1.0, 1.0) * 0.5 + 0.5);
      let od = textureSampleLevel(atmosphereLUT, atmosphereSampler, lutUV, 0.0).rg;
      let mieGlow = 1.0 - exp(-od.g * MIE_COEFF);
      sky += mieGlow * band * atmosphereSettings.hazeStrength * ground.haze_boost
        * mix(vec3f(0.25, 0.30, 0.45), vec3f(1.0, 0.85, 0.65), day);
    }

    color = sky;
    // Opaque haze at the horizon; transparent higher up so stars show through
    alpha = clamp(band * (0.55 + 0.35 * ground.haze_boost) + day * 0.55 + twilight * 0.25, 0.0, 1.0);
  }

  // Fade the pass where the CSS frame overlay (house sill, car dashboard)
  // covers the lower part of the frame
  let fade = ground.overlay_fade * (1.0 - smoothstep(0.08, 0.42, in.uv.y));
  alpha *= 1.0 - fade;

  return vec4f(color, alpha);
}
`;
