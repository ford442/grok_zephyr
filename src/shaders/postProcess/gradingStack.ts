export const GRADING_STACK_SHADER = /* wgsl */ `struct GradingUniforms {
  lift: vec3f,
  pad1: f32,
  gamma: vec3f,
  pad2: f32,
  gain: vec3f,
  saturation: f32,
  contrast: f32,
  brightness: f32,
  pad3: f32,
};

@group(0) @binding(0) var<uniform> gradingUniforms: GradingUniforms;
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  const pts = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  return vec4f(pts[vi], 0, 1);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / vec2f(textureDimensions(sourceTexture));
  var col = textureSample(sourceTexture, linearSampler, uv).rgb;

  // Lift/Gamma/Gain
  col = pow(col * (1.0 + gradingUniforms.gain - gradingUniforms.lift) + gradingUniforms.lift,
            1.0 / gradingUniforms.gamma);

  // Saturation
  let lum = dot(col, vec3f(0.2126, 0.7152, 0.0722));
  col = mix(vec3f(lum), col, gradingUniforms.saturation);

  // Contrast
  col = (col - 0.5) * gradingUniforms.contrast + 0.5 + gradingUniforms.brightness;

  return vec4f(col, 1.0);
}
`;
