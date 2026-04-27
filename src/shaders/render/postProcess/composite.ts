/**
 * Composite Shader
 * Final tone mapping, vignetting, chromatic aberration, film grain, anamorphic streak
 *
 * Bindings:
 *   0 — sceneTex  (HDR scene)
 *   1 — bloomTex  (blurred bloom)
 *   2 — linearSamp
 *   3 — uni       (shared Uni uniform buffer — for uni.time)
 */

export const COMPOSITE = /* wgsl */ `
// Minimal mirror of the shared Uni struct (must match GPU buffer layout exactly)
struct Uni {
  view_proj      : mat4x4f,
  camera_pos     : vec4f,
  camera_right   : vec4f,
  camera_up      : vec4f,
  time           : f32,
  delta_time     : f32,
  view_mode      : u32,
  is_ground_view : u32,
  frustum        : array<vec4f, 6>,
  screen_size    : vec2f,
  physics_mode   : u32,
  pad1           : u32,
};

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VSOut {
  // Full-screen triangle — single large triangle that covers the entire viewport
  const pts = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0)
  );
  var out: VSOut;
  out.pos = vec4f(pts[vid], 0.0, 1.0);
  out.uv  = pts[vid] * 0.5 + 0.5;
  return out;
}

@group(0) @binding(0) var sceneTex  : texture_2d<f32>;
@group(0) @binding(1) var bloomTex  : texture_2d<f32>;
@group(0) @binding(2) var linearSamp: sampler;
@group(0) @binding(3) var<uniform>  uni: Uni;

const EXPOSURE        : f32 = 1.0;
const GAMMA           : f32 = 2.2;
const VIGNETTE_STRENGTH: f32 = 0.4;
const VIGNETTE_INNER  : f32 = 0.5;
const VIGNETTE_OUTER  : f32 = 1.2;
const CA_STRENGTH     : f32 = 0.003;
const GRAIN_STRENGTH  : f32 = 0.025;
const BLOOM_STRENGTH  : f32 = 1.8;
const STREAK_STRENGTH : f32 = 0.30;

fn acesToneMapping(hdr: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((hdr * (a * hdr + b)) / (hdr * (c * hdr + d) + e), vec3f(0.0), vec3f(1.0));
}

fn applyVignette(color: vec3f, uv: vec2f) -> vec3f {
  // sqrt(2) ≈ 1.414 normalises distance so screen corners = 1.0
  let dist = length((uv - 0.5) * 1.414);
  let vignette = 1.0 - smoothstep(VIGNETTE_INNER, VIGNETTE_OUTER, dist);
  let naturalVignette = pow(vignette, 4.0);
  return color * mix(vignette, naturalVignette, 0.3);
}

fn applyChromaticAberration(uv: vec2f) -> vec3f {
  let center = uv - 0.5;
  let dist   = length(center);
  let dir    = normalize(center + vec2f(0.0001));
  let amount = dist * dist * CA_STRENGTH;
  let r = textureSample(sceneTex, linearSamp, uv + dir * amount).r;
  let g = textureSample(sceneTex, linearSamp, uv + dir * amount * 0.5).g;
  let b = textureSample(sceneTex, linearSamp, uv).b;
  return vec3f(r, g, b);
}

fn filmGrain(uv: vec2f, time: f32) -> f32 {
  let hash = fract(sin(dot(uv * fract(time * 0.1 + 0.37), vec2f(12.9898, 78.233))) * 43758.5453);
  return hash * 2.0 - 1.0;
}

// Anamorphic horizontal streak — simulates anamorphic lens flare on bright pixels
fn anamorphicStreak(uv: vec2f) -> vec3f {
  var streak = vec3f(0.0);
  let tx = 1.0 / f32(textureDimensions(bloomTex, 0).x);
  for (var i: i32 = -6; i <= 6; i++) {
    let w = exp(-f32(i * i) * 0.08);
    streak += textureSample(bloomTex, linearSamp, uv + vec2f(f32(i) * tx * 3.0, 0.0)).rgb * w;
  }
  return streak;
}

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  // Chromatic aberration on scene texture
  let scene  = applyChromaticAberration(uv);
  let bloom  = textureSample(bloomTex, linearSamp, uv).rgb;
  let streak = anamorphicStreak(uv);

  let hdr = scene + bloom * BLOOM_STRENGTH + streak * STREAK_STRENGTH;
  let mapped = acesToneMapping(hdr * EXPOSURE);
  let gammaCorrected = pow(max(mapped, vec3f(0.0)), vec3f(1.0 / GAMMA));

  // Vignette
  let vignetted = applyVignette(gammaCorrected, uv);

  // Film grain (luminance-preserving)
  let grain = filmGrain(uv, uni.time);
  let lum   = dot(vignetted, vec3f(0.299, 0.587, 0.114));
  let grained = vignetted + grain * GRAIN_STRENGTH * (1.0 - lum);

  return vec4f(clamp(grained, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;
