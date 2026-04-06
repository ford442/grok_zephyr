/**
 * Bloom Threshold Shader
 * Extracts bright areas for bloom effect
 */

import { UNIFORM_STRUCT } from '../../uniforms.js';

export const BLOOM_THRESHOLD = UNIFORM_STRUCT + /* wgsl */ `
@group(1) @binding(0) var hdrTex: texture_2d<f32>;
@group(1) @binding(1) var hdrSamp: sampler;

const BLOOM_THRESHOLD: f32 = 1.0;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let hdr = textureSample(hdrTex, hdrSamp, uv).rgb;
  let brightness = dot(hdr, vec3f(0.2126, 0.7152, 0.0722));
  let contribution = max(brightness - BLOOM_THRESHOLD, 0.0);
  return vec4f(hdr * contribution, 1.0);
}
`;
