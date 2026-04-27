/**
 * Composite Shader
 * Final tone mapping, vignetting, chromatic aberration, film grain
 */

export const COMPOSITE = /* wgsl */ `
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VSOut {
  var out: VSOut;
  let x = f32(vid % 2u) * 2.0 - 1.0;
  let y = f32(vid / 2u) * 2.0 - 1.0;
  out.pos = vec4f(x, y, 0.0, 1.0);
  out.uv = vec4f(x, y, 0.0, 1.0).xy * 0.5 + 0.5;
  return out;
}

@group(0) @binding(0) var sceneTex: texture_2d<f32>;
@group(0) @binding(1) var bloomTex: texture_2d<f32>;
@group(0) @binding(2) var linearSamp: sampler;

const EXPOSURE: f32 = 1.0;
const GAMMA: f32 = 2.2;
const VIGNETTE_STRENGTH: f32 = 0.4;
const VIGNETTE_INNER: f32 = 0.5;
const VIGNETTE_OUTER: f32 = 1.2;
const CA_STRENGTH: f32 = 0.003;
const GRAIN_STRENGTH: f32 = 0.03;

fn acesToneMapping(hdr: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((hdr * (a * hdr + b)) / (hdr * (c * hdr + d) + e), vec3f(0.0), vec3f(1.0));
}

fn applyVignette(color: vec3f, uv: vec2f) -> vec3f {
  // sqrt(2) ≈ 1.414 normalizes distance so corners = 1.0
  let dist = length((uv - 0.5) * 1.414);
  let vignette = 1.0 - smoothstep(VIGNETTE_INNER, VIGNETTE_OUTER, dist);
  let naturalVignette = pow(vignette, 4.0);
  return color * mix(vignette, naturalVignette, 0.3);
}

fn applyChromaticAberration(uv: vec2f) -> vec3f {
  let center = uv - 0.5;
  let dist = length(center);
  let dir = normalize(center + vec2f(0.0001));
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

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  // Chromatic aberration on scene texture
  let scene = applyChromaticAberration(uv);
  let bloom = textureSample(bloomTex, linearSamp, uv).rgb;

  let hdr = scene + bloom * 0.5;
  let mapped = acesToneMapping(hdr * EXPOSURE);
  let gammaCorrected = pow(mapped, vec3f(1.0 / GAMMA));

  // Apply vignette
  let vignetted = applyVignette(gammaCorrected, uv);

  // Apply film grain (luminance-preserving)
  let grain = filmGrain(uv, 0.0);
  let lum = dot(vignetted, vec3f(0.299, 0.587, 0.114));
  let grained = vignetted + grain * GRAIN_STRENGTH * (1.0 - lum);

  return vec4f(clamp(grained, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;
