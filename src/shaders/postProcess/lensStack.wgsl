// LensParams uniform layout (80 bytes, 20 × 4-byte slots):
//  [0]  ca_enabled       u32
//  [1]  ca_strength      f32
//  [2]  flare_enabled    u32
//  [3]  flare_intensity  f32
//  [4]  flare_anamorphic u32
//  [5]  starburst_enabled u32
//  [6]  starburst_points  u32
//  [7]  starburst_intensity f32
//  [8]  vignette_enabled  u32
//  [9]  vignette_intensity f32
//  [10] vignette_smoothness f32
//  [11] vignette_roundness  f32
//  [12..13] sun_screen_pos vec2f
//  [14] sun_intensity     f32
//  [15] (pad)
//  [16..17] screen_size   vec2f
//  [18..19] inv_screen_size vec2f
struct LensParams {
  ca_enabled: u32,
  ca_strength: f32,
  flare_enabled: u32,
  flare_intensity: f32,
  flare_anamorphic: u32,
  starburst_enabled: u32,
  starburst_points: u32,
  starburst_intensity: f32,
  vignette_enabled: u32,
  vignette_intensity: f32,
  vignette_smoothness: f32,
  vignette_roundness: f32,
  sun_screen_pos: vec2f,
  sun_intensity: f32,
  _pad: f32,
  screen_size: vec2f,
  inv_screen_size: vec2f,
};

@group(0) @binding(0) var<uniform> lensParams: LensParams;
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  const pts = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  var out: VSOut;
  out.pos = vec4f(pts[vi], 0, 1);
  out.uv = pts[vi] * 0.5 + 0.5;
  return out;
}

// ── Chromatic Aberration ──────────────────────────────────────────────
fn applyChromaticAberration(uv: vec2f, strength: f32) -> vec3f {
  let center = vec2f(0.5);
  let dist = length(uv - center);
  let dir = normalize(uv - center);
  let aberration = dist * dist * strength;
  let r = textureSample(sourceTexture, linearSampler, uv + dir * aberration).r;
  let g = textureSample(sourceTexture, linearSampler, uv + dir * aberration * 0.5).g;
  let b = textureSample(sourceTexture, linearSampler, uv).b;
  return vec3f(r, g, b);
}

// ── Anamorphic Streak ─────────────────────────────────────────────────
fn anamorphicStreak(uv: vec2f, lightPos: vec2f, intensity: f32, anamorphic: bool) -> vec3f {
  let toLight = lightPos - uv;
  let dist = length(toLight);
  let dir = normalize(toLight);
  var scaledToLight = toLight;
  if (anamorphic) {
    let aspect = lensParams.screen_size.x / lensParams.screen_size.y;
    scaledToLight.y *= aspect;
  }
  let lineDist = abs(dir.x * scaledToLight.y - dir.y * scaledToLight.x);
  let streakWidth = 0.02;
  let streak = exp(-lineDist * lineDist / (streakWidth * streakWidth));
  let falloff = 1.0 / (1.0 + dist * 2.0);
  return vec3f(0.8, 0.9, 1.0) * streak * falloff * intensity;
}

// ── Ghost Flares ──────────────────────────────────────────────────────
fn ghostFlares(uv: vec2f, lightPos: vec2f, intensity: f32) -> vec3f {
  var result = vec3f(0.0);
  let offsets = array<f32, 5>(-0.5, -0.3, 0.2, 0.4, -0.7);
  let intensities = array<f32, 5>(0.4, 0.3, 0.2, 0.15, 0.1);
  let sizes = array<f32, 5>(0.08, 0.06, 0.04, 0.05, 0.1);
  for (var i: i32 = 0; i < 5; i++) {
    let ghostPos = vec2f(0.5) + (lightPos - 0.5) * offsets[i];
    let dist = length(uv - ghostPos);
    let ghost = smoothstep(sizes[i], 0.0, dist);
    let tint = vec3f(1.0 - f32(i) * 0.15, 0.8 + f32(i) * 0.05, 0.6 + f32(i) * 0.1);
    result += tint * ghost * intensities[i];
  }
  return result * intensity;
}

// ── Starburst ─────────────────────────────────────────────────────────
fn applyStarburst(uv: vec2f, lightPos: vec2f, numPoints: u32, intensity: f32) -> f32 {
  let toLight = uv - lightPos;
  let dist = length(toLight);
  let angle = atan2(toLight.y, toLight.x);
  let radialPattern = pow(abs(cos(angle * f32(numPoints))), 8.0);
  let falloff = 1.0 / (1.0 + dist * 3.0);
  let spikeAttenuation = smoothstep(0.3, 0.0, dist);
  return radialPattern * falloff * spikeAttenuation * intensity;
}

// ── Vignette ──────────────────────────────────────────────────────────
fn applyVignette(uv: vec2f, intensity: f32, smoothness: f32, roundness: f32) -> f32 {
  let pos = uv * 2.0 - 1.0;
  let d = length(pos);
  return clamp(1.0 - smoothness * pow(d, roundness) * intensity, 0.0, 1.0);
}

// ── Fragment ──────────────────────────────────────────────────────────
@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let uv = in.uv;
  var color: vec3f;

  // Chromatic aberration
  if (lensParams.ca_enabled != 0u) {
    color = applyChromaticAberration(uv, lensParams.ca_strength);
  } else {
    color = textureSample(sourceTexture, linearSampler, uv).rgb;
  }

  // Lens flare (sun + automatic bright-spot detection)
  if (lensParams.flare_enabled != 0u) {
    let sunPos = lensParams.sun_screen_pos;
    let sunInView = all(sunPos > vec2f(0.0)) && all(sunPos < vec2f(1.0));
    if (sunInView) {
      color += anamorphicStreak(uv, sunPos,
        lensParams.flare_intensity * lensParams.sun_intensity,
        lensParams.flare_anamorphic != 0u);
      color += ghostFlares(uv, sunPos, lensParams.flare_intensity * 0.5);
    }
  }

  // Starburst diffraction
  if (lensParams.starburst_enabled != 0u) {
    let sunPos = lensParams.sun_screen_pos;
    let sunInView = all(sunPos > vec2f(0.0)) && all(sunPos < vec2f(1.0));
    if (sunInView) {
      color += vec3f(applyStarburst(uv, sunPos,
        lensParams.starburst_points,
        lensParams.starburst_intensity * lensParams.sun_intensity));
    }
  }

  // Vignetting
  if (lensParams.vignette_enabled != 0u) {
    color *= applyVignette(uv,
      lensParams.vignette_intensity,
      lensParams.vignette_smoothness,
      lensParams.vignette_roundness);
  }

  return vec4f(color, 1.0);
}
