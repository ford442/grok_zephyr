/**
 * Earth Rendering Shader
 * 
 * Renders Earth with procedural land/ocean patterns and night-side city lights.
 */

#import "uniforms.wgsl"

struct VIn {
  @location(0) pos: vec3f,
  @location(1) nrm: vec3f,
};

struct VOut {
  @builtin(position) cp: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
};

@vertex
fn vs(v: VIn) -> VOut {
  var out: VOut;
  out.cp = uni.view_proj * vec4f(v.pos, 1.0);
  out.wp = v.pos;
  out.n  = v.nrm;
  return out;
}

fn hash2e(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let N = normalize(in.n);
  let sun_dir = normalize(vec3f(1.0, 0.4, 0.2));
  let diff = max(dot(N, sun_dir), 0.0);

  // Calculate latitude and longitude from normal
  let lat = asin(clamp(N.z, -1.0, 1.0));
  let lon = atan2(N.y, N.x);

  // Pseudo land/ocean pattern using spherical harmonics
  let f1 = sin(lat * 4.0 + 0.5) * cos(lon * 3.0 + 1.2);
  let f2 = cos(lat * 6.0) * sin(lon * 5.0 + 0.8);
  let land = smoothstep(0.15, 0.35, f1 * 0.6 + f2 * 0.4);

  // Surface colors
  let ocean = vec3f(0.04, 0.10, 0.30);
  let soil  = vec3f(0.15, 0.22, 0.06);
  let ice   = vec3f(0.7, 0.75, 0.8);
  
  // Polar ice caps
  let pole = smoothstep(1.1, 1.4, abs(lat));
  var surf = mix(mix(ocean, soil, land), ice, pole);

  // Diffuse lighting with ambient
  let ambient = 0.04;
  let lit = surf * (diff * 0.92 + ambient);

  // Night-side city lights
  let night = smoothstep(0.08, -0.08, dot(N, sun_dir));
  let city_pattern = 0.5 + 0.5 * sin(lon * 18.0 + lat * 14.0);
  let city = night * 0.025 * vec3f(1.0, 0.85, 0.4)
             * smoothstep(0.4, 0.6, land)
             * city_pattern;

  return vec4f(lit + city, 1.0);
}
