/**
 * Bloom Threshold Shader
 * Extracts bright areas for bloom effect
 */

export const BLOOM_THRESHOLD = /* wgsl */ `
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

@group(0) @binding(0) var hdrTex: texture_2d<f32>;
@group(0) @binding(1) var hdrSamp: sampler;

const BLOOM_THRESHOLD_VAL: f32 = 0.8;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let hdr = textureSample(hdrTex, hdrSamp, uv).rgb;
  let brightness = dot(hdr, vec3f(0.2126, 0.7152, 0.0722));
  let contribution = max(brightness - BLOOM_THRESHOLD_VAL, 0.0);
  return vec4f(hdr * contribution, 1.0);
}
`;
