/**
 * Earth Sphere Shader
 */

import { UNIFORM_STRUCT } from '../uniforms.js';

export const EARTH_SHADER = UNIFORM_STRUCT + /* wgsl */ `
struct VIn  { @location(0) pos:vec3f, @location(1) nrm:vec3f }
struct VOut { @builtin(position) cp:vec4f, @location(0) wp:vec3f, @location(1) n:vec3f }

@vertex fn vs(v:VIn) -> VOut {
  var o:VOut;
  o.cp = uni.view_proj * vec4f(v.pos,1);
  o.wp = v.pos;
  o.n  = v.nrm;
  return o;
}

@fragment fn fs(in:VOut) -> @location(0) vec4f {
  let N       = normalize(in.n);
  let sun_dir = normalize(vec3f(1.0,0.4,0.2));
  let diff    = max(dot(N,sun_dir),0.0);

  let lat = asin(clamp(N.z,-1.0,1.0));
  let lon = atan2(N.y,N.x);
  let f1  = sin(lat*4.0+0.5)*cos(lon*3.0+1.2);
  let f2  = cos(lat*6.0)*sin(lon*5.0+0.8);
  let land = smoothstep(0.15,0.35, f1*0.6+f2*0.4);

  let ocean = vec3f(0.04,0.10,0.30);
  let soil  = vec3f(0.15,0.22,0.06);
  let ice   = vec3f(0.7,0.75,0.8);
  let pole  = smoothstep(1.1,1.4, abs(lat));
  var surf  = mix(mix(ocean,soil,land), ice, pole);

  let ambient   = 0.04;
  let lit       = surf * (diff*0.92 + ambient);

  // City lights
  let night = smoothstep(0.12, -0.04, dot(N, sun_dir));
  let cityA = 0.5 + 0.5 * sin(lon * 22.0 + lat * 18.0);
  let cityB = 0.5 + 0.5 * sin(lon * 61.0 + lat * 47.0);
  let cityMask = smoothstep(0.35, 0.6, land) * cityA * (0.4 + 0.3*cityB);
  let cityWarm = vec3f(1.0, 0.78, 0.28) * cityMask * night * 0.12;
  
  return vec4f(lit + cityWarm, 1.0);
}
`;
