// Close-approach detection — counting-sort spatial hash + pair search.
//
// Dispatched in order each frame the feature is on (one compute pass, so each
// dispatch sees the previous one's writes):
//   clear_bins         — zero the bucket counts and the frame's counters
//   count_sats         — atomicAdd each active satellite's bucket count
//   scan_blocks / scan_block_sums / add_block_offsets
//                      — exclusive prefix sum of counts → offsets
//                        (conjunctionScan.wgsl, or conjunctionScanSubgroups.wgsl
//                        when the device has `subgroups`; same result)
//   scatter_sats       — atomicAdd a cursor in offsets, write the index into
//                        `sorted`; afterwards offsets[b] is bucket b's END
//   find_pairs         — walk the 27-cell neighbourhood, distance test, append
//
// No bucket has a capacity, so no satellite is ever dropped and the scan covers
// the whole fleet. `cellCoord` and `hashCell` must stay bit-identical to the CPU
// reference in src/physics/conjunctionHash.ts, which is what the unit tests pin.
// Cell size is the threshold distance, so a pair inside the threshold is always
// in the same cell or one of the 26 neighbours.
#import "uniforms.wgsl"

@group(0) @binding(1) var<storage, read> sat_pos : array<vec4f>;
@group(0) @binding(2) var<storage, read_write> bin_counts : array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> bin_offsets : array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> sorted : array<u32>;
@group(0) @binding(5) var<storage, read_write> pairs : array<vec4f>;

struct ConjunctionCounters {
  pair_count : atomic<u32>,
  // Active satellites hashed this frame — the dashboard's scan coverage.
  binned     : atomic<u32>,
}
@group(0) @binding(6) var<storage, read_write> counters : ConjunctionCounters;

struct ConjunctionParams {
  enabled         : u32,
  threshold_km    : f32,
  scan_count      : u32,
  bucket_mask     : u32,
  block_count     : u32,
  max_pairs       : u32,
  time            : f32,
  pad0            : u32,
}
@group(0) @binding(7) var<uniform> params : ConjunctionParams;

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
    atomicStore(&counters.binned, 0u);
  }
  if (i > params.bucket_mask) { return; }
  atomicStore(&bin_counts[i], 0u);
}

fn bucketOf(p: vec3f) -> u32 {
  return hashCell(cellCoord(p, params.threshold_km), params.bucket_mask);
}

@compute @workgroup_size(256)
fn count_sats(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (params.enabled == 0u || i >= params.scan_count) { return; }
  let p = sat_pos[i];
  if (!isActive(p)) { return; }
  atomicAdd(&bin_counts[bucketOf(p.xyz)], 1u);
  atomicAdd(&counters.binned, 1u);
}

@compute @workgroup_size(256)
fn scatter_sats(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (params.enabled == 0u || i >= params.scan_count) { return; }
  let p = sat_pos[i];
  if (!isActive(p)) { return; }
  // offsets hold the exclusive scan, so the cursor walks each bucket's slice
  // of `sorted` exactly; afterwards it rests on the slice's end.
  let slot = atomicAdd(&bin_offsets[bucketOf(p.xyz)], 1u);
  sorted[slot] = i;
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
        let end = atomicLoad(&bin_offsets[bucket]);
        let start = end - atomicLoad(&bin_counts[bucket]);

        for (var s = start; s < end; s++) {
          let j = sorted[s];
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
