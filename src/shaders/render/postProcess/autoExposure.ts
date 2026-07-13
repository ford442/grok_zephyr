/**
 * Auto Exposure Adaptation Compute Shader
 * Reduces a histogram to average log luminance and temporally adapts exposure.
 */
export const AUTO_EXPOSURE_ADAPT = /* wgsl */ `
const HISTOGRAM_BINS : u32 = 64u;
const LOG_LUM_MIN    : f32 = -10.0;
const LOG_LUM_MAX    : f32 = 6.0;
const LOG_LUM_RANGE  : f32 = LOG_LUM_MAX - LOG_LUM_MIN;

struct ExposureSettings {
  deltaTime       : f32,
  adaptationSpeed : f32,
  minExposure     : f32,
  maxExposure     : f32,
  autoEnabled     : u32,
  pad0            : u32,
  pad1            : u32,
  pad2            : u32,
};

@group(0) @binding(0) var<storage, read> histogram : array<u32, HISTOGRAM_BINS>;
@group(0) @binding(1) var<storage, read_write> exposureState : array<f32, 1>;
@group(0) @binding(2) var<uniform> settings : ExposureSettings;

var<workgroup> weightedBins : array<f32, HISTOGRAM_BINS>;
var<workgroup> weightedSums : array<f32, HISTOGRAM_BINS>;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(local_invocation_index) lid: u32) {
  let count = f32(histogram[lid]);
  weightedBins[lid] = count;
  weightedSums[lid] = count * f32(lid);
  workgroupBarrier();

  var stride = HISTOGRAM_BINS / 2u;
  loop {
    if (stride == 0u) { break; }
    if (lid < stride) {
      weightedBins[lid] += weightedBins[lid + stride];
      weightedSums[lid] += weightedSums[lid + stride];
    }
    workgroupBarrier();
    stride = stride / 2u;
  }

  if (lid == 0u) {
    let pixelCount = max(weightedBins[0], 1.0);
    let avgBin = weightedSums[0] / pixelCount;
    let targetLogLum = (avgBin / f32(HISTOGRAM_BINS - 1u)) * LOG_LUM_RANGE + LOG_LUM_MIN;
    let targetLum = exp2(targetLogLum);
    let targetExposure = clamp(0.18 / max(targetLum, 1e-6), settings.minExposure, settings.maxExposure);
    let current = exposureState[0];
    let alpha = 1.0 - exp(-max(0.0, settings.adaptationSpeed) * max(0.0, settings.deltaTime));
    exposureState[0] = mix(current, targetExposure, alpha);
  }
}
`;
