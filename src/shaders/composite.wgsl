/**
 * Composite + Tonemapping Shader
 * 
 * Final pass that combines scene and bloom textures with ACES tonemapping.
 */

@group(0) @binding(0) var scene_tex : texture_2d<f32>;
@group(0) @binding(1) var bloom_tex : texture_2d<f32>;
@group(0) @binding(2) var smp       : sampler;

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

/**
 * ACES Filmic Tonemapping Approximation
 * 
 * Approximates the ACES (Academy Color Encoding System) tone curve
 * for cinematic HDR to SDR conversion.
 */
fn aces(x: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  var uv = in.uv;
  uv.y = 1.0 - uv.y;
  
  let scene = textureSample(scene_tex, smp, uv).rgb;
  let bloom = textureSample(bloom_tex, smp, uv).rgb;
  
  // Combine with bloom intensity
  let hdr = scene + bloom * 1.8;
  
  // Tonemap to SDR
  return vec4f(aces(hdr), 1.0);
}
