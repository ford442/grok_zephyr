/**
 * Bloom Threshold Shader
 * Extracts bright areas for bloom effect with configurable threshold and soft knee.
 *
 * Bindings:
 *   0 === hdrTex        (HDR scene texture)
 *   1 === hdrSamp       (linear sampler)
 *   2 === ThresholdUni  (threshold + knee)
 */

export const BLOOM_THRESHOLD = /* wgsl */ `
// ThresholdUni matches the buffer written by RenderPipeline.updateBloomThresholdUni():
//   threshold : luminance cutoff (typically 0.65–0.85)
//   knee      : soft-knee half-width around the threshold
struct ThresholdUni {
  threshold      : f32,
  knee           : f32,
  enforce_floors : f32, // 1 = shipping floors (max 1.5 / 0.05), 0 = raw slider values
  pad0           : f32,
};

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VSOut {
  const pts = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0)
  );
  var out: VSOut;
  out.pos = vec4f(pts[vid], 0.0, 1.0);
  out.uv = pts[vid] * 0.5 + 0.5;
  return out;
}

@group(0) @binding(0) var hdrTex : texture_2d<f32>;
@group(0) @binding(1) var hdrSamp: sampler;
@group(0) @binding(2) var<uniform> tuni: ThresholdUni;

// Attenuate star/limb mid-band; full extraction for hot satellite cores.
fn sourceBloomWeight(luminance: f32) -> f32 {
  let satHot = smoothstep(2.0, 4.0, luminance);
  let limbMid = smoothstep(0.35, 1.35, luminance) * (1.0 - smoothstep(1.35, 2.6, luminance));
  return mix(mix(0.36, 1.0, satHot), 0.22, limbMid * 0.7);
}

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let color = textureSample(hdrTex, hdrSamp, uv).rgb;
  let luminance = dot(color, vec3f(0.2126, 0.7152, 0.0722));

  let use_floors = tuni.enforce_floors > 0.5;
  // Shipping floors keep ambient HDR from washing out sharpened satellite cores
  let t = select(tuni.threshold, max(tuni.threshold, 1.5), use_floors);
  let k = select(tuni.knee, max(tuni.knee, 0.05), use_floors);

  var rq = clamp(luminance - t + k, 0.0, k * 2.0);
  rq = (rq * rq) / (4.0 * k + 0.0001);

  let bloom_luminance = max(rq, luminance - t) * sourceBloomWeight(luminance);
  let output_color = color * (bloom_luminance / max(luminance, 0.00001));

  return vec4f(output_color, 1.0);
}
`;

