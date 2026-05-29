/**
 * Bloom Downsample Shader (Kawase Dual-Filter)
 *
 * Implements the Kawase dual-filter downsample for the bloom pyramid.
 * Each level samples 5 bilinear taps (1 centre + 4 half-offset corners)
 * which gives a good approximation of a 4-tap box filter with no
 * under-sampling artefacts.
 *
 * Bindings:
 *   0 === KawaseUni (srcTexelSize)
 *   1 === srcTex    (source texture from previous pyramid level)
 *   2 === srcSamp   (linear clamp sampler)
 */

export const BLOOM_DOWNSAMPLE = /* wgsl */ `
struct KawaseUni {
  srcTexelSize : vec2f,
  pad          : vec2f,
};

struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0)       uv  : vec2f,
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
  out.uv  = pts[vid] * 0.5 + 0.5;
  return out;
}

@group(0) @binding(0) var<uniform> uni    : KawaseUni;
@group(0) @binding(1) var          srcTex : texture_2d<f32>;
@group(0) @binding(2) var          srcSamp: sampler;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let d = uni.srcTexelSize * 0.5;

  // 5-tap Kawase dual-filter downsample:
  // 1 centre tap + 4 bilinear taps at ±0.5 texel corners.
  var c  = textureSample(srcTex, srcSamp, uv                         ).rgb * 4.0;
  c += textureSample(srcTex, srcSamp, uv + vec2f( d.x,  d.y)).rgb;
  c += textureSample(srcTex, srcSamp, uv + vec2f(-d.x,  d.y)).rgb;
  c += textureSample(srcTex, srcSamp, uv + vec2f( d.x, -d.y)).rgb;
  c += textureSample(srcTex, srcSamp, uv + vec2f(-d.x, -d.y)).rgb;

  return vec4f(c / 8.0, 1.0);
}
`;
