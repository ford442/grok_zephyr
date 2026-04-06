/**
 * Composite Shader
 * Final tone mapping and composition
 */

import { UNIFORM_STRUCT } from '../../uniforms.js';

export const COMPOSITE = UNIFORM_STRUCT + /* wgsl */ `
@group(1) @binding(0) var sceneTex: texture_2d<f32>;
@group(1) @binding(1) var bloomTex: texture_2d<f32>;
@group(1) @binding(2) var linearSamp: sampler;

const EXPOSURE: f32 = 1.0;
const GAMMA: f32 = 2.2;

fn acesToneMapping(hdr: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((hdr * (a * hdr + b)) / (hdr * (c * hdr + d) + e), vec3f(0.0), vec3f(1.0));
}

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let scene = textureSample(sceneTex, linearSamp, uv).rgb;
  let bloom = textureSample(bloomTex, linearSamp, uv).rgb;
  
  let hdr = scene + bloom * 0.5;
  let mapped = acesToneMapping(hdr * EXPOSURE);
  let gammaCorrected = pow(mapped, vec3f(1.0 / GAMMA));
  
  return vec4f(gammaCorrected, 1.0);
}
`;
