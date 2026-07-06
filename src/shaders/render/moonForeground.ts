/**
 * Moon View foreground overlay — lunar regolith horizon at the bottom of frame.
 *
 * Drawn as a fullscreen pass after the scene so it grounds the viewer on the
 * lunar surface without obscuring Earth or the constellation ring.
 */

import { UNIFORM_STRUCT } from '../uniforms.js';

export const MOON_FOREGROUND_SHADER = UNIFORM_STRUCT + /* wgsl */ `
const EARTH_R_KM: f32 = 6371.0;
const MOON_DIST_KM: f32 = 384400.0;
// Angular radius of Earth as seen from the Moon (~0.949°).
const EARTH_ANG_RAD: f32 = 0.01655;
const FOREGROUND_HEIGHT: f32 = 0.15;

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

fn hash2(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

fn noise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash2(i), hash2(i + vec2f(1.0, 0.0)), u.x),
    mix(hash2(i + vec2f(0.0, 1.0)), hash2(i + vec2f(1.0, 1.0)), u.x),
    u.y
  );
}

fn skyDir(uv: vec2f) -> vec3f {
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let right = uni.camera_right.xyz;
  let up = uni.camera_up.xyz;
  let forward = normalize(cross(up, right));
  return normalize(forward + ndc.x * right + ndc.y * up);
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let isMoonView = (uni.view_mode & 0xFFFFu) == 4u;
  if (!isMoonView) {
    return vec4f(0.0);
  }

  // Curved lunar horizon: bottom 15% of frame with a gentle arc.
  let y = in.uv.y;
  let arc = 0.04 * (1.0 - in.uv.x * in.uv.x) * 4.0;
  let horizonY = FOREGROUND_HEIGHT + arc;
  let regolithMask = 1.0 - smoothstep(horizonY - 0.02, horizonY + 0.01, y);
  if (regolithMask < 0.001) {
    return vec4f(0.0);
  }

  // Procedural regolith: warm gray-brown with subtle crater noise.
  let crater = noise2(in.uv * vec2f(48.0, 18.0) + vec2f(uni.time * 0.0, 0.0));
  let grain = noise2(in.uv * 180.0 + vec2f(3.7, 11.2));
  let base = vec3f(0.10, 0.09, 0.08);
  let highlight = vec3f(0.16, 0.14, 0.12) * crater;
  let shadow = vec3f(0.04, 0.035, 0.03) * (1.0 - crater);
  var regolith = base + highlight * 0.35 + shadow * 0.25;
  regolith += vec3f(grain * 0.04);

  // Earth limb glow reflected on the regolith (very subtle earthshine on the ground).
  let toEarth = normalize(-uni.camera_pos.xyz);
  let cosEarth = dot(skyDir(in.uv), toEarth);
  let earthGlow = smoothstep(cos(EARTH_ANG_RAD * 1.4), cos(EARTH_ANG_RAD * 0.6), cosEarth);
  regolith += vec3f(0.04, 0.06, 0.12) * earthGlow * 0.18 * regolithMask;

  // Fade toward the horizon line so the sky stays unobstructed.
  let edgeFade = smoothstep(horizonY - 0.02, horizonY + 0.008, y);
  let alpha = regolithMask * mix(0.92, 0.0, edgeFade);

  return vec4f(regolith * 0.48, alpha * 0.88);
}
`;
