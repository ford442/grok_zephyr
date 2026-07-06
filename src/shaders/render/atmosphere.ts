/**
 * Atmosphere Shader
 * Rayleigh-Mie scattering approximation with enhanced limb glow
 */

import { UNIFORM_STRUCT } from '../uniforms.js';

export const ATM_SHADER = UNIFORM_STRUCT + /* wgsl */ `
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

const ATM_SCALE : f32 = 6471.0/6371.0;
const PI: f32 = 3.14159265;

// Atmospheric coefficients (km-scale artistic physical approximation)
const RAYLEIGH_COEFF = vec3f(5.8e-3, 13.5e-3, 33.1e-3);
const MIE_COEFF = vec3f(2.1e-2);

@vertex fn vs(v:VIn) -> VOut {
  var o:VOut;
  let p  = v.pos * ATM_SCALE;
  o.cp   = uni.view_proj * vec4f(p,1);
  o.wp   = p;
  o.n    = v.nrm;
  return o;
}

fn rayleighPhase(cosTheta:f32)->f32 {
  return (3.0 / (16.0 * PI)) * (1.0 + cosTheta * cosTheta);
}

fn miePhase(cosTheta:f32, g:f32)->f32 {
  let g2 = g * g;
  let denom = 1.0 + g2 - 2.0 * g * cosTheta;
  return (1.0 / (4.0 * PI)) * ((1.0 - g2) / pow(max(denom, 0.0001), 1.5));
}

@fragment fn fs(in:VOut) -> @location(0) vec4f {
  let N       = normalize(in.n);
  let V       = normalize(uni.camera_pos.xyz - in.wp);
  let sun_dir = normalize(uni.sun_position.xyz);
  let sun_dot = dot(N, sun_dir);
  let cosTheta = dot(V, sun_dir);

  if (atmosphereSettings.scatteringEnabled == 0u) {
    // Existing low-cost fallback
    let rim     = 1.0 - abs(dot(N, V));
    let opticalDepth = pow(rim, 2.5);
    let rayleigh = RAYLEIGH_COEFF * opticalDepth * rayleighPhase(cosTheta);
    let mie = MIE_COEFF * opticalDepth * miePhase(cosTheta, 0.76);
    let inScatter = (rayleigh + mie) * 20.0;
    let sunset = smoothstep(-0.1, 0.3, sun_dot) * smoothstep(0.5, 0.1, sun_dot);
    let sunsetColor = vec3f(1.0, 0.4, 0.15) * sunset * 2.0;
    let nightFade = smoothstep(-0.2, 0.1, sun_dot);
    var atmColor = inScatter * nightFade + sunsetColor * opticalDepth;
    let limb = pow(rim, 2.8);
    var intensity = limb * 1.8 + opticalDepth * 0.3;
    let sunsetLimb = pow(rim, 4.0) * smoothstep(-0.15, 0.25, sun_dot) * smoothstep(0.4, 0.05, sun_dot);
    let sunsetTint = vec3f(1.0, 0.5, 0.12) * sunsetLimb * 1.2;
    let isMoonView = (uni.view_mode & 0xFFFFu) == 4u;
    if (isMoonView) {
      intensity *= 1.4;
      atmColor += vec3f(0.10, 0.22, 0.48) * limb * 0.35;
    }
    return vec4f(atmColor * intensity + sunsetTint, limb * select(0.8, 1.0, isMoonView));
  }

  let cosViewZenith = dot(N, V);
  let lutUV = vec2f(cosViewZenith * 0.5 + 0.5, sun_dot * 0.5 + 0.5);
  let od = textureSample(atmosphereLUT, atmosphereSampler, lutUV).rg;
  let rayleighOD = od.r;
  let mieOD = od.g;

  let sunLutUV = vec2f(1.0, sun_dot * 0.5 + 0.5);
  let sunOD = textureSample(atmosphereLUT, atmosphereSampler, sunLutUV).rg;
  let sunTransmittance = exp(-(RAYLEIGH_COEFF * sunOD.r + MIE_COEFF * sunOD.g));

  let transmittance = exp(-(RAYLEIGH_COEFF * rayleighOD + MIE_COEFF * mieOD));
  let rayleigh = RAYLEIGH_COEFF * rayleighOD * rayleighPhase(cosTheta);
  let mie = MIE_COEFF * mieOD * miePhase(cosTheta, 0.758);
  let inScatter = (rayleigh + mie) * sunTransmittance * (1.0 - transmittance);

  let horizon = pow(clamp(1.0 - abs(cosViewZenith), 0.0, 1.0), 2.3);
  let dayWeight = smoothstep(-0.15, 0.2, sun_dot);
  let nightGlow = vec3f(0.02, 0.04, 0.10) * (1.0 - dayWeight) * horizon * 0.35;
  let sunset = smoothstep(-0.25, 0.18, sun_dot) * smoothstep(0.3, -0.05, sun_dot);
  let sunsetTint = vec3f(1.0, 0.44, 0.16) * sunset * horizon * 0.55;
  let haze = atmosphereSettings.hazeStrength * horizon;
  var atmColor = (inScatter * (10.0 + haze * 3.0)) + nightGlow + sunsetTint;
  var alpha = clamp(horizon * (0.55 + atmosphereSettings.hazeStrength), 0.0, 0.95);

  // Moon View: stronger limb halo so Earth reads as a blue marble at 384,400 km.
  let isMoonView = (uni.view_mode & 0xFFFFu) == 4u;
  if (isMoonView) {
    let limbBoost = pow(horizon, 1.6) * 1.35;
    atmColor += vec3f(0.12, 0.28, 0.55) * limbBoost * (0.45 + 0.55 * dayWeight);
    alpha = clamp(alpha * 1.25 + limbBoost * 0.12, 0.0, 0.98);
  }

  return vec4f(atmColor, alpha);
}
`;
