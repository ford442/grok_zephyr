/**
 * ISL topology compute — plane-neighbor optical links (Walker) or TLE ring.
 * Writes up to MAX_ISL_LINKS segments (start,end vec4). Independent of beam patterns.
 */

import { UNIFORM_STRUCT } from '../uniforms.js';

export const ISL_COMPUTE =
  UNIFORM_STRUCT +
  /* wgsl */ `
@group(0) @binding(1) var<storage, read> sat_pos : array<vec4f>;
@group(0) @binding(2) var<storage, read> orb_elem : array<vec4f>;
@group(0) @binding(3) var<storage, read_write> isl : array<vec4f>;

struct IslParams {
  enabled: u32,
  density: f32,
  focus_index: u32,
  sat_limit: u32,
  time: f32,
  topology: u32, // 0 = walker plane-neighbor, 1 = TLE ring
  pad0: u32,
  pad1: u32,
}
@group(0) @binding(4) var<uniform> params : IslParams;

const MAX_ISL_LINKS: u32 = 131072u;
const LINKS_PER_SAT: u32 = 2u;
const NUM_PLANES: u32 = 1024u;
const SATS_PER_PLANE: u32 = 1024u;
const MAX_RANGE_KM: f32 = 5500.0;
const TWO_PI: f32 = 6.28318530718;

fn hashu(n: u32) -> u32 {
  var x = n;
  x = x ^ (x >> 16u);
  x = x * 0x45d9f3bu;
  x = x ^ (x >> 16u);
  return x;
}

fn writeDegenerate(link: u32) {
  if (link >= MAX_ISL_LINKS) { return; }
  isl[link * 2u] = vec4f(0.0);
  isl[link * 2u + 1u] = vec4f(0.0);
}

fn writeLink(link: u32, a: u32, b: u32) {
  if (link >= MAX_ISL_LINKS) { return; }
  let pa = sat_pos[a].xyz;
  let pb = sat_pos[b].xyz;
  let dist = length(pa - pb);
  if (dist < 1.0 || dist > MAX_RANGE_KM) {
    writeDegenerate(link);
    return;
  }
  var quality = clamp(1.0 - dist / MAX_RANGE_KM, 0.08, 1.0);
  var focused = 0.0;
  if (params.focus_index != 0xffffffffu && (a == params.focus_index || b == params.focus_index)) {
    quality = 1.0;
    focused = 1.0;
  }
  isl[link * 2u] = vec4f(pa, quality);
  isl[link * 2u + 1u] = vec4f(pb, focused);
}

fn walkerNeighbor(sat: u32, which: u32, satLimit: u32) -> u32 {
  let plane = sat / SATS_PER_PLANE;
  let slot = sat % SATS_PER_PLANE;
  let planeCount = max(1u, (satLimit + SATS_PER_PLANE - 1u) / SATS_PER_PLANE);
  if (which == 0u) {
    return plane * SATS_PER_PLANE + ((slot + 1u) % SATS_PER_PLANE);
  }
  let np = (plane + 1u) % planeCount;
  return np * SATS_PER_PLANE + slot;
}

fn tleNeighbor(sat: u32, which: u32, satLimit: u32) -> u32 {
  if (which == 0u) {
    return (sat + 1u) % satLimit;
  }
  let stride = max(2u, satLimit / 32u);
  return (sat + stride) % satLimit;
}

@compute @workgroup_size(64,1,1)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let emitter = gid.x;
  let maxEmitters = MAX_ISL_LINKS / LINKS_PER_SAT;
  if (emitter >= maxEmitters) { return; }

  let baseLink = emitter * LINKS_PER_SAT;
  if (params.enabled == 0u || params.sat_limit < 2u) {
    writeDegenerate(baseLink);
    writeDegenerate(baseLink + 1u);
    return;
  }

  let satLimit = min(params.sat_limit, 1048576u);
  let emitters = min(satLimit, maxEmitters);
  if (emitter >= emitters) {
    writeDegenerate(baseLink);
    writeDegenerate(baseLink + 1u);
    return;
  }

  let keep = f32(hashu(emitter * 747796405u + 2891336453u) & 0xFFFFu) / 65535.0;
  if (keep > params.density) {
    writeDegenerate(baseLink);
    writeDegenerate(baseLink + 1u);
    return;
  }

  let stride = max(1u, satLimit / emitters);
  let sat = emitter * stride;
  if (sat >= satLimit) {
    writeDegenerate(baseLink);
    writeDegenerate(baseLink + 1u);
    return;
  }

  var n0: u32;
  var n1: u32;
  if (params.topology == 1u) {
    n0 = tleNeighbor(sat, 0u, satLimit);
    n1 = tleNeighbor(sat, 1u, satLimit);
  } else {
    n0 = walkerNeighbor(sat, 0u, satLimit);
    n1 = walkerNeighbor(sat, 1u, satLimit);
  }

  if (n0 < satLimit && n0 != sat) { writeLink(baseLink, sat, n0); } else { writeDegenerate(baseLink); }
  if (n1 < satLimit && n1 != sat && n1 != n0) { writeLink(baseLink + 1u, sat, n1); } else { writeDegenerate(baseLink + 1u); }
}
`;
