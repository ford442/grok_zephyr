/**
 * Orbital Mechanics Compute Shader
 * Physics modes (uni.view_mode bits 17–19):
 *   0 Simple    — multi-shell circular (RAAN / inc / M)
 *   1 Keplerian — extended elements (a, e, inc, Ω, ω, M0, n)
 *   2 J2        — Keplerian plus first-order secular Ω̇, ω̇, Ṁ
 * Realism bit 20 still forces Keplerian for SGP4-anchored slots (flag > 0.5).
 */

import { UNIFORM_STRUCT } from '../uniforms.js';

export const ORBITAL_CS =
  UNIFORM_STRUCT +
  /* wgsl */ `
@group(0) @binding(1) var<storage, read>       orb_elem : array<vec4f>;
@group(0) @binding(2) var<storage, read>       ext_elem : array<vec4f>;
@group(0) @binding(3) var<storage, read_write> sat_pos  : array<vec4f>;
struct StationUniform { position_active: vec4f, zenith_min_sin: vec4f }
@group(0) @binding(4) var<uniform> station: StationUniform;
@group(0) @binding(5) var<storage, read> active_from : array<u32>;
struct GrowthUni { era_day: u32, enabled: u32, pad0: u32, pad1: u32 }
@group(0) @binding(6) var<uniform> growth : GrowthUni;

const REALISM_FLAG_BIT : u32 = 20u;
const PHYSICS_MODE_SHIFT : u32 = 17u;
const PHYSICS_MODE_MASK  : u32 = 7u;

// Multi-shell orbit radii (km from Earth center) — art-directed procedural mode
const ORBIT_RADII_KM = array<f32,3>(6711.0, 6921.0, 7521.0);
const MEAN_MOTIONS = array<f32,3>(0.001153, 0.001097, 0.000946);

const EARTH_J2 : f32 = 0.00108262668;
const EARTH_RADIUS_J2_KM : f32 = 6378.137;

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

fn keplerianJ2Position(a: f32, e: f32, inc: f32, raan0: f32, argp0: f32, M0: f32, n: f32, t: f32) -> vec3f {
  let p = a * (1.0 - e * e);
  var raan = raan0;
  var argp = argp0;
  var M = M0 + n * t;
  if (p > 1.0) {
    let re_p = EARTH_RADIUS_J2_KM / p;
    let re_p2 = re_p * re_p;
    let ci = cos(inc);
    let ci2 = ci * ci;
    let factor = 1.5 * n * EARTH_J2 * re_p2;
    raan = raan0 - factor * ci * t;
    argp = argp0 + 0.5 * factor * (5.0 * ci2 - 1.0) * t;
    let eccF = sqrt(max(0.0, 1.0 - e * e));
    M = M0 + (n + 0.5 * factor * eccF * (3.0 * ci2 - 1.0)) * t;
  }
  return keplerianPosition(a, e, inc, raan, argp, M, 0.0, 0.0);
}

fn decodeColorIndex(shellData: f32) -> f32 {
  return f32(u32(shellData) & 255u);
}

@compute @workgroup_size(64,1,1)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  if (i >= 1048576u) { return; } // injected → active fleet size at pipeline create

  let launchDay = active_from[i >> 1u];
  launchDay = select(launchDay & 0xFFFFu, launchDay >> 16u, (i & 1u) != 0u);
  if (growth.enabled != 0u && launchDay > growth.era_day) {
    sat_pos[i] = vec4f(0.0);
    return;
  }

  let e = orb_elem[i];
  let colorIndex = decodeColorIndex(e.w);
  let realismOn = ((uni.view_mode >> REALISM_FLAG_BIT) & 1u) != 0u;
  let physicsMode = (uni.view_mode >> PHYSICS_MODE_SHIFT) & PHYSICS_MODE_MASK;

  let extBase = i * 2u;
  let ext0 = ext_elem[extBase];
  let ext1 = ext_elem[extBase + 1u];
  let useSgp4 = realismOn && ext1.w > 0.5;
  let useKepler = physicsMode >= 1u || useSgp4;
  let useJ2 = physicsMode == 2u;

  var pos = vec3f(0.0);
  if (useKepler) {
    if (useJ2) {
      pos = keplerianJ2Position(ext0.x, ext0.y, ext0.z, ext0.w, ext1.x, ext1.y, ext1.z, uni.sim_time);
    } else {
      pos = keplerianPosition(ext0.x, ext0.y, ext0.z, ext0.w, ext1.x, ext1.y, ext1.z, uni.sim_time);
    }
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

  var packed = u32(colorIndex) & 255u;
  if (station.position_active.w > 0.5) {
    let toSat = normalize(pos - station.position_active.xyz);
    if (dot(toSat, station.zenith_min_sin.xyz) >= station.zenith_min_sin.w) {
      packed |= 256u;
    }
  }
  sat_pos[i] = vec4f(pos, f32(packed));
}
`;
