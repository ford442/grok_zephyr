/**
 * Depth-of-field downsample pass
 * Produces half-resolution scene color with CoC stored in alpha.
 *
 * Bindings:
 *   0 === sceneTex (full-res HDR scene)
 *   1 === depthTex (full-res depth texture)
 *   2 === linearSamp
 *   3 === dofUni (DoF parameters)
 */

export const DOF_DOWNSAMPLE = /* wgsl */ `
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
@group(0) @binding(1) var depthTex : texture_depth_2d;
@group(0) @binding(2) var linearSamp : sampler;
@group(0) @binding(3) var<uniform> dofUni : DofUni;

fn linearizeDepth(rawDepth: f32) -> f32 {
  return (dofUni.nearPlane * dofUni.farPlane) /
         max(dofUni.farPlane - rawDepth * (dofUni.farPlane - dofUni.nearPlane), 0.001);
}

fn readLinearDepth(uv: vec2f) -> f32 {
  let dims = vec2i(textureDimensions(depthTex));
  let p = clamp(vec2i(uv * vec2f(dims)), vec2i(0), dims - vec2i(1));
  let raw = textureLoad(depthTex, p, 0);
  return linearizeDepth(raw);
}

fn focusDepth() -> f32 {
  if (dofUni.focusMode == 0u) {
    return readLinearDepth(vec2f(0.5, 0.5));
  }
  if (dofUni.focusMode == 2u) {
    return dofUni.surfaceDistance;
  }
  return dofUni.focusDistance;
}

fn cocForDepth(depthKm: f32, focusKm: f32) -> f32 {
  let norm = abs(depthKm - focusKm) / max(depthKm, 0.001);
  return clamp(norm * dofUni.cocScale * dofUni.maxBlurPx, 0.0, dofUni.maxBlurPx);
}

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let texel = 1.0 / vec2f(textureDimensions(sceneTex, 0));
  let c0 = textureSample(sceneTex, linearSamp, uv).rgb;
  let c1 = textureSample(sceneTex, linearSamp, uv + vec2f(texel.x, 0.0)).rgb;
  let c2 = textureSample(sceneTex, linearSamp, uv + vec2f(0.0, texel.y)).rgb;
  let c3 = textureSample(sceneTex, linearSamp, uv + texel).rgb;
  let color = (c0 + c1 + c2 + c3) * 0.25;

  let depthKm = readLinearDepth(uv);
  let focusKm = focusDepth();
  let coc = cocForDepth(depthKm, focusKm);
  return vec4f(color, coc);
}
`;
