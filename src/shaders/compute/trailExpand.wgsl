// GPU trail ribbon expansion (cinematic only).
//
// Reads the history ring orbital.wgsl wrote for a fixed, evenly strided
// subset of the fleet (TRAIL_MAX_TRACKED_SATS), culls by camera distance and
// frustum, and builds camera-facing ribbon quads directly into vertex/index
// storage buffers that are also bound as the trail render pass's vertex and
// index buffers — no CPU readback, no calculateSatellitePosition. Same
// atomic-counter + indirect-draw compaction pattern as satelliteCull.wgsl.
#import "uniforms.wgsl"
#import "trailUni.wgsl"

@group(0) @binding(1) var<storage, read> trail_history : array<vec4f>;
@group(0) @binding(2) var<storage, read> orb_elem : array<vec4f>;
@group(0) @binding(3) var<uniform> trailUni : TrailUni;

struct TrailCounters {
  vertex_count: atomic<u32>,
  index_count: atomic<u32>,
}
@group(0) @binding(4) var<storage, read_write> counters : TrailCounters;

// x,y,z,intensity,age,shell per vertex — matches TrailRenderer's CPU layout
// (arrayStride 24 bytes) so both modes share the same render pipeline.
@group(0) @binding(5) var<storage, read_write> out_vertices : array<f32>;
@group(0) @binding(6) var<storage, read_write> out_indices : array<u32>;

struct DrawIndexedIndirect {
  index_count    : u32,
  instance_count : u32,
  first_index    : u32,
  base_vertex    : i32,
  first_instance : u32,
}
@group(0) @binding(7) var<storage, read_write> draw_indirect : DrawIndexedIndirect;

const SHELL_COLORS_COUNT: u32 = 3u;

fn sphereInFrustumTrail(center: vec3f, radius: f32) -> bool {
  for (var p = 0; p < 6; p++) {
    let plane = uni.frustum[p];
    if (dot(plane.xyz, center) + plane.w < -radius) {
      return false;
    }
  }
  return true;
}

fn pushVertex(base: u32, p: vec3f, intensity: f32, age: f32, shell: f32) {
  out_vertices[base + 0u] = p.x;
  out_vertices[base + 1u] = p.y;
  out_vertices[base + 2u] = p.z;
  out_vertices[base + 3u] = intensity;
  out_vertices[base + 4u] = age;
  out_vertices[base + 5u] = shell;
}

@compute @workgroup_size(64, 1, 1)
fn expand_trails(@builtin(global_invocation_id) gid: vec3u) {
  let slot = gid.x;
  if (trailUni.enabled == 0u || slot >= trailUni.tracked_count) { return; }

  let frames = trailUni.history_frames;
  let head = trailUni.write_index % frames;
  let newest = trail_history[slot * frames + head];
  if (newest.w < 0.0) { return; } // never written yet, or satellite inactive

  let toCam = newest.xyz - uni.camera_pos.xyz;
  let dist = length(toCam);
  if (dist > trailUni.max_distance_km) { return; }
  if (!sphereInFrustumTrail(newest.xyz, 50.0)) { return; }

  let satIdx = slot * trailUni.stride;
  let shellF = f32((u32(orb_elem[satIdx].w) >> 8u) % SHELL_COLORS_COUNT);

  let lodStep = select(1u, select(2u, 4u, dist > 70000.0), dist > 35000.0);
  let segLimit = frames - 1u;
  let distanceScale = clamp(dist * 0.000025, 0.45, 1.6);

  var seg = 0u;
  loop {
    if (seg >= segLimit) { break; }

    let h0 = (head + frames - seg) % frames;
    let h1 = (head + frames - seg - 1u) % frames;
    let p0v = trail_history[slot * frames + h0];
    let p1v = trail_history[slot * frames + h1];
    if (p0v.w < 0.0 || p1v.w < 0.0) { break; } // ring not fully populated yet

    let dir = p1v.xyz - p0v.xyz;
    let dirLen = length(dir);
    if (dirLen < 1e-3) {
      seg += lodStep;
      continue;
    }
    let dn = dir / dirLen;

    let camDir = uni.camera_pos.xyz - p0v.xyz;
    let camLen = length(camDir);
    if (camLen < 1e-3) {
      seg += lodStep;
      continue;
    }
    let cn = camDir / camLen;

    var right = cross(dn, cn);
    let rightLen = length(right);
    if (rightLen < 1e-6) {
      seg += lodStep;
      continue;
    }
    right = right / rightLen;

    let t0 = f32(seg) / f32(segLimit);
    let t1 = f32(seg + lodStep) / f32(segLimit);
    let taper = 1.0 - t0 * 0.85;
    let width = trailUni.ribbon_width * taper * distanceScale;
    let intensity0 = 1.0 - t0;
    let intensity1 = 1.0 - t1;
    let age0 = t0 * 90.0;
    let age1 = t1 * 90.0;

    let vBase = atomicAdd(&counters.vertex_count, 4u);
    if (vBase + 4u > trailUni.max_vertices) {
      atomicSub(&counters.vertex_count, 4u);
      break;
    }
    let iBase = atomicAdd(&counters.index_count, 6u);
    if (iBase + 6u > trailUni.max_indices) {
      atomicSub(&counters.index_count, 6u);
      break;
    }

    pushVertex((vBase + 0u) * 6u, p0v.xyz - right * width, intensity0, age0, shellF);
    pushVertex((vBase + 1u) * 6u, p0v.xyz + right * width, intensity0, age0, shellF);
    pushVertex((vBase + 2u) * 6u, p1v.xyz - right * width, intensity1, age1, shellF);
    pushVertex((vBase + 3u) * 6u, p1v.xyz + right * width, intensity1, age1, shellF);

    out_indices[iBase + 0u] = vBase + 0u;
    out_indices[iBase + 1u] = vBase + 1u;
    out_indices[iBase + 2u] = vBase + 2u;
    out_indices[iBase + 3u] = vBase + 1u;
    out_indices[iBase + 4u] = vBase + 3u;
    out_indices[iBase + 5u] = vBase + 2u;

    seg += lodStep;
  }
}

@compute @workgroup_size(1, 1, 1)
fn finalize_trail_indirect(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x > 0u) { return; }
  draw_indirect.index_count = atomicLoad(&counters.index_count);
  draw_indirect.instance_count = 1u;
  draw_indirect.first_index = 0u;
  draw_indirect.base_vertex = 0;
  draw_indirect.first_instance = 0u;
}
