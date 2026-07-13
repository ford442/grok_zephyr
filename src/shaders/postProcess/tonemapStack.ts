export const TONEMAP_STACK_SHADER = /* wgsl */ `@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  const pts = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  return vec4f(pts[vi], 0, 1);
}

fn aces(x: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / vec2f(textureDimensions(sourceTexture));
  let col = textureSample(sourceTexture, linearSampler, uv).rgb;

  // ACES tonemapping
  let result = aces(col);

  // Slight saturation boost after tonemap
  let lum = dot(result, vec3f(0.2126, 0.7152, 0.0722));
  let saturated = mix(vec3f(lum), result, 1.05);

  return vec4f(saturated, 1.0);
}

@fragment
fn fs_passthrough(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / vec2f(textureDimensions(sourceTexture));
  return textureSample(sourceTexture, linearSampler, uv);
}
`;
