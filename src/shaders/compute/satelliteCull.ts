/**
 * GPU satellite + beam visibility compaction.
 * Runs after orbital + beam compute; feeds indirect draw instance counts.
 */

import { UNIFORM_STRUCT } from '../uniforms.js';

export const SATELLITE_CULL_CS =
  UNIFORM_STRUCT +
  /* wgsl */ `
@group(0) @binding(1) var<storage, read> sat_pos : array<vec4f>;

struct SatelliteVisualUni {
  core_outer       : f32,
  core_inner       : f32,
  halo_outer       : f32,
  halo_inner       : f32,
  halo_strength    : f32,
  core_boost       : f32,
  distance_cull_km : f32,
  animation_intensity : f32,
  animation_contrast  : f32,
}
@group(0) @binding(2) var<uniform> satVisual : SatelliteVisualUni;

struct PatternParams {
  pattern_mode: u32,
  animation_time: f32,
  seed: f32,
  selected_satellite: u32,
}
@group(0) @binding(3) var<uniform> params : PatternParams;

struct CullCounters {
  sat_count  : atomic<u32>,
  beam_count : atomic<u32>,
}
@group(0) @binding(4) var<storage, read_write> counters : CullCounters;

@group(0) @binding(5) var<storage, read> beams : array<vec4f>;
@group(0) @binding(6) var<storage, read_write> visible_sat_indices : array<u32>;
@group(0) @binding(7) var<storage, read_write> visible_beam_indices : array<u32>;

struct DrawIndirect {
  vertex_count   : u32,
  instance_count : u32,
  first_vertex   : u32,
  first_instance : u32,
}
@group(0) @binding(8) var<storage, read_write> sat_draw_indirect  : DrawIndirect;
@group(0) @binding(9) var<storage, read_write> beam_draw_indirect : DrawIndirect;

const NUM_SATELLITES : u32 = 1048576u;
const MAX_BEAMS : u32 = 65536u;
const EARTH_RADIUS_KM : f32 = 6371.0;
const FRUSTUM_MARGIN_KM : f32 = 200.0;
const MOON_BILLBOARD_SCALE : f32 = 750.0;
const NO_SELECTION : u32 = 0xffffffffu;

fn shellSizeScale(shell: u32) -> f32 {
  switch shell {
    case 0u: { return 0.8; }
    case 1u: { return 1.0; }
    case 2u: { return 1.3; }
    default: { return 1.0; }
  }
}

fn billboardRadiusKm(dist: f32, shellIdx: u32, viewFlags: u32) -> f32 {
  let groundScale = select(1.0, 0.72, ((viewFlags >> 16u) & 1u) == 1u);
  let isMoonView = (viewFlags & 0xFFFFu) == 4u;
  let moonBillboardScale = select(1.0, MOON_BILLBOARD_SCALE, isMoonView);
  let shellSize = shellSizeScale(shellIdx);
  return clamp(1200.0 / max(dist, 50.0), 0.4, 60.0) * moonBillboardScale * shellSize * groundScale;
}

fn sphereInFrustum(center: vec3f, radius: f32) -> bool {
  for (var p = 0; p < 6; p++) {
    let plane = uni.frustum[p];
    let d = dot(plane.xyz, center) + plane.w;
    if (d < -radius) {
      return false;
    }
  }
  return true;
}

fn isAboveHorizon(satPos: vec3f, observerPos: vec3f) -> bool {
  let earthR = EARTH_RADIUS_KM;
  let o = observerPos;
  let s = satPos;
  let d = normalize(s - o);
  let oc = o;
  let b = dot(oc, d);
  let c = dot(oc, oc) - earthR * earthR;
  let disc = b * b - c;
  if (disc < 0.0) {
    return true;
  }
  let t = -b - sqrt(disc);
  let satDist = length(s - o);
  return t < 0.0 || t > satDist;
}

fn needsHorizonCull(viewFlags: u32) -> bool {
  let isGround = ((viewFlags >> 16u) & 1u) == 1u;
  let isSkyline = (viewFlags & 0xFFFFu) == 5u;
  return isGround || isSkyline;
}

fn isSatelliteVisible(satIdx: u32) -> bool {
  if (params.selected_satellite != NO_SELECTION && satIdx == params.selected_satellite) {
    return true;
  }

  let wp = sat_pos[satIdx].xyz;
  let cam = uni.camera_pos.xyz;
  let dist = length(wp - cam);
  let maxVisibleDist = max(satVisual.distance_cull_km, 1000.0);
  if (dist >= maxVisibleDist) {
    return false;
  }

  let shellIdx = satIdx / 349525u;
  let radius = billboardRadiusKm(dist, shellIdx, uni.view_mode) + FRUSTUM_MARGIN_KM;
  if (!sphereInFrustum(wp, radius)) {
    return false;
  }

  if (needsHorizonCull(uni.view_mode) && !isAboveHorizon(wp, cam)) {
    return false;
  }

  return true;
}

fn isBeamActive(beamIdx: u32) -> bool {
  let start = beams[beamIdx * 2u];
  let end = beams[beamIdx * 2u + 1u];
  if (start.w <= 0.0 && end.w <= 0.0) {
    return false;
  }
  let delta = end.xyz - start.xyz;
  return dot(delta, delta) > 1.0;
}

@compute @workgroup_size(64, 1, 1)
fn cull_satellites(@builtin(global_invocation_id) gid: vec3u) {
  let satIdx = gid.x;
  if (satIdx >= NUM_SATELLITES) {
    return;
  }
  if (!isSatelliteVisible(satIdx)) {
    return;
  }
  let slot = atomicAdd(&counters.sat_count, 1u);
  visible_sat_indices[slot] = satIdx;
}

@compute @workgroup_size(256, 1, 1)
fn cull_beams(@builtin(global_invocation_id) gid: vec3u) {
  let beamIdx = gid.x;
  if (beamIdx >= MAX_BEAMS) {
    return;
  }
  if (!isBeamActive(beamIdx)) {
    return;
  }
  let satIdx = beamIdx * 5u;
  if (!isSatelliteVisible(satIdx)) {
    return;
  }
  let slot = atomicAdd(&counters.beam_count, 1u);
  visible_beam_indices[slot] = beamIdx;
}

@compute @workgroup_size(1, 1, 1)
fn finalize_indirect(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x > 0u) {
    return;
  }
  sat_draw_indirect.instance_count = atomicLoad(&counters.sat_count);
  beam_draw_indirect.instance_count = atomicLoad(&counters.beam_count);
}
`;
