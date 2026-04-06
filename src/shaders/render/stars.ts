/**
 * Starfield Background Shader
 * Parallax layers + twinkling
 */

import { UNIFORM_STRUCT } from '../uniforms.js';

export const STARS_SHADER = UNIFORM_STRUCT + /* wgsl */ `
struct VSOut { @builtin(position) pos:vec4f, @location(0) uv:vec2f };

@vertex fn vs(@builtin(vertex_index) vi:u32) -> VSOut {
  const pts = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
  var o:VSOut;
  o.pos = vec4f(pts[vi],0,1);
  o.uv  = pts[vi]*0.5 + 0.5;
  return o;
}

fn hash2(p:vec2f)->f32 {
  return fract(sin(dot(p,vec2f(127.1,311.7)))*43758.5453);
}

@fragment fn fs(in:VSOut) -> @location(0) vec4f {
  var total = vec3f(0.0);
  
  // Layer 1: Distant fine stars
  let cell1  = floor(in.uv * 512.0);
  let h1     = hash2(cell1);
  let h1b    = hash2(cell1 + vec2f(1.0,0.0));
  let h1c    = hash2(cell1 + vec2f(0.0,1.0));
  let star1  = f32(h1 > 0.994) * pow(h1b,6.0);
  let twinkle1 = 0.7 + 0.3*sin(uni.time*(1.5 + h1b*2.0) + h1*20.0);
  let color1 = mix(vec3f(0.6,0.8,1.0), vec3f(1.0,0.9,0.7), h1c);
  total += color1 * star1 * twinkle1 * 1.5;
  
  // Layer 2: Mid-range brighter stars
  let cell2  = floor(in.uv * 200.0);
  let h2     = hash2(cell2 + vec2f(43.0,17.0));
  let h2b    = hash2(cell2 + vec2f(71.0,53.0));
  let h2c    = hash2(cell2 + vec2f(97.0,23.0));
  let star2  = f32(h2 > 0.997) * pow(h2b,4.0);
  let twinkle2 = 0.8 + 0.2*sin(uni.time*(0.8 + h2b*1.2) + h2*15.0);
  let color2 = mix(vec3f(0.9,0.95,1.0), vec3f(1.0,0.85,0.6), h2c);
  total += color2 * star2 * twinkle2 * 2.5;
  
  return vec4f(total, 1.0);
}
`;
