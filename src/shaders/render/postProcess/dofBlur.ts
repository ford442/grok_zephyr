/**
 * Depth-of-field bilateral blur pass.
 * Input alpha channel stores CoC radius in pixels.
 *
 * Bindings:
 *   0 === dofUni
 *   1 === srcTex (half-res DoF texture)
 *   2 === linearSamp
 */

export const DOF_BLUR = /* wgsl */ `
struct DofUni {
  focusDistance : f32,
  surfaceDistance : f32,
  maxBlurPx : f32,
  cocScale : f32,
  focusMode : u32,
  depthSigma : f32,
  nearPlane : f32,
  farPlane : f32,
};

struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VSOut {
  const pts = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0)
  );
  var out: VSOut;
  out.pos = vec4f(pts[vid], 0.0, 1.0);
  out.uv = pts[vid] * 0.5 + 0.5;
  return out;
}

@group(0) @binding(0) var<uniform> dofUni : DofUni;
@group(0) @binding(1) var srcTex : texture_2d<f32>;
@group(0) @binding(2) var linearSamp : sampler;

const W = array<f32, 6>(0.196482, 0.176032, 0.120981, 0.064759, 0.026995, 0.008764);

fn cocWeight(center: f32, sample: f32) -> f32 {
  let d = abs(center - sample) / max(dofUni.maxBlurPx, 0.001);
  return exp(-d * d * dofUni.depthSigma);
}

fn blurAxis(uv: vec2f, axis: vec2f) -> vec4f {
  let center = textureSample(srcTex, linearSamp, uv);
  let radius = clamp(center.a * 0.5, 0.5, max(dofUni.maxBlurPx * 0.5, 0.5));
  let texel = axis / vec2f(textureDimensions(srcTex, 0));

  var accum = center.rgb * W[0];
  var cocAccum = center.a * W[0];
  var weight = W[0];

  for (var i = 1; i <= 5; i++) {
    let fi = f32(i);
    let off = texel * fi * radius;
    let s1 = textureSample(srcTex, linearSamp, uv + off);
    let s2 = textureSample(srcTex, linearSamp, uv - off);
    let w1 = W[i] * cocWeight(center.a, s1.a);
    let w2 = W[i] * cocWeight(center.a, s2.a);
    accum += s1.rgb * w1 + s2.rgb * w2;
    cocAccum += s1.a * w1 + s2.a * w2;
    weight += w1 + w2;
  }

  let invW = 1.0 / max(weight, 0.0001);
  return vec4f(accum * invW, cocAccum * invW);
}

@fragment
fn fsHorizontal(@location(0) uv: vec2f) -> @location(0) vec4f {
  return blurAxis(uv, vec2f(1.0, 0.0));
}

@fragment
fn fsVertical(@location(0) uv: vec2f) -> @location(0) vec4f {
  return blurAxis(uv, vec2f(0.0, 1.0));
}
`;
