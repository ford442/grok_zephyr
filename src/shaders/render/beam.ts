/**
 * Laser Beam Shader
 */

import { UNIFORM_STRUCT } from '../uniforms.js';

export const BEAM_SHADER = UNIFORM_STRUCT + /* wgsl */ `
@group(0) @binding(3) var<storage, read> beams : array<vec4f>;

struct VOut {
  @builtin(position) cp : vec4f,
  @location(0) uv       : vec2f,
  @location(1) intensity: f32,
};

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> VOut {
  // Beam rendering logic
  var out: VOut;
  out.cp = vec4f(0.0, 0.0, 0.0, 1.0);
  out.uv = vec2f(0.0);
  out.intensity = 1.0;
  return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  return vec4f(1.0, 0.5, 0.2, in.intensity);
}
`;
