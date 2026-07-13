/**
 * Earth Sphere Shader
 * FBM terrain with biomes, PBR ocean with Fresnel + sun glint, city lights
 */

import { UNIFORM_STRUCT } from '../uniforms.js';
import { TERRAIN_COMMON } from './terrainCommon.js';

export const EARTH_SHADER =
  UNIFORM_STRUCT +
  TERRAIN_COMMON +
  /* wgsl */ `
struct VIn  { @location(0) pos:vec3f, @location(1) nrm:vec3f }
struct VOut { @builtin(position) cp:vec4f, @location(0) wp:vec3f, @location(1) n:vec3f }

struct AtmosphereSettings {
  scatteringEnabled: u32,
  _pad0: u32,
  hazeStrength: f32,
  _pad1: f32,
}

@group(0) @binding(1) var atmosphereLUT: texture_2d<f32>;
@group(0) @binding(2) var atmosphereSampler: sampler;
@group(0) @binding(3) var<uniform> atmosphereSettings: AtmosphereSettings;

@vertex fn vs(v:VIn) -> VOut {
  var o:VOut;
  o.cp = uni.view_proj * vec4f(v.pos,1);
  o.wp = v.pos;
  o.n  = v.nrm;
  return o;
}

// Two-octave animated cloud noise (cheap: 2 octaves only)
fn cloudNoise(pos: vec3f, time: f32) -> f32 {
  let p0 = pos * 2.8 + vec3f(time * 0.006, time * 0.004, 0.0);
  let p1 = pos * 5.6 + vec3f(time * 0.009, 0.0, time * 0.003);
  return noise3d(p0) * 0.6 + noise3d(p1) * 0.4;
}

// Gerstner wave contribution for ocean normals
fn gerstnerWave(pos2d:vec2f, dir:vec2f, wavelength:f32, amplitude:f32, time:f32)->vec3f {
  let k = 2.0 * PI / wavelength;
  let c = sqrt(9.8 / k);
  let phase = k * (dot(dir, pos2d) - c * time);
  return vec3f(dir.x * amplitude * cos(phase), amplitude * sin(phase), dir.y * amplitude * cos(phase));
}

fn getOceanNormal(worldPos:vec3f, time:f32)->vec3f {
  let lat = asin(clamp(worldPos.z / length(worldPos), -1.0, 1.0));
  let lon = atan2(worldPos.y, worldPos.x);
  let pos2d = vec2f(lon * 6371.0, lat * 6371.0);

  var wavePos = vec3f(0.0);
  wavePos += gerstnerWave(pos2d, normalize(vec2f(1.0, 0.3)), 2000.0, 15.0, time * 0.05);
  wavePos += gerstnerWave(pos2d, normalize(vec2f(0.8, 0.6)), 800.0, 6.0, time * 0.08);
  wavePos += gerstnerWave(pos2d, normalize(vec2f(0.3, 0.9)), 300.0, 2.0, time * 0.12);
  wavePos += gerstnerWave(pos2d, normalize(vec2f(0.5, 0.5)), 100.0, 0.5, time * 0.2);

  let tangent = normalize(vec3f(1.0, 0.0, wavePos.x / 100.0));
  let bitangent = normalize(vec3f(0.0, 1.0, wavePos.z / 100.0));
  return normalize(cross(tangent, bitangent));
}

fn oceanColor(worldPos:vec3f, normal:vec3f, viewDir:vec3f, sunDir:vec3f, time:f32)->vec3f {
  let waveNormal = getOceanNormal(worldPos, time);
  let N = normalize(normal + waveNormal * 0.3);

  // Fresnel reflectance
  let VdotN = max(dot(viewDir, N), 0.0);
  let fresnel = schlickFresnel(VdotN, 0.02);

  // Base ocean color with depth variation
  let deepColor = vec3f(0.02, 0.08, 0.18);
  let shallowColor = vec3f(0.05, 0.25, 0.40);
  let baseColor = mix(deepColor, shallowColor, 0.3);

  // Diffuse lighting
  let NdotL = max(dot(N, sunDir), 0.0);
  let diffuse = baseColor * NdotL * (1.0 - fresnel);

  // Sun glint (Blinn-Phong)
  let H = normalize(viewDir + sunDir);
  let NdotH = max(dot(N, H), 0.0);
  let roughness = 0.1 + 0.2 * (1.0 - VdotN);
  let specPower = mix(200.0, 20.0, roughness);
  let specular = pow(NdotH, specPower) * fresnel * 2.0;

  // Environment reflection (sky color approximation)
  let skyColor = vec3f(0.4, 0.7, 1.0);
  let reflection = skyColor * fresnel * 0.5;

  return diffuse + vec3f(specular) + reflection;
}

@fragment fn fs(in:VOut) -> @location(0) vec4f {
  let N       = normalize(in.n);
  let sun_dir = normalize(uni.sun_position.xyz);
  let V       = normalize(uni.camera_pos.xyz - in.wp);

  // Earth sidereal rotation: one full turn every 86164 seconds.
  // Rotate the surface sampling position around Z in body frame while
  // keeping the ECI sphere normal (N) unchanged for correct sun lighting.
  let earthRotAngle = 2.0 * PI * uni.sim_time / EARTH_SIDEREAL_PERIOD;
  let cosR = cos(earthRotAngle);
  let sinR = sin(earthRotAngle);
  let wp_norm = normalize(in.wp);
  let wp_rot = vec3f(
    wp_norm.x * cosR - wp_norm.y * sinR,
    wp_norm.x * sinR + wp_norm.y * cosR,
    wp_norm.z
  );

  // Latitude/longitude from body-frame rotated position (for terrain, cities, clouds)
  let lat = asin(clamp(wp_rot.z, -1.0, 1.0));
  let lon = atan2(wp_rot.y, wp_rot.x);

  // FBM terrain height sampled in body frame (rotates with the Earth)
  let terrainPos = wp_rot * 3.0;
  let height = fbmTerrain(terrainPos, 4);

  // Sun–surface dot product (in ECI frame for correct terminator)
  let sunDot = dot(N, sun_dir);
  let diff   = max(sunDot, 0.0);

  // Determine land vs ocean
  let isLand = height > 0.45;

  // Ice caps (polar regions + high altitude)
  let pole = smoothstep(1.1, 1.4, abs(lat));
  let snowLine = smoothstep(0.82, 0.88, height) * (1.0 - abs(lat) / (PI / 2.0));

  var surf: vec3f;
  if (isLand) {
    // Terrain normal from body-frame height gradient for self-shadowing
    let eps = 0.01;
    let hL = fbmTerrain(normalize(vec3f(wp_rot.x - eps, wp_rot.y, wp_rot.z)) * 3.0, 4);
    let hR = fbmTerrain(normalize(vec3f(wp_rot.x + eps, wp_rot.y, wp_rot.z)) * 3.0, 4);
    let hD = fbmTerrain(normalize(vec3f(wp_rot.x, wp_rot.y - eps, wp_rot.z)) * 3.0, 4);
    let hU = fbmTerrain(normalize(vec3f(wp_rot.x, wp_rot.y + eps, wp_rot.z)) * 3.0, 4);
    let gradient = vec2f(hR - hL, hU - hD) / (2.0 * eps);
    let terrNormBody = normalize(vec3f(-gradient.x, -gradient.y, 1.0));
    // Rotate terrain normal back to ECI frame for correct lighting
    let terrNormECI = vec3f(
      terrNormBody.x * cosR + terrNormBody.y * sinR,
     -terrNormBody.x * sinR + terrNormBody.y * cosR,
      terrNormBody.z
    );
    let modN = normalize(N + terrNormECI * 0.3);

    // Slope from terrain gradient magnitude
    let slope = 1.0 - abs(dot(terrNormBody, vec3f(0.0, 0.0, 1.0)));

    // Get biome color
    surf = biomeColor(height, lat, slope);

    // Apply ice/snow
    surf = mix(surf, vec3f(0.90, 0.92, 0.95), max(pole, snowLine));

    // Lighting with terrain-modulated normal
    let NdotL = max(dot(modN, sun_dir), 0.0);
    surf = surf * (NdotL * 0.92 + 0.04);
  } else {
    // PBR Ocean with Fresnel and sun glint
    surf = oceanColor(in.wp, N, V, sun_dir, uni.time);
    surf = mix(surf, vec3f(0.90, 0.92, 0.95), pole);
  }

  // Soft terminator: orange-red atmospheric twilight scattering at the day/night boundary
  let twilightBand = smoothstep(-TWILIGHT_COS_HALF, 0.0, sunDot) * (1.0 - smoothstep(0.0, TWILIGHT_COS_HALF, sunDot));
  surf += vec3f(1.0, 0.38, 0.08) * twilightBand * 0.22;

  // City lights: FBM-based for plausible coastal/river density patterns
  // (shared with the Ground View horizon shader via cityLightEmission).
  let cityWarm = cityLightEmission(lat, lon, height, isLand, sunDot);

  let viewDir = normalize(uni.camera_pos.xyz - in.wp);
  let horizonFactor = clamp(1.0 - abs(dot(N, viewDir)), 0.0, 1.0);
  // Atmosphere limb glow: blue on the day side, dim on the night side
  let dayAtm   = vec3f(0.20, 0.50, 1.0) * diff;
  let nightAtm = vec3f(0.05, 0.08, 0.18) * (1.0 - diff);
  surf += (dayAtm + nightAtm) * pow(horizonFactor, 1.8) * 0.36 * 0.7;

  // Procedural animated cloud layer (2-octave, cheap).
  // Sampled from body-frame rotated position and driven by sim_time so cloud
  // motion is visible at any time scale (not just real-time).
  let cloudSample = cloudNoise(wp_rot, uni.sim_time);
  let cloudAlpha = smoothstep(0.44, 0.62, cloudSample);
  // Forward-scatter brightening on cloud edges facing the sun
  let cloudEdge = smoothstep(0.62, 0.80, cloudSample) * (1.0 - cloudAlpha);
  let cloudLit = max(sunDot, 0.0);
  let cloudColor = vec3f(0.92, 0.94, 0.97) * (cloudLit * 0.85 + 0.15);
  let cloudEdgeColor = cloudColor + vec3f(0.4, 0.35, 0.2) * cloudEdge * cloudLit * 1.4;
  // Cloud visibility fades to zero on the deep night side, with a soft twilight fringe
  let cloudVisibility = smoothstep(-TWILIGHT_COS_HALF, TWILIGHT_COS_HALF, sunDot);
  surf = mix(surf, cloudEdgeColor, cloudAlpha * cloudVisibility);

  if (atmosphereSettings.scatteringEnabled != 0u) {
    let cosViewZenith = dot(N, viewDir);
    let lutUV = vec2f(cosViewZenith * 0.5 + 0.5, sunDot * 0.5 + 0.5);
    let od = textureSample(atmosphereLUT, atmosphereSampler, lutUV).rg;
    let transmittance = exp(-(RAYLEIGH_COEFF * od.r + MIE_COEFF * od.g));

    let sunOD = textureSample(atmosphereLUT, atmosphereSampler, vec2f(1.0, sunDot * 0.5 + 0.5)).rg;
    let sunTint = exp(-(RAYLEIGH_COEFF * sunOD.r + MIE_COEFF * sunOD.g));
    let haze = atmosphereSettings.hazeStrength * pow(horizonFactor, 1.35);

    surf *= mix(vec3f(1.0), transmittance, clamp(haze, 0.0, 1.0));
    surf = mix(surf, sunTint * vec3f(0.14, 0.22, 0.36), clamp(haze * 0.25, 0.0, 0.35));
  }

  // Moon View: earthshine + cohesive blue-marble disk at ~1.9° angular diameter.
  let isMoonView = (uni.view_mode & 0xFFFFu) == 4u;
  if (isMoonView) {
    let nightSide = 1.0 - diff;
    let earthshine = vec3f(0.06, 0.10, 0.22) * nightSide * smoothstep(0.05, -0.30, sunDot);
    surf += earthshine * 1.05;
    surf += vec3f(0.07, 0.14, 0.28) * (0.35 + 0.65 * diff);
    surf *= 1.72;
  }

  return vec4f(surf + cityWarm, 1.0);
}
`;
