/**
 * Atmosphere Shader
 * Rayleigh-Mie scattering approximation with enhanced limb glow
 */

import { UNIFORM_STRUCT } from '../uniforms.js';

export const ATM_SHADER = UNIFORM_STRUCT + /* wgsl */ `
struct VIn  { @location(0) pos:vec3f, @location(1) nrm:vec3f }
struct VOut { @builtin(position) cp:vec4f, @location(0) wp:vec3f, @location(1) n:vec3f }

const ATM_SCALE : f32 = 6471.0/6371.0;
const PI: f32 = 3.14159265;

// Rayleigh scattering coefficients (wavelength-dependent)
const RAYLEIGH_COEFF = vec3f(5.8e-3, 13.5e-3, 33.1e-3); // Scaled for visual impact

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
  let sun_dir = normalize(vec3f(1.0,0.4,0.2));

  // View-dependent rim for optical depth approximation
  let rim     = 1.0 - abs(dot(N, V));
  let opticalDepth = pow(rim, 2.5);

  // Sun-view angle for phase functions
  let cosTheta = dot(V, sun_dir);

  // Rayleigh scattering (blue sky, wavelength-dependent)
  let rayleigh = RAYLEIGH_COEFF * opticalDepth * rayleighPhase(cosTheta);

  // Mie scattering (white forward-scatter haze around sun)
  let mieG = 0.76;
  let mie = vec3f(0.021) * opticalDepth * miePhase(cosTheta, mieG);

  // Total in-scattering
  let inScatter = (rayleigh + mie) * 20.0;

  // Sun angle determines day/night/sunset
  let sun_dot = dot(N, sun_dir);

  // Sunset coloring (enhanced at terminator)
  let sunset = smoothstep(-0.1, 0.3, sun_dot) * smoothstep(0.5, 0.1, sun_dot);
  let sunsetColor = vec3f(1.0, 0.4, 0.15) * sunset * 2.0;

  // Day glow (Rayleigh blue) + sunset orange
  let dayColor = inScatter;
  let nightFade = smoothstep(-0.2, 0.1, sun_dot);

  // Combine scattering with sunset
  var atmColor = dayColor * nightFade + sunsetColor * opticalDepth;

  // Limb brightening at atmosphere edge
  let limb = pow(rim, 3.5);

  // Atmospheric haze intensity
  let intensity = limb * 1.5 + opticalDepth * 0.3;

  return vec4f(atmColor * intensity, limb * 0.8);
}
`;
