/**
 * Composite Shader
 * Final tone mapping, vignetting, chromatic aberration, film grain, anamorphic streak
 *
 * Bindings:
 *   0 === sceneTex  (HDR scene)
 *   1 === bloomTex  (blurred bloom pyramid result)
 *   2 === linearSamp
 *   3 === uni       (shared Uni uniform buffer === for uni.time)
 *   4 === bloomUni  (BloomCompositeUni: intensity + anamorphic control)
 *   5 === exposureState (storage: adapted exposure f32[1])
 *   6 === tonemapUni (Tonemap controls)
 *
 * NOTE: The `Uni` struct below MUST match the layout in src/shaders/uniforms.ts exactly.
 * If fields are added to the shared struct, update this copy to keep the byte offsets aligned.
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
  sim_time       : f32,
  frustum        : array<vec4f, 6>,
  screen_size    : vec2f,
  time_scale     : f32,
  background_mode: u32,
  sun_position   : vec4f,
};

// Bloom composite parameters — CPU packer: packBloomCompositeUni() in uniformLayouts.ts
struct BloomCompositeUni {
  bloomIntensity    : f32,
  anamorphicEnabled : u32,   // 1 = enabled, 0 = disabled
  anamorphicRatio   : f32,
  pad               : f32,
};

struct TonemapUni {
  autoExposure   : u32, // 1 = auto, 0 = manual
  tonemapMode    : u32, // 0=ACES, 1=AgX, 2=Reinhard, 3=Uncharted2
  manualExposure : f32,
  extendedOutput : u32, // 1 = HDR extended-range swapchain output
};

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VSOut {
  // Full-screen triangle === single large triangle that covers the entire viewport
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
@group(0) @binding(4) var<uniform>  bloomUni: BloomCompositeUni;
@group(0) @binding(5) var<storage, read> exposureState: array<f32, 1>;
@group(0) @binding(6) var<uniform> tonemapUni: TonemapUni;

const GAMMA           : f32 = 2.2;
const VIGNETTE_STRENGTH: f32 = 0.4;
const VIGNETTE_INNER  : f32 = 0.5;
const VIGNETTE_OUTER  : f32 = 1.2;
const CA_STRENGTH     : f32 = 0.003;
const GRAIN_STRENGTH  : f32 = 0.025;

fn acesToneMapping(hdr: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((hdr * (a * hdr + b)) / (hdr * (c * hdr + d) + e), vec3f(0.0), vec3f(1.0));
}

fn acesToneMappingExtended(hdr: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return max((hdr * (a * hdr + b)) / (hdr * (c * hdr + d) + e), vec3f(0.0));
}

fn agxToneMapping(hdr: vec3f) -> vec3f {
  let m = mat3x3f(
    vec3f(0.84247906, 0.0784336, 0.07922375),
    vec3f(0.04232824, 0.87846864, 0.07916613),
    vec3f(0.04237565, 0.0784336, 0.87914297)
  );
  let v = max(m * max(hdr, vec3f(0.0)), vec3f(0.0));
  let x = (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
  return clamp(x, vec3f(0.0), vec3f(1.0));
}

fn agxToneMappingExtended(hdr: vec3f) -> vec3f {
  let m = mat3x3f(
    vec3f(0.84247906, 0.0784336, 0.07922375),
    vec3f(0.04232824, 0.87846864, 0.07916613),
    vec3f(0.04237565, 0.0784336, 0.87914297)
  );
  let v = max(m * max(hdr, vec3f(0.0)), vec3f(0.0));
  let x = (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
  return max(x, vec3f(0.0));
}

fn reinhardModified(hdr: vec3f) -> vec3f {
  let whitePoint = 4.0;
  return clamp((hdr * (1.0 + hdr / (whitePoint * whitePoint))) / (1.0 + hdr), vec3f(0.0), vec3f(1.0));
}

fn reinhardModifiedExtended(hdr: vec3f) -> vec3f {
  let whitePoint = 4.0;
  return max((hdr * (1.0 + hdr / (whitePoint * whitePoint))) / (1.0 + hdr), vec3f(0.0));
}

fn uncharted2ToneMapping(x: vec3f) -> vec3f {
  let A = 0.15;
  let B = 0.50;
  let C = 0.10;
  let D = 0.20;
  let E = 0.02;
  let F = 0.30;
  return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;
}

fn applySelectedTonemap(exposed: vec3f, mode: u32, extended: bool) -> vec3f {
  switch mode {
    case 1u: {
      return select(agxToneMapping(exposed), agxToneMappingExtended(exposed), extended);
    }
    case 2u: {
      return select(reinhardModified(exposed), reinhardModifiedExtended(exposed), extended);
    }
    case 3u: {
      let whitePoint = 11.2;
      let mapped = uncharted2ToneMapping(exposed * 2.0) / uncharted2ToneMapping(vec3f(whitePoint));
      return select(clamp(mapped, vec3f(0.0), vec3f(1.0)), max(mapped, vec3f(0.0)), extended);
    }
    default: {
      return select(acesToneMapping(exposed), acesToneMappingExtended(exposed), extended);
    }
  }
}

fn applyVignette(color: vec3f, uv: vec2f) -> vec3f {
  // sqrt(2) = 1.414 normalises distance so screen corners = 1.0
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

// Anamorphic horizontal streak === simulates anamorphic lens flare on bright pixels.
// Only executed when bloomUni.anamorphicEnabled != 0.
fn anamorphicStreak(uv: vec2f) -> vec3f {
  var streak = vec3f(0.0);
  let tx = 1.0 / f32(textureDimensions(bloomTex, 0).x);
  for (var i: i32 = -6; i <= 6; i++) {
    let w = exp(-f32(i * i) * 0.08);
    streak += textureSample(bloomTex, linearSamp, uv + vec2f(f32(i) * tx * 3.0, 0.0)).rgb * w;
  }
  return streak;
}

// Post-threshold compensation with scene-guided star vs satellite bloom layering.
// Limb mid-band is attenuated so atmospheric glow does not wash out stars (#77).
fn compositeBloom(bloom: vec3f, scene: vec3f, intensity: f32) -> vec3f {
  let sceneLum = dot(scene, vec3f(0.2126, 0.7152, 0.0722));

  // Tight bloom on hot satellite peaks; softer wide star bloom elsewhere.
  let satMix = smoothstep(2.4, 4.2, sceneLum);
  let starMix = (1.0 - smoothstep(2.8, 4.5, sceneLum)) * smoothstep(0.12, 1.0, sceneLum);
  let limbBand = smoothstep(0.32, 1.25, sceneLum) * (1.0 - smoothstep(1.25, 2.5, sceneLum));

  var layered = bloom * mix(0.72, 1.18, satMix);
  layered += bloom * starMix * 0.48;
  layered *= mix(1.0, 0.48, limbBand);

  let lum = dot(layered, vec3f(0.2126, 0.7152, 0.0722));
  let haloLift = mix(1.42, 1.0, smoothstep(0.03, 0.38, lum));
  let soft = layered / max(vec3f(1.0), layered * 0.14 + vec3f(0.10));
  return soft * intensity * haloLift;
}

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  // Chromatic aberration on scene texture
  let scene  = applyChromaticAberration(uv);
  let bloom  = textureSample(bloomTex, linearSamp, uv).rgb;

  // Anamorphic streaks are gated behind the uniform flag
  var streak = vec3f(0.0);
  if (bloomUni.anamorphicEnabled != 0u) {
    streak = anamorphicStreak(uv);
  }

  let hdr = scene + compositeBloom(bloom, scene, bloomUni.bloomIntensity) + streak * bloomUni.anamorphicRatio;
  let autoExposure = max(0.01, exposureState[0]);
  let exposure = select(max(0.01, tonemapUni.manualExposure), autoExposure, tonemapUni.autoExposure != 0u);
  let exposed = hdr * exposure;
  let extended = tonemapUni.extendedOutput != 0u;
  let mapped = applySelectedTonemap(exposed, tonemapUni.tonemapMode, extended);

  if (extended) {
    // Extended-range swapchain: keep filmic rolloff but allow values above 1.0 (linear output).
    let vignetted = applyVignette(mapped, uv);
    let grain = filmGrain(uv, uni.time);
    let lum = dot(vignetted, vec3f(0.299, 0.587, 0.114));
    let grained = vignetted + grain * GRAIN_STRENGTH * (1.0 - min(lum, 1.0));
    return vec4f(max(grained, vec3f(0.0)), 1.0);
  }

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
