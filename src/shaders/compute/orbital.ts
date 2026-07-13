/**
 * Orbital Mechanics Compute Shader
 * Multi-shell simple propagation or SGP4-anchored Keplerian extended elements.
 */

import { UNIFORM_STRUCT } from '../uniforms.js';

export const ORBITAL_CS =
  UNIFORM_STRUCT +
  /* wgsl */ `
@group(0) @binding(1) var<storage, read>       orb_elem : array<vec4f>;
@group(0) @binding(2) var<storage, read>       ext_elem : array<vec4f>;
@group(0) @binding(3) var<storage, read_write> sat_pos  : array<vec4f>;

const REALISM_FLAG_BIT : u32 = 20u;

// Multi-shell orbit radii (km from Earth center) — art-directed procedural mode
const ORBIT_RADII_KM = array<f32,3>(6711.0, 6921.0, 7521.0);
const MEAN_MOTIONS = array<f32,3>(0.001153, 0.001097, 0.000946);

fn solveKepler(M: f32, e: f32) -> f32 {
  var E = M;
  if (e > 0.8) { E = 3.14159265; }
  for (var iter = 0; iter < 8; iter++) {
    let f = E - e * sin(E) - M;
    let fp = 1.0 - e * cos(E);
    E = E - f / fp;
  }
  return E;
}

fn keplerianPosition(a: f32, e: f32, inc: f32, raan: f32, argp: f32, M0: f32, n: f32, t: f32) -> vec3f {
  let M = M0 + n * t;
  let E = solveKepler(M, e);
  let cE = cos(E);
  let sE = sin(E);
  let nu = atan2(sqrt(max(0.0, 1.0 - e * e)) * sE, cE - e);
  let r = a * (1.0 - e * cE);

  let xOrb = r * cos(nu);
  let yOrb = r * sin(nu);

  let cO = cos(raan); let sO = sin(raan);
  let ci = cos(inc);  let si = sin(inc);
  let cw = cos(argp); let sw = sin(argp);

  let x = (cO * cw - sO * sw * ci) * xOrb + (-cO * sw - sO * cw * ci) * yOrb;
  let y = (sO * cw + cO * sw * ci) * xOrb + (-sO * sw + cO * cw * ci) * yOrb;
  let z = sw * si * xOrb + cw * si * yOrb;
  return vec3f(x, y, z);
}

fn decodeColorIndex(shellData: f32) -> f32 {
  return f32(u32(shellData) & 255u);
}

@compute @workgroup_size(64,1,1)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  if (i >= 1048576u) { return; }

  let e = orb_elem[i];
  let colorIndex = decodeColorIndex(e.w);
  let realismOn = ((uni.view_mode >> REALISM_FLAG_BIT) & 1u) != 0u;

  let extBase = i * 2u;
  let ext0 = ext_elem[extBase];
  let ext1 = ext_elem[extBase + 1u];
  let useSgp4 = realismOn && ext1.w > 0.5;

  var pos = vec3f(0.0);
  if (useSgp4) {
    pos = keplerianPosition(ext0.x, ext0.y, ext0.z, ext0.w, ext1.x, ext1.y, ext1.z, uni.sim_time);
  } else {
    let shellDataU = u32(e.w);
    let shellIndex = shellDataU >> 8u;
    let orbitR = ORBIT_RADII_KM[shellIndex];
    let meanMotion = MEAN_MOTIONS[shellIndex];
    let M  = e.z + meanMotion * uni.sim_time;
    let cM = cos(M); let sM = sin(M);
    let cR = cos(e.x); let sR = sin(e.x);
    let cI = cos(e.y); let sI = sin(e.y);
    pos = vec3f(
      orbitR * (cR*cM - sR*sM*cI),
      orbitR * (sR*cM + cR*sM*cI),
      orbitR * sM * sI
    );
  }

  sat_pos[i] = vec4f(pos, colorIndex);
}
`;
