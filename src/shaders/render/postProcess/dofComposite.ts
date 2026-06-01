/**
 * Depth-of-field composite pass.
 * Mixes sharp full-resolution scene with blurred half-resolution DoF buffer.
 *
 * Bindings:
 *   0 === sceneTex
 *   1 === blurTex (half-res, alpha = CoC)
 *   2 === linearSamp
 *   3 === dofUni
 */

export const DOF_COMPOSITE = /* wgsl */ `
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

@group(0) @binding(0) var sceneTex : texture_2d<f32>;
@group(0) @binding(1) var blurTex : texture_2d<f32>;
@group(0) @binding(2) var linearSamp : sampler;
@group(0) @binding(3) var<uniform> dofUni : DofUni;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let sharp = textureSample(sceneTex, linearSamp, uv);
  let blur = textureSample(blurTex, linearSamp, uv);
  let cocNorm = clamp(blur.a / max(dofUni.maxBlurPx, 0.001), 0.0, 1.0);
  let mixW = smoothstep(0.08, 0.85, cocNorm);
  return vec4f(mix(sharp.rgb, blur.rgb, mixW), sharp.a);
}
`;
