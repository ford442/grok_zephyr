/**
 * Bloom Blur Shader
 * Separable Gaussian blur for bloom effect — matches BlurUni layout in SatelliteGPUBuffer
 */

export const BLOOM_BLUR = /* wgsl */ `
struct BlurUni {
  texel      : vec2f,
  horizontal : u32,
  pad        : u32,
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

@group(0) @binding(0) var<uniform> buni   : BlurUni;
@group(0) @binding(1) var          srcTex : texture_2d<f32>;
@group(0) @binding(2) var          srcSamp: sampler;

// Gaussian weights — 5-tap kernel (matches original bloom_blur.wgsl)
const W = array<f32, 5>(0.2270, 0.1945, 0.1216, 0.0540, 0.0162);

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let d = select(
    vec2f(0.0, buni.texel.y),
    vec2f(buni.texel.x, 0.0),
    buni.horizontal != 0u
  );

  var c = textureSample(srcTex, srcSamp, uv).rgb * W[0];
  for (var i = 1; i < 5; i++) {
    let off = f32(i) * d;
    c += textureSample(srcTex, srcSamp, uv + off).rgb * W[i];
    c += textureSample(srcTex, srcSamp, uv - off).rgb * W[i];
  }

  return vec4f(c, 1.0);
}
`;
