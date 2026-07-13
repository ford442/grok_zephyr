/**
 * Moon View — screen-space Earth disk reinforcement.
 *
 * At 384,400 km the 3D Earth sphere can read as a faint point against 750×
 * constellation billboards. This pass draws a procedurally textured disk at the
 * correct ~1.9° angular diameter with day/night terminator, city lights, and
 * earthshine, composited additively over the scene.
 */

import { UNIFORM_STRUCT } from '../uniforms.js';

export const MOON_EARTH_DISK_SHADER =
  UNIFORM_STRUCT +
  /* wgsl */ `
const EARTH_ANG_RAD: f32 = 0.01655; // half-angle ~0.949° → Ø 1.9°

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

  let dir = skyDir(in.uv);
  let toEarth = normalize(-uni.camera_pos.xyz);
  let cosEarth = dot(dir, toEarth);
  let angDist = acos(clamp(cosEarth, -1.0, 1.0));
  let normAng = angDist / EARTH_ANG_RAD;
  if (normAng > 1.05) {
    return vec4f(0.0);
  }

  // Tangent-plane coordinates on the visible disk (for procedural albedo).
  let worldUp = vec3f(0.0, 0.0, 1.0);
  var east = cross(worldUp, toEarth);
  if (length(east) < 0.01) {
    east = vec3f(0.0, 1.0, 0.0);
  }
  east = normalize(east);
  let north = normalize(cross(toEarth, east));
  let tangent = dir - toEarth * cosEarth;
  let diskU = dot(tangent, east) / max(sin(EARTH_ANG_RAD), 1e-4);
  let diskV = dot(tangent, north) / max(sin(EARTH_ANG_RAD), 1e-4);

  let sunDir = normalize(uni.sun_position.xyz);
  let sunDot = dot(toEarth, sunDir);
  let day = smoothstep(-0.08, 0.28, sunDot);

  // Continent/ocean variation keyed to disk UV.
  let sp = vec2f(diskU, diskV) * 4.2;
  let landNoise = noise2(sp) * 0.6 + noise2(sp * 2.1) * 0.35;
  let isLand = smoothstep(0.48, 0.58, landNoise);
  let ocean = vec3f(0.04, 0.16, 0.38);
  let landCol = mix(vec3f(0.10, 0.32, 0.14), vec3f(0.42, 0.36, 0.22), landNoise);
  var col = mix(ocean, landCol, isLand);
  col *= 0.18 + 0.92 * day;

  // Earthshine on the night hemisphere.
  let night = 1.0 - day;
  col += vec3f(0.07, 0.12, 0.26) * night * smoothstep(0.12, -0.25, sunDot) * 0.95;

  // City lights on the night side.
  let cities = smoothstep(0.58, 0.64, noise2(sp * 3.5)) * isLand * night;
  col += vec3f(1.0, 0.82, 0.45) * cities * 0.55;

  // Limb halo — blue marble read at a glance.
  let limb = smoothstep(0.55, 1.0, normAng);
  col += vec3f(0.14, 0.32, 0.62) * limb * (0.35 + 0.45 * day);

  // Soft disk edge + composite strength.
  let disk = 1.0 - smoothstep(0.92, 1.05, normAng);
  let alpha = disk * mix(0.42, 0.28, day);
  return vec4f(col * 1.65, alpha);
}
`;
