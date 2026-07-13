export const GRAIN_STACK_SHADER = /* wgsl */ `struct GrainUniforms {
  intensity: f32,
  seed: f32,
  pad: vec2f,
};

@group(0) @binding(0) var<uniform> grainUniforms: GrainUniforms;
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;

fn random(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453);
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  const pts = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  return vec4f(pts[vi], 0, 1);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / vec2f(textureDimensions(sourceTexture));
  var col = textureSample(sourceTexture, linearSampler, uv).rgb;

  // Film grain
  let grain = random(uv + grainUniforms.seed) * 2.0 - 1.0;
  col = col + grain * grainUniforms.intensity;

  return vec4f(col, 1.0);
}
`;
