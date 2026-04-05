/**
 * Lens Effects Shader
 * 
 * Cinematic lens effects including:
 * - Chromatic aberration (RGB split at edges)
 * - Anamorphic lens flare for bright satellites
 * - 6-point starburst diffraction
 * - Vignetting with adjustable intensity
 */

// Effect parameters (set via uniform buffer)
struct LensParams {
  // Chromatic aberration
  ca_enabled: u32,
  ca_strength: f32,
  
  // Lens flare
  flare_enabled: u32,
  flare_intensity: f32,
  flare_anamorphic: u32,
  
  // Starburst
  starburst_enabled: u32,
  starburst_points: u32,
  starburst_intensity: f32,
  
  // Vignette
  vignette_enabled: u32,
  vignette_intensity: f32,
  vignette_smoothness: f32,
  vignette_roundness: f32,
  
  // Sun position for flare
  sun_screen_pos: vec2f,
  sun_intensity: f32,
  
  // Screen params
  screen_size: vec2f,
  inv_screen_size: vec2f,
};

@group(0) @binding(0) var<uniform> lensParams: LensParams;
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;
@group(0) @binding(2) var depthTexture: texture_2d<f32>;
@group(0) @binding(3) var linearSampler: sampler;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
  const pts = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  var out: VSOut;
  out.pos = vec4f(pts[vi], 0, 1);
  out.uv = pts[vi] * 0.5 + 0.5;
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHROMATIC ABERRATION
// ═══════════════════════════════════════════════════════════════════════════════

