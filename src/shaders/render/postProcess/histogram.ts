/**
 * Auto Exposure Histogram Compute Shader
 * Builds a 64-bin log luminance histogram from the HDR scene texture.
 */
export const AUTO_EXPOSURE_HISTOGRAM = /* wgsl */ `
const HISTOGRAM_BINS : u32 = 64u;
const LOG_LUM_MIN    : f32 = -10.0;
const LOG_LUM_MAX    : f32 = 6.0;
const LOG_LUM_RANGE  : f32 = LOG_LUM_MAX - LOG_LUM_MIN;

@group(0) @binding(0) var sceneTex : texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> histogram : array<atomic<u32>, HISTOGRAM_BINS>;

var<workgroup> localHistogram : array<atomic<u32>, HISTOGRAM_BINS>;

fn luminance(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

fn luminanceToBin(lum: f32) -> u32 {
  let logLum = clamp(log2(max(lum, 1e-6)), LOG_LUM_MIN, LOG_LUM_MAX);
  let norm = (logLum - LOG_LUM_MIN) / LOG_LUM_RANGE;
  return min(HISTOGRAM_BINS - 1u, u32(norm * f32(HISTOGRAM_BINS - 1u)));
}

@compute @workgroup_size(16, 16, 1)
fn main(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_index) lid: u32
) {
  if (lid < HISTOGRAM_BINS) {
    atomicStore(&localHistogram[lid], 0u);
  }
  workgroupBarrier();

  let dims = textureDimensions(sceneTex, 0);
  if (gid.x < dims.x && gid.y < dims.y) {
    let hdr = textureLoad(sceneTex, vec2i(gid.xy), 0).rgb;
    let bin = luminanceToBin(luminance(hdr));
    atomicAdd(&localHistogram[bin], 1u);
  }
  workgroupBarrier();

  if (lid < HISTOGRAM_BINS) {
    atomicAdd(&histogram[lid], atomicLoad(&localHistogram[lid]));
  }
}
`;
