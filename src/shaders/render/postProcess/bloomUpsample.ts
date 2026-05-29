/**
 * Bloom Upsample Shader (Kawase Dual-Filter / 9-Tap Tent)
 *
 * Implements the upsample pass of the Kawase bloom pyramid.
 * A 9-tap tent filter spreads the accumulated blur from the smaller
 * pyramid level back up to the current level.
 *
 * The pass is rendered with GPU additive blending so the result
 * accumulates on top of the existing content in the destination
 * render target.
 *
 * Bindings:
 *   0 === KawaseUni (srcTexelSize of the SOURCE — smaller — texture)
 *   1 === srcTex    (smaller pyramid level being upsampled)
 *   2 === srcSamp   (linear clamp sampler)
 */

export const BLOOM_UPSAMPLE = /* wgsl */ `
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

// 9-tap tent filter (3×3 bilinear samples weighted by a tent kernel)
// Weights: corners=1, edges=2, centre=4  →  normalise by 16
@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let d = uni.srcTexelSize;

  var c  = textureSample(srcTex, srcSamp, uv + vec2f(-d.x,  d.y)).rgb * 1.0;
  c     += textureSample(srcTex, srcSamp, uv + vec2f( 0.0,  d.y)).rgb * 2.0;
  c     += textureSample(srcTex, srcSamp, uv + vec2f( d.x,  d.y)).rgb * 1.0;
  c     += textureSample(srcTex, srcSamp, uv + vec2f(-d.x,  0.0)).rgb * 2.0;
  c     += textureSample(srcTex, srcSamp, uv                     ).rgb * 4.0;
  c     += textureSample(srcTex, srcSamp, uv + vec2f( d.x,  0.0)).rgb * 2.0;
  c     += textureSample(srcTex, srcSamp, uv + vec2f(-d.x, -d.y)).rgb * 1.0;
  c     += textureSample(srcTex, srcSamp, uv + vec2f( 0.0, -d.y)).rgb * 2.0;
  c     += textureSample(srcTex, srcSamp, uv + vec2f( d.x, -d.y)).rgb * 1.0;

  // Normalise by 16 (tent kernel sum), then scale by UPSAMPLE_BLEND_WEIGHT
  // (0.5) to prevent over-brightening when additively accumulated across
  // multiple pyramid levels during the upsample chain.
  const TENT_NORMALISE     : f32 = 16.0;
  const UPSAMPLE_BLEND_WEIGHT : f32 = 0.5;
  return vec4f(c * (UPSAMPLE_BLEND_WEIGHT / TENT_NORMALISE), 1.0);
}
`;
