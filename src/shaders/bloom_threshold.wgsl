/**
 * Bloom Threshold Shader
 * 
 * Extracts bright pixels from the HDR scene for bloom effect.
 */

@group(0) @binding(0) var tex : texture_2d<f32>;
@group(0) @binding(1) var smp : sampler;

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
  uv.y = 1.0 - uv.y;  // Flip Y for proper texture sampling
  
  let c = textureSample(tex, smp, uv).rgb;
  let lum = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  let t = smoothstep(0.75, 1.4, lum);
  
  return vec4f(c * t, 1.0);
}
