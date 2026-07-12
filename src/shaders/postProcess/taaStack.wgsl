struct TAAUniforms {
  jitter: vec2f,
  historyWeight: f32,
  pad: f32,
};

@group(0) @binding(0) var<uniform> taaUniforms: TAAUniforms;
@group(0) @binding(1) var currentFrame: texture_2d<f32>;
@group(0) @binding(2) var historyFrame: texture_2d<f32>;
@group(0) @binding(3) var linearSampler: sampler;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  const pts = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  return vec4f(pts[vi], 0, 1);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / vec2f(textureDimensions(currentFrame));
  let current = textureSample(currentFrame, linearSampler, uv).rgb;
  let history = textureSample(historyFrame, linearSampler, uv).rgb;
  let blended = mix(current, history, taaUniforms.historyWeight);
  return vec4f(blended, 1.0);
}
