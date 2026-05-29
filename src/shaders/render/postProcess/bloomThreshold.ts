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
  threshold : f32,
  knee      : f32,
  pad0      : f32,
  pad1      : f32,
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

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let hdr = textureSample(hdrTex, hdrSamp, uv).rgb;
  let brightness = dot(hdr, vec3f(0.2126, 0.7152, 0.0722));

  // Quadratic soft-knee: ramp up from (threshold-knee) to (threshold+knee)
  let lo   = tuni.threshold - tuni.knee;
  let hi   = tuni.threshold + tuni.knee;
  let knee2 = tuni.knee * 2.0;
  var weight: f32;
  if (brightness < lo) {
    weight = 0.0;
  } else if (brightness > hi) {
    weight = 1.0;
  } else {
    let t = (brightness - lo) / max(knee2, 0.0001);
    weight = t * t * (3.0 - 2.0 * t); // smoothstep
  }

  return vec4f(hdr * weight, 1.0);
}
`;

