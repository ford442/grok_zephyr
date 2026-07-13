export const SHARPNESS_STACK_SHADER = /* wgsl */ `struct SharpnessUniforms {
  strength: f32,
  pad: vec3f,
};

@group(0) @binding(0) var<uniform> sharpnessUniforms: SharpnessUniforms;
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  const pts = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  return vec4f(pts[vi], 0, 1);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let dim = vec2f(textureDimensions(sourceTexture));
  let uv = pos.xy / dim;
  let texel = 1.0 / dim;

  let center = textureSample(sourceTexture, linearSampler, uv).rgb;

  // Laplacian kernel
  var sum = vec3f(0.0);
  sum += textureSample(sourceTexture, linearSampler, uv + vec2f(texel.x, 0.0)).rgb;
  sum += textureSample(sourceTexture, linearSampler, uv - vec2f(texel.x, 0.0)).rgb;
  sum += textureSample(sourceTexture, linearSampler, uv + vec2f(0.0, texel.y)).rgb;
  sum += textureSample(sourceTexture, linearSampler, uv - vec2f(0.0, texel.y)).rgb;

  let sharpened = center * 5.0 - sum;
  let result = mix(center, sharpened, sharpnessUniforms.strength);

  return vec4f(result, 1.0);
}
`;
