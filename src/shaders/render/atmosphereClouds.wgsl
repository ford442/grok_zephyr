// Earth Atmosphere Cloud Sheet
//
// A thin animated cloud shell drawn just above the Earth sphere in Ground View
// (src/render/EarthAtmosphereRenderer.ts). Reuses the Earth sphere mesh, offset
// outward, with procedural 3D FBM coverage and a view-dependent limb term.
#import "uniforms.wgsl"

struct VIn {
  @location(0) pos: vec3f,
  @location(1) nrm: vec3f,
};

struct VOut {
  @builtin(position) cp : vec4f,
  @location(0) wp : vec3f,
  @location(1) viewDir : vec3f,
};

fn hash3d(p: vec3f) -> f32 {
  let h = dot(p, vec3f(127.1, 311.7, 74.7));
  return fract(sin(h) * 43758.5453123);
}

fn noise3d(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);

  let a = hash3d(i + vec3f(0.0, 0.0, 0.0));
  let b = hash3d(i + vec3f(1.0, 0.0, 0.0));
  let c = hash3d(i + vec3f(0.0, 1.0, 0.0));
  let d = hash3d(i + vec3f(1.0, 1.0, 0.0));
  let e = hash3d(i + vec3f(0.0, 0.0, 1.0));
  let f0 = hash3d(i + vec3f(1.0, 0.0, 1.0));
  let g = hash3d(i + vec3f(0.0, 1.0, 1.0));
  let h = hash3d(i + vec3f(1.0, 1.0, 1.0));

  let x0 = mix(a, b, u.x);
  let x1 = mix(c, d, u.x);
  let y0 = mix(x0, x1, u.y);
  let x2 = mix(e, f0, u.x);
  let x3 = mix(g, h, u.x);
  let y1 = mix(x2, x3, u.y);
  return mix(y0, y1, u.z);
}

fn fbm(p: vec3f) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var frequency = 1.0;
  for (var i = 0; i < 5; i++) {
    value += amplitude * noise3d(p * frequency);
    frequency *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

@vertex
fn vs(in: VIn) -> VOut {
  var out: VOut;
  let worldPos = in.pos * 1.007;
  out.cp = uni.view_proj * vec4f(worldPos, 1.0);
  out.wp = worldPos;
  out.viewDir = normalize(uni.camera_pos.xyz - worldPos);
  return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let n = normalize(in.wp);
  let cloudNoise = fbm(n * 12.0 + vec3f(uni.time * 0.02, uni.time * 0.01, 0.0));
  let cloudStripes = sin(n.x * 45.0 + uni.time * 0.12) * 0.5 + 0.5;
  let coverage = smoothstep(0.38, 0.58, cloudNoise + 0.25 * cloudStripes);
  let edge = pow(clamp(1.0 - abs(dot(n, in.viewDir)), 0.0, 1.0), 2.4);
  var alpha = coverage * 0.45 + edge * 0.15;
  alpha *= 0.85;

  let color = vec3f(1.0, 1.02, 1.08) * 0.92;
  return vec4f(color, alpha);
}

