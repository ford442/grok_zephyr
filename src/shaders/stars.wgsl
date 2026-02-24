/**
 * Starfield Background Shader
 * 
 * Renders a procedural starfield using a fullscreen triangle.
 * Stars are generated using a hash function in screen-space.
 */

#import "uniforms.wgsl"

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  // Fullscreen triangle
  const pts = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0)
  );
  
  var out: VSOut;
  out.pos = vec4f(pts[vi], 0.0, 1.0);
  out.uv  = pts[vi] * 0.5 + 0.5;
  return out;
}

fn hash2(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  // Tile in screen-space angular bins
  let cell = floor(in.uv * 512.0);
  let h    = hash2(cell);
  let h2   = hash2(cell + vec2f(1.0, 0.0));
  let h3   = hash2(cell + vec2f(0.0, 1.0));
  
  // Star probability and brightness
  let star = f32(h > 0.994) * pow(h2, 6.0);
  
  // Star color variation (blue-white to yellow-white)
  let color = mix(vec3f(0.6, 0.8, 1.0), vec3f(1.0, 0.9, 0.7), h3);
  
  return vec4f(color * star * 1.5, 1.0);
}
