/**
 * Screen-space camera motion blur pass.
 * Reconstructs world position from depth and reprojects with previous VP.
 */
export const MOTION_BLUR = /* wgsl */ `
struct MotionBlurUni {
  prev_view_proj : mat4x4f,
  inv_view_proj : mat4x4f,
  camera_strength : f32,
  satellite_stretch : f32,
  delta_time : f32,
  tap_count : u32,
  host_velocity : vec3f,
  fleet_pad : f32,
};

@group(0) @binding(0) var sceneTex : texture_2d<f32>;
@group(0) @binding(1) var depthTex : texture_depth_2d;
@group(0) @binding(2) var linSamp : sampler;
@group(0) @binding(3) var<uniform> mb : MotionBlurUni;

struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> VSOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(-1.0, 1.0), vec2f(3.0, 1.0));
  var o : VSOut;
  let xy = p[vi];
  o.pos = vec4f(xy, 0.0, 1.0);
  o.uv = xy * 0.5 + 0.5;
  return o;
}

fn safeNormalize(v: vec2f) -> vec2f {
  let l = length(v);
  if (l < 1e-5) {
    return vec2f(0.0, 0.0);
  }
  return v / l;
}

@fragment
fn fs(i: VSOut) -> @location(0) vec4f {
  let depthDims = textureDimensions(depthTex);
  let depthCoord = clamp(vec2i(i.uv * vec2f(depthDims)), vec2i(0), vec2i(depthDims) - vec2i(1));
  let depth = textureLoad(depthTex, depthCoord, 0);
  let base = textureSampleLevel(sceneTex, linSamp, i.uv, 0.0);

  let ndcNow = vec2f(i.uv * 2.0 - 1.0);
  let clipNow = vec4f(ndcNow, depth, 1.0);
  let worldH = mb.inv_view_proj * clipNow;
  let world = worldH.xyz / max(worldH.w, 1e-5);

  let prevClip = mb.prev_view_proj * vec4f(world, 1.0);
  let prevNdc = prevClip.xy / max(prevClip.w, 1e-5);

  var motion = (ndcNow - prevNdc) * 0.5 * mb.camera_strength;
  motion = clamp(motion, vec2f(-0.025), vec2f(0.025));

  let taps = clamp(i32(mb.tap_count), 1, 16);
  let shouldBlur = depth < 0.999999 && mb.camera_strength > 0.0001 && length(motion) >= 1e-5 && taps > 1;

  let dir = safeNormalize(motion);
  let len = length(motion);
  var accum = vec3f(0.0);
  var wsum = 0.0;

  for (var t = 0; t < 16; t++) {
    let activeTap = t < taps;
    let u = (f32(t) + 0.5) / f32(max(taps, 1));
    let centered = (u - 0.5) * 2.0;
    let weight = select(0.0, 1.0 - abs(centered), shouldBlur && activeTap);
    let sampleUv = i.uv + dir * (centered * len);
    let c = textureSampleLevel(sceneTex, linSamp, sampleUv, 0.0).rgb;
    accum += c * weight;
    wsum += weight;
  }

  let blurred = accum / max(wsum, 1e-5);
  let color = select(base.rgb, blurred, shouldBlur);
  return vec4f(color, base.a);
}
`;
