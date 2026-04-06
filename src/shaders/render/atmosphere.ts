/**
 * Atmosphere Limb Glow Shader
 */

import { UNIFORM_STRUCT } from '../uniforms.js';

export const ATM_SHADER = UNIFORM_STRUCT + /* wgsl */ `
struct VIn  { @location(0) pos:vec3f, @location(1) nrm:vec3f }
struct VOut { @builtin(position) cp:vec4f, @location(0) wp:vec3f, @location(1) n:vec3f }

const ATM_SCALE : f32 = 6471.0/6371.0;

@vertex fn vs(v:VIn) -> VOut {
  var o:VOut;
  let p  = v.pos * ATM_SCALE;
  o.cp   = uni.view_proj * vec4f(p,1);
  o.wp   = p;
  o.n    = v.nrm;
  return o;
}

@fragment fn fs(in:VOut) -> @location(0) vec4f {
  let N       = normalize(in.n);
  let V       = normalize(uni.camera_pos.xyz - in.wp);
  let rim     = 1.0 - abs(dot(N,V));
  let limb    = pow(rim,3.5);
  
  let sun_dir = normalize(vec3f(1.0,0.4,0.2));
  let sun_dot = dot(N, sun_dir);
  let sunset  = smoothstep(0.0, 0.4, sun_dot) * smoothstep(0.6, 0.2, sun_dot);
  
  let dayColor   = vec3f(0.4,0.7,1.0);
  let sunsetColor= vec3f(1.0,0.5,0.2);
  var atmColor   = mix(dayColor, sunsetColor, sunset);
  
  return vec4f(atmColor * limb * 1.5, limb * 0.8);
}
`;
