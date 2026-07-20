/**
 * Satellite ID picking shader — renders instance index into an r32uint target.
 */

import { UNIFORM_STRUCT } from '../uniforms.js';

export const SATELLITE_PICK_SHADER =
  UNIFORM_STRUCT +
  /* wgsl */ `
@group(0) @binding(1) var<storage, read> sat_pos : array<vec4f>;

struct PickParams {
  center_ndc : vec2f,
  scale      : f32,
  pad        : f32,
}
@group(0) @binding(2) var<uniform> pick : PickParams;

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
@group(0) @binding(3) var<uniform> satVisual : SatelliteVisualUni;

struct PickVOut {
  @builtin(position) cp : vec4f,
  @location(0) uv : vec2f,
  @location(1) @interpolate(flat) id : u32,
}

fn shellSizeScale(shellIdx: u32) -> f32 {
  if (shellIdx == 0u) { return 0.85; }
  if (shellIdx == 2u) { return 1.15; }
  return 1.0;
}

@vertex
fn vs_pick(
  @builtin(vertex_index) vi : u32,
  @builtin(instance_index) ii : u32,
) -> PickVOut {
  let pd = sat_pos[ii];
  let wp = pd.xyz;
  let cam = uni.camera_pos.xyz;
  let dist = length(wp - cam);

  const quad = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0,  1.0), vec2f(1.0, -1.0), vec2f( 1.0, 1.0)
  );

  let qv = quad[vi];
  let right = uni.camera_right.xyz;
  let up = uni.camera_up.xyz;
  let shellIdx = ii / 349525u;
  let shellSize = shellSizeScale(shellIdx);
  let groundScale = select(1.0, 0.72, ((uni.view_mode >> 16u) & 1u) == 1u);
  let isMoonView = (uni.view_mode & 0xFFFFu) == 4u;
  let moonBillboardScale = select(1.0, 750.0, isMoonView);
  let maxVisibleDist = max(satVisual.distance_cull_km, 1000.0);
  let bsize = clamp(1200.0 / max(dist, 50.0), 0.4, 60.0) * moonBillboardScale *
              select(0.0, 1.0, dist < maxVisibleDist) * shellSize * groundScale;
  let offset = (qv.x * right + qv.y * up) * bsize;
  let fpos = wp + offset;

  var clip = uni.view_proj * vec4f(fpos, 1.0);
  let ndc = clip.xy / max(clip.w, 1e-5);
  let local = (ndc - pick.center_ndc) * pick.scale;
  clip = vec4f(local * clip.w, clip.z, clip.w);

  var out: PickVOut;
  out.cp = clip;
  out.uv = (qv + 1.0) * 0.5;
  out.id = ii;
  return out;
}

@fragment
fn fs_pick(in: PickVOut) -> @location(0) u32 {
  let uv = in.uv * 2.0 - 1.0;
  if (dot(uv, uv) > 1.0) {
    discard;
  }
  return in.id;
}
`;
