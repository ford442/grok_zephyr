// Close-approach bucket prefix sum — subgroup variant. Compiled only on a device
// created with `subgroups`, which bootWebGPU requests only when `?ca=1` will run.
//
// Each subgroup scans its lanes with subgroupExclusiveAdd, then the subgroup
// totals are chained in workgroup memory. That is only a scan in
// local_invocation_index order if every subgroup is a contiguous, lane-ordered
// run of invocations. WGSL does not promise that layout, so it is checked, and a
// workgroup that sees anything else falls back to the Hillis-Steele scan — the
// result never depends on the layout, only the speed does.
enable subgroups;

#import "conjunctionScanCommon.wgsl"

var<workgroup> sg_total : array<u32, SCAN_THREADS>;
var<workgroup> sg_width : array<u32, SCAN_THREADS>;
var<workgroup> sg_non_contiguous : u32;

fn workgroupExclusive(v: u32, lid: u32) -> vec2u {
  let lane = subgroupExclusiveAdd(1u);
  let width = subgroupAdd(1u);
  // Lowest active lane's index, i.e. lane 0's: all lanes are active here.
  let first = subgroupBroadcastFirst(lid);
  let exclusive = subgroupExclusiveAdd(v);
  let total = subgroupAdd(v);

  if (lid != first + lane) { sg_non_contiguous = 1u; }
  if (lane == 0u) {
    sg_total[first] = total;
    sg_width[first] = width;
  }
  // Barrier + uniform read, so the branch below is workgroup-uniform.
  if (workgroupUniformLoad(&sg_non_contiguous) != 0u) {
    return hillisSteeleExclusive(v, lid);
  }

  // Contiguous subgroups tile 0..255, so walking start → start + width visits
  // each one once, in order.
  var prefix = 0u;
  var all = 0u;
  var k = 0u;
  loop {
    if (k >= SCAN_THREADS) { break; }
    let t = sg_total[k];
    if (k < first) { prefix += t; }
    all += t;
    k += max(sg_width[k], 1u);
  }
  return vec2u(prefix + exclusive, all);
}
