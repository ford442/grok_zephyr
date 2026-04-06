/**
 * Ground Terrain Shader
 */

import { UNIFORM_STRUCT } from '../uniforms.js';

export const GROUND_TERRAIN = UNIFORM_STRUCT + /* wgsl */ `
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

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  // Simple horizon gradient
  let horizon = smoothstep(0.4, 0.5, in.uv.y);
  let groundColor = vec3f(0.05, 0.08, 0.12);
  let skyColor = vec3f(0.02, 0.03, 0.08);
  let color = mix(groundColor, skyColor, horizon);
  return vec4f(color, 1.0);
}
`;
