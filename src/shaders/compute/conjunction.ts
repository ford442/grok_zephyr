/**
 * Close-approach detection — spatial-hash bin + pair search.
 *
 * Three entry points, dispatched in order each frame the feature is on:
 *   clear_bins  — zero the bucket counts and the frame's counters
 *   bin_sats    — hash each satellite into a bucket (atomic append)
 *   find_pairs  — walk the 27-cell neighbourhood, distance test, append pairs
 *
 * `cellCoord` and `hashCell` must stay bit-identical to the CPU reference in
 * src/physics/conjunctionHash.ts, which is what the unit tests pin. Cell size
 * is the threshold distance, so a pair inside the threshold is always in the
 * same cell or one of the 26 neighbours.
 *
 * Plain atomicAdd only — no `subgroups`. The feature is not worth requesting an
 * optional device feature no other system binds (GpuCapabilities used-only
 * policy), and the append is not the bottleneck; the neighbour walk is.
 */

import { UNIFORM_STRUCT } from '../uniforms.js';

export const CONJUNCTION_CS =
  UNIFORM_STRUCT +
  /* wgsl */ `
@group(0) @binding(1) var<storage, read> sat_pos : array<vec4f>;
@group(0) @binding(2) var<storage, read_write> bin_counts : array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> bin_indices : array<u32>;
@group(0) @binding(4) var<storage, read_write> pairs : array<vec4f>;

struct ConjunctionCounters {
  pair_count : atomic<u32>,
  // Satellites a full bucket refused. Non-zero means the view under-reports,
  // and the HUD says so rather than showing a quietly thin result.
  overflow   : atomic<u32>,
}
@group(0) @binding(5) var<storage, read_write> counters : ConjunctionCounters;

struct ConjunctionParams {
  enabled         : u32,
  threshold_km    : f32,
  scan_count      : u32,
  bucket_mask     : u32,
  bucket_capacity : u32,
  max_pairs       : u32,
  time            : f32,
  pad0            : u32,
}
@group(0) @binding(6) var<uniform> params : ConjunctionParams;

// Teschner spatial-hash primes. bitcast (not a value conversion) so negative
// cell coordinates keep their two's-complement bit pattern, matching the CPU
// reference's Math.imul(x | 0, ...) exactly.
fn hashCell(c: vec3i, mask: u32) -> u32 {
  let h = (bitcast<u32>(c.x) * 73856093u)
        ^ (bitcast<u32>(c.y) * 19349663u)
        ^ (bitcast<u32>(c.z) * 83492791u);
  return h & mask;
}

fn cellCoord(p: vec3f, cellKm: f32) -> vec3i {
  return vec3i(floor(p / cellKm));
}

// Skips the two sentinel states: an exactly-zero position (growth-era, not yet
// launched) and a negative w flag (decayed).
fn isActive(p: vec4f) -> bool {
  if (p.w < 0.0) { return false; }
  return any(p.xyz != vec3f(0.0));
}

@compute @workgroup_size(256)
fn clear_bins(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i == 0u) {
    atomicStore(&counters.pair_count, 0u);
    atomicStore(&counters.overflow, 0u);
  }
  if (i > params.bucket_mask) { return; }
  atomicStore(&bin_counts[i], 0u);
}

@compute @workgroup_size(256)
fn bin_sats(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (params.enabled == 0u || i >= params.scan_count) { return; }
  let p = sat_pos[i];
  if (!isActive(p)) { return; }

  let bucket = hashCell(cellCoord(p.xyz, params.threshold_km), params.bucket_mask);
  let slot = atomicAdd(&bin_counts[bucket], 1u);
  if (slot < params.bucket_capacity) {
    bin_indices[bucket * params.bucket_capacity + slot] = i;
  } else {
    atomicAdd(&counters.overflow, 1u);
  }
}

@compute @workgroup_size(256)
fn find_pairs(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (params.enabled == 0u || i >= params.scan_count) { return; }
  let pa = sat_pos[i];
  if (!isActive(pa)) { return; }

  let cell = cellCoord(pa.xyz, params.threshold_km);
  let thresholdSq = params.threshold_km * params.threshold_km;

  for (var dz = -1; dz <= 1; dz++) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let neighbour = cell + vec3i(dx, dy, dz);
        let bucket = hashCell(neighbour, params.bucket_mask);
        let filled = min(atomicLoad(&bin_counts[bucket]), params.bucket_capacity);

        for (var s = 0u; s < filled; s++) {
          let j = bin_indices[bucket * params.bucket_capacity + s];
          // i < j emits each unordered pair once and skips self-pairing.
          if (j <= i) { continue; }

          let pb = sat_pos[j];
          // Two different neighbour cells can hash to one bucket; without this
          // check such a collision would emit the same pair twice, once per
          // colliding cell. Confirm j really lives in the cell being visited.
          let jc = cellCoord(pb.xyz, params.threshold_km);
          if (any(jc != neighbour)) { continue; }

          let delta = pb.xyz - pa.xyz;
          let d2 = dot(delta, delta);
          if (d2 > thresholdSq) { continue; }

          let slot = atomicAdd(&counters.pair_count, 1u);
          if (slot >= params.max_pairs) { return; }
          let dist = sqrt(d2);
          // w carries the separation and a 0..1 severity so the draw pass needs
          // no second lookup: 1 = touching, 0 = exactly at the threshold.
          let severity = clamp(1.0 - dist / max(params.threshold_km, 1e-6), 0.0, 1.0);
          pairs[slot * 2u]      = vec4f(pa.xyz, dist);
          pairs[slot * 2u + 1u] = vec4f(pb.xyz, severity);
        }
      }
    }
  }
}
`;
