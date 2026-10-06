// Close-approach bucket prefix sum — workgroup-memory variant, used when the
// device has no `subgroups`. Same offsets as conjunctionScanSubgroups.wgsl.
#import "conjunctionScanCommon.wgsl"

fn workgroupExclusive(v: u32, lid: u32) -> vec2u {
  return hillisSteeleExclusive(v, lid);
}