fn applyChromaticAberration(uv: vec2f, strength: f32) -> vec3f {
  // Calculate distance from center
  let center = vec2f(0.5, 0.5);
  let dist = length(uv - center);
  let dir = normalize(uv - center);
  
  // Aberration increases toward edges
  let aberration = dist * dist * strength;
  
  // Sample RGB with offset
  let r = textureSample(sourceTexture, linearSampler, uv + dir * aberration * 1.0).r;
  let g = textureSample(sourceTexture, linearSampler, uv + dir * aberration * 0.5).g;
  let b = textureSample(sourceTexture, linearSampler, uv).b;
  
  return vec3f(r, g, b);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANAMORPHIC LENS FLARE
// ═══════════════════════════════════════════════════════════════════════════════

// Generate anamorphic streak from bright light source
fn anamorphicStreak(
  uv: vec2f,
  lightPos: vec2f,
  intensity: f32,
  anamorphic: bool
) -> vec3f {
  let toLight = lightPos - uv;
  let dist = length(toLight);
  let dir = normalize(toLight);
  
  // Anamorphic flare stretches horizontally
  var flareUV = uv;
  if (anamorphic) {
    // Compress vertically for anamorphic look
    let aspect = lensParams.screen_size.x / lensParams.screen_size.y;
    flareUV.y = (flareUV.y - 0.5) * aspect + 0.5;
  }
  
  // Distance from the line through light center
  let lineDist = abs(dir.x * toLight.y - dir.y * toLight.x);
  
  // Gaussian streak along the line
  let streakWidth = 0.02;
  let streak = exp(-lineDist * lineDist / (streakWidth * streakWidth));
  
  // Attenuate with distance from light
  let falloff = 1.0 / (1.0 + dist * 2.0);
  
  // Anamorphic color (cyan/magenta tint)
  let flareColor = vec3f(0.8, 0.9, 1.0);
  
  return flareColor * streak * falloff * intensity;
}

// Ghost flares (internal reflections)
fn ghostFlares(uv: vec2f, lightPos: vec2f, intensity: f32) -> vec3f {
  var result = vec3f(0.0);
  
  // Multiple ghost reflections at different positions
  let ghosts = array<vec2f, 5>(
    vec2f(0.5, 0.5) + (lightPos - 0.5) * -0.5,
    vec2f(0.5, 0.5) + (lightPos - 0.5) * -0.3,
    vec2f(0.5, 0.5) + (lightPos - 0.5) * 0.2,
    vec2f(0.5, 0.5) + (lightPos - 0.5) * 0.4,
    vec2f(0.5, 0.5) + (lightPos - 0.5) * -0.7
  );
  
  let ghostIntensities = array<f32, 5>(0.4, 0.3, 0.2, 0.15, 0.1);
  let ghostSizes = array<f32, 5>(0.08, 0.06, 0.04, 0.05, 0.1);
  
  for (var i: i32 = 0; i < 5; i++) {
    let ghostPos = ghosts[i];
    let toGhost = uv - ghostPos;
    let dist = length(toGhost);
    
    let ghost = smoothstep(ghostSizes[i], 0.0, dist);
    let tint = vec3f(
      1.0 - f32(i) * 0.15,
      0.8 + f32(i) * 0.05,
      0.6 + f32(i) * 0.1
    );
    
    result += tint * ghost * ghostIntensities[i];
  }
  
  return result * intensity;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STARBURST DIFFRACTION
// ═══════════════════════════════════════════════════════════════════════════════

fn applyStarburst(
  uv: vec2f,
  lightPos: vec2f,
  numPoints: u32,
  intensity: f32
) -> f32 {
  let toLight = uv - lightPos;
  let dist = length(toLight);
  let angle = atan2(toLight.y, toLight.x);
  
  // Radial pattern
  let radialFrequency = f32(numPoints);
  let radialPattern = pow(abs(cos(angle * radialFrequency)), 8.0);
  
  // Attenuate with distance from light
  let falloff = 1.0 / (1.0 + dist * 3.0);
  
  // Length of spikes
  let spikeLength = 0.3;
  let spikeAttenuation = smoothstep(spikeLength, 0.0, dist);
  
  return radialPattern * falloff * spikeAttenuation * intensity;
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIGNETTING
// ═══════════════════════════════════════════════════════════════════════════════

fn applyVignette(uv: vec2f, intensity: f32, smoothness: f32, roundness: f32) -> f32 {
  // Convert to -1 to 1 range
  let pos = uv * 2.0 - 1.0;
  
  // Calculate vignette factor
  let d = length(pos);
  let vignette = 1.0 - smoothness * pow(d, roundness) * intensity;
  
  return clamp(vignette, 0.0, 1.0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// BLOOM DETECTION (for automatic flare)
// ═══════════════════════════════════════════════════════════════════════════════

fn findBrightSpots(uv: vec2f) -> vec3f {
  // Sample neighborhood for bright spots
  var brightest = vec3f(0.0);
  var brightPos = uv;
  
  let texel = 1.0 / lensParams.screen_size;
  
  // Sparse sampling
  for (var y: i32 = -2; y <= 2; y++) {
    for (var x: i32 = -2; x <= 2; x++) {
      let offset = vec2f(f32(x), f32(y)) * texel * 50.0;
      let sampleUV = uv + offset;
      let col = textureSample(sourceTexture, linearSampler, sampleUV).rgb;
      let lum = dot(col, vec3f(0.2126, 0.7152, 0.0722));
      
      if (lum > 2.0 && lum > dot(brightest, vec3f(0.2126, 0.7152, 0.0722))) {
        brightest = col;
        brightPos = sampleUV;
      }
    }
  }
  
  return brightest;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FRAGMENT SHADER
// ═══════════════════════════════════════════════════════════════════════════════

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4f {
  var uv = in.uv;
  uv.y = 1.0 - uv.y;
  
  var color: vec3f;
  
  // ═════════════════════════════════════════════════════════════════════════════
  // Chromatic Aberration
  // ═════════════════════════════════════════════════════════════════════════════
  if (lensParams.ca_enabled != 0u) {
    color = applyChromaticAberration(uv, lensParams.ca_strength);
  } else {
    color = textureSample(sourceTexture, linearSampler, uv).rgb;
  }
  
  // ═════════════════════════════════════════════════════════════════════════════
  // Lens Flare (from sun/bright sources)
  // ═════════════════════════════════════════════════════════════════════════════
  if (lensParams.flare_enabled != 0u) {
    let sunPos = lensParams.sun_screen_pos;
    let sunInView = all(sunPos > vec2f(0.0)) && all(sunPos < vec2f(1.0));
    
    if (sunInView) {
      // Anamorphic streak
      let streak = anamorphicStreak(
        uv, 
        sunPos, 
        lensParams.flare_intensity * lensParams.sun_intensity,
        lensParams.flare_anamorphic != 0u
      );
      
      // Ghost flares
      let ghosts = ghostFlares(uv, sunPos, lensParams.flare_intensity * 0.5);
      
      color += streak + ghosts;
    }
    
    // Automatic flares from bright screen spots
    let brightSpots = findBrightSpots(uv);
    let brightLum = dot(brightSpots, vec3f(0.2126, 0.7152, 0.0722));
    if (brightLum > 3.0) {
      // Add subtle flare from very bright objects
      color += brightSpots * 0.1 * lensParams.flare_intensity;
    }
  }
  
  // ═════════════════════════════════════════════════════════════════════════════
  // Starburst Diffraction
  // ═════════════════════════════════════════════════════════════════════════════
  if (lensParams.starburst_enabled != 0u) {
    let sunPos = lensParams.sun_screen_pos;
    let star = applyStarburst(
      uv, 
      sunPos, 
      lensParams.starburst_points, 
      lensParams.starburst_intensity * lensParams.sun_intensity
    );
    color += vec3f(star);
  }
  
  // ═════════════════════════════════════════════════════════════════════════════
  // Vignetting
  // ═════════════════════════════════════════════════════════════════════════════
  if (lensParams.vignette_enabled != 0u) {
    let vignette = applyVignette(
      uv, 
      lensParams.vignette_intensity,
      lensParams.vignette_smoothness,
      lensParams.vignette_roundness
    );
    color *= vignette;
  }
  
  return vec4f(color, 1.0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIMPLIFIED VARIANT (for performance mode)
// ═══════════════════════════════════════════════════════════════════════════════

@fragment
fn fs_simple(in: VSOut) -> @location(0) vec4f {
  var uv = in.uv;
  uv.y = 1.0 - uv.y;
  
  var color = textureSample(sourceTexture, linearSampler, uv).rgb;
  
  // Simple vignette only
  let vignette = applyVignette(uv, 0.3, 1.0, 2.0);
  color *= vignette;
  
  return vec4f(color, 1.0);
}
