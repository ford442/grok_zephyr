/**
 * Bloom Blur Shader (Separable Gaussian)
 * 
 * Performs horizontal or vertical blur based on uniform flag.
 * Uses 5-tap Gaussian kernel.
 */

struct BlurUni {
  texel: vec2f,
  horizontal: u32,
  pad: u32,
}

@group(0) @binding(0) var<uniform> buni : BlurUni;
@group(0) @binding(1) var tex : texture_2d<f32>;
@group(0) @binding(2) var smp : sampler;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  const pts = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0)
  );
  var out: VSOut;
  out.pos = vec4f(pts[vi], 0.0, 1.0);
  out.uv = pts[vi] * 0.5 + 0.5;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  var uv = in.uv;
  uv.y = 1.0 - uv.y;
  
  // Choose direction based on uniform
  let d = select(vec2f(0.0, buni.texel.y), vec2f(buni.texel.x, 0.0), buni.horizontal != 0u);
  
  // Gaussian weights for 5-tap kernel
  const W = array<f32, 5>(0.2270, 0.1945, 0.1216, 0.0540, 0.0162);
  
  var c = textureSample(tex, smp, uv).rgb * W[0];
  for (var i = 1; i < 5; i++) {
    let off = f32(i) * d;
    c += textureSample(tex, smp, uv + off).rgb * W[i];
    c += textureSample(tex, smp, uv - off).rgb * W[i];
  }
  
  return vec4f(c, 1.0);
}
