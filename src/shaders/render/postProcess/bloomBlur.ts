/**
 * Bloom Blur Shader
 * Gaussian blur for bloom effect
 */

import { UNIFORM_STRUCT } from '../../uniforms.js';

export const BLOOM_BLUR = UNIFORM_STRUCT + /* wgsl */ `
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VSOut {
  var out: VSOut;
  let x = f32(vid % 2u) * 2.0 - 1.0;
  let y = f32(vid / 2u) * 2.0 - 1.0;
  out.pos = vec4f(x, y, 0.0, 1.0);
  out.uv = vec4f(x, y, 0.0, 1.0).xy * 0.5 + 0.5;
  return out;
}

@group(0) @binding(0) var<uniform> blurDir: vec2f;
@group(0) @binding(1) var srcTex: texture_2d<f32>;
@group(0) @binding(2) var srcSamp: sampler;

const KERNEL_RADIUS: i32 = 4;
const WEIGHTS: array<f32, 9> = array<f32, 9>(
  0.0162, 0.0540, 0.1216, 0.1890, 0.2245, 0.1890, 0.1216, 0.0540, 0.0162
);

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let texelSize = 1.0 / vec2f(textureDimensions(srcTex, 0));
  var result = vec3f(0.0);
  
  for (var i = -KERNEL_RADIUS; i <= KERNEL_RADIUS; i++) {
    let offset = vec2f(f32(i)) * blurDir * texelSize;
    let weight = WEIGHTS[i + KERNEL_RADIUS];
    result += textureSample(srcTex, srcSamp, uv + offset).rgb * weight;
  }
  
  return vec4f(result, 1.0);
}
`;
