// Exclusive prefix sum of the close-approach bucket counts → bucket offsets.
//
// Shared by conjunctionScan.wgsl (workgroup memory only) and
// conjunctionScanSubgroups.wgsl (`enable subgroups`); each defines
// `workgroupExclusive(v, lid) -> vec2u(exclusive prefix, workgroup total)` over
// the 256 invocations in local_invocation_index order. Both produce the same
// offsets, so the pair search is identical with or without the feature.
//
// Three dispatches, mirrored by exclusiveScanBlocked in
// src/physics/conjunctionHash.ts:
//   scan_blocks       — one workgroup per 1024 buckets (256 threads × 4)
//   scan_block_sums   — one workgroup scans the ≤ 1024 block totals in place
//   add_block_offsets — add each block's base back

@group(0) @binding(2) var<storage, read_write> bin_counts : array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> bin_offsets : array<atomic<u32>>;

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
@group(0) @binding(8) var<storage, read_write> block_sums : array<u32>;

const SCAN_THREADS : u32 = 256u;
const SCAN_PER_THREAD : u32 = 4u;
const SCAN_BLOCK : u32 = SCAN_THREADS * SCAN_PER_THREAD;

var<workgroup> hs_scan : array<u32, SCAN_THREADS>;

// Hillis-Steele inclusive scan in workgroup memory, returned as exclusive.
// Must be reached in workgroup-uniform control flow (it has barriers).
fn hillisSteeleExclusive(v: u32, lid: u32) -> vec2u {
  hs_scan[lid] = v;
  workgroupBarrier();
  for (var offset = 1u; offset < SCAN_THREADS; offset <<= 1u) {
    var add = 0u;
    if (lid >= offset) { add = hs_scan[lid - offset]; }
    workgroupBarrier();
    hs_scan[lid] += add;
    workgroupBarrier();
  }
  return vec2u(hs_scan[lid] - v, hs_scan[SCAN_THREADS - 1u]);
}

@compute @workgroup_size(256)
fn scan_blocks(
  @builtin(workgroup_id) wg: vec3u,
  @builtin(local_invocation_index) lid: u32,
) {
  let buckets = params.bucket_mask + 1u;
  let base = wg.x * SCAN_BLOCK + lid * SCAN_PER_THREAD;
  var local: array<u32, 4>;
  var sum = 0u;
  for (var k = 0u; k < SCAN_PER_THREAD; k++) {
    let idx = base + k;
    var v = 0u;
    if (idx < buckets) { v = atomicLoad(&bin_counts[idx]); }
    local[k] = sum;
    sum += v;
  }
  let scan = workgroupExclusive(sum, lid);
  for (var k = 0u; k < SCAN_PER_THREAD; k++) {
    let idx = base + k;
    if (idx < buckets) { atomicStore(&bin_offsets[idx], scan.x + local[k]); }
  }
  if (lid == 0u) { block_sums[wg.x] = scan.y; }
}

@compute @workgroup_size(256)
fn scan_block_sums(@builtin(local_invocation_index) lid: u32) {
  let n = params.block_count;
  let base = lid * SCAN_PER_THREAD;
  var local: array<u32, 4>;
  var sum = 0u;
  for (var k = 0u; k < SCAN_PER_THREAD; k++) {
    let idx = base + k;
    var v = 0u;
    if (idx < n) { v = block_sums[idx]; }
    local[k] = sum;
    sum += v;
  }
  let scan = workgroupExclusive(sum, lid);
  for (var k = 0u; k < SCAN_PER_THREAD; k++) {
    let idx = base + k;
    if (idx < n) { block_sums[idx] = scan.x + local[k]; }
  }
}

@compute @workgroup_size(256)
fn add_block_offsets(
  @builtin(workgroup_id) wg: vec3u,
  @builtin(local_invocation_index) lid: u32,
) {
  let buckets = params.bucket_mask + 1u;
  let add = block_sums[wg.x];
  let base = wg.x * SCAN_BLOCK + lid * SCAN_PER_THREAD;
  for (var k = 0u; k < SCAN_PER_THREAD; k++) {
    let idx = base + k;
    if (idx < buckets) { atomicStore(&bin_offsets[idx], atomicLoad(&bin_offsets[idx]) + add); }
  }
}
