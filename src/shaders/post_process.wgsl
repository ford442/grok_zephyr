/**
 * Post-Processing Shaders
 * 
 * Multi-pass HDR post-processing pipeline:
 *   1. Bloom threshold extraction
 *   2. Separable Gaussian blur (horizontal)
 *   3. Separable Gaussian blur (vertical)
 *   4. Composite with ACES tone mapping
 * 
 * Uses rgba16float HDR format throughout for high dynamic range.
 */

//==============================================================================
// Bloom Threshold Extraction
//==============================================================================

// Extracts bright pixels for bloom effect

@group(0) @binding(0) var scene_tex : texture_2d<f32>;
@group(0) @binding(1) var scene_sampler : sampler;

struct BloomThresholdVertexOutput {
  @builtin(position) clip_position : vec4f,
  @location(0)       uv            : vec2f,
};

// Vertex shader: fullscreen triangle
@vertex
fn vs_bloom_threshold(@builtin(vertex_index) vi: u32) -> BloomThresholdVertexOutput {
  var out: BloomThresholdVertexOutput;
  
  // Fullscreen triangle vertices
  const pts = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0)
  );
  
  let pos = pts[vi];
  out.clip_position = vec4f(pos, 0.0, 1.0);
  out.uv = pos * 0.5 + 0.5;
  
  return out;
}

// Fragment shader: extract bright pixels
@fragment
fn fs_bloom_threshold(in: BloomThresholdVertexOutput) -> @location(0) vec4f {
  // Flip Y for texture coordinates
  var uv = in.uv;
  uv.y = 1.0 - uv.y;
  
  // Sample scene
  let color = textureSample(scene_tex, scene_sampler, uv).rgb;
  
  // Calculate luminance
  let lum = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  
  // Smooth threshold
  let threshold = smoothstep(0.75, 1.4, lum);
  
  // Output thresholded color
  return vec4f(color * threshold, 1.0);
}

// Alias for compatibility
@vertex
fn vs(in: BloomThresholdVertexOutput) -> BloomThresholdVertexOutput {
  return in;
}

@fragment
fn fs(in: BloomThresholdVertexOutput) -> @location(0) vec4f {
  return fs_bloom_threshold(in);
}

//==============================================================================
// Separable Gaussian Blur
//==============================================================================

// Performs horizontal or vertical blur based on uniform flag

struct BlurUniforms {
  texel      : vec2f,
  horizontal : u32,
  pad        : u32,
};

@group(0) @binding(0) var<uniform> blur_uni : BlurUniforms;
@group(0) @binding(1) var blur_src_tex      : texture_2d<f32>;
@group(0) @binding(2) var blur_sampler      : sampler;

struct BlurVertexOutput {
  @builtin(position) clip_position : vec4f,
  @location(0)       uv            : vec2f,
};

// Gaussian weights for 9-tap kernel (5 unique taps)
// Pre-calculated for sigma ≈ 2.0
const BLUR_WEIGHTS = array<f32, 5>(
  0.2270270270,  // Center
  0.1945945946,  // ±1
  0.1216216216,  // ±2
  0.0540540541,  // ±3
  0.0162162162   // ±4
);

// Vertex shader
@vertex
fn vs_blur(@builtin(vertex_index) vi: u32) -> BlurVertexOutput {
  var out: BlurVertexOutput;
  
  const pts = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0)
  );
  
  let pos = pts[vi];
  out.clip_position = vec4f(pos, 0.0, 1.0);
  out.uv = pos * 0.5 + 0.5;
  
  return out;
}

// Fragment shader
@fragment
fn fs_blur(in: BlurVertexOutput) -> @location(0) vec4f {
  // Flip Y
  var uv = in.uv;
  uv.y = 1.0 - uv.y;
  
  // Determine blur direction
  let is_horizontal = blur_uni.horizontal != 0u;
  let texel_offset = select(
    vec2f(0.0, blur_uni.texel.y),  // Vertical
    vec2f(blur_uni.texel.x, 0.0),  // Horizontal
    is_horizontal
  );
  
  // Center sample
  var color = textureSample(blur_src_tex, blur_sampler, uv).rgb * BLUR_WEIGHTS[0];
  
  // Accumulate samples
  for (var i: i32 = 1; i < 5; i++) {
    let offset = f32(i) * texel_offset;
    color += textureSample(blur_src_tex, blur_sampler, uv + offset).rgb * BLUR_WEIGHTS[i];
    color += textureSample(blur_src_tex, blur_sampler, uv - offset).rgb * BLUR_WEIGHTS[i];
  }
  
  return vec4f(color, 1.0);
}

//==============================================================================
// HDR Composite with Tone Mapping
//==============================================================================

// Final composition: scene + bloom with ACES tone mapping

@group(0) @binding(0) var comp_scene_tex : texture_2d<f32>;
@group(0) @binding(1) var comp_bloom_tex : texture_2d<f32>;
@group(0) @binding(2) var comp_sampler   : sampler;

struct CompositeVertexOutput {
  @builtin(position) clip_position : vec4f,
  @location(0)       uv            : vec2f,
};

// ACES tone mapping approximation
fn aces(x: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

// Alternative tone mapping: Reinhard
fn reinhard(hdr: vec3f) -> vec3f {
  return hdr / (hdr + vec3f(1.0));
}

// Alternative tone mapping: Uncharted 2
fn uncharted2_tonemap(x: vec3f) -> vec3f {
  let A = 0.15;
  let B = 0.50;
  let C = 0.10;
  let D = 0.20;
  let E = 0.02;
  let F = 0.30;
  return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;
}

// Vertex shader
@vertex
fn vs_composite(@builtin(vertex_index) vi: u32) -> CompositeVertexOutput {
  var out: CompositeVertexOutput;
  
  const pts = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0)
  );
  
  let pos = pts[vi];
  out.clip_position = vec4f(pos, 0.0, 1.0);
  out.uv = pos * 0.5 + 0.5;
  
  return out;
}

// Fragment shader
@fragment
fn fs_composite(in: CompositeVertexOutput) -> @location(0) vec4f {
  // Flip Y
  var uv = in.uv;
  uv.y = 1.0 - uv.y;
  
  // Sample scene and bloom
  let scene = textureSample(comp_scene_tex, comp_sampler, uv).rgb;
  let bloom = textureSample(comp_bloom_tex, comp_sampler, uv).rgb;
  
  // Combine with bloom intensity
  const BLOOM_INTENSITY : f32 = 1.8;
  let hdr = scene + bloom * BLOOM_INTENSITY;
  
  // Apply ACES tone mapping
  let ldr = aces(hdr);
  
  return vec4f(ldr, 1.0);
}

//==============================================================================
// Alternative Composite Variants
//==============================================================================

// Composite with Reinhard tone mapping
@fragment
fn fs_composite_reinhard(in: CompositeVertexOutput) -> @location(0) vec4f {
  var uv = in.uv;
  uv.y = 1.0 - uv.y;
  
  let scene = textureSample(comp_scene_tex, comp_sampler, uv).rgb;
  let bloom = textureSample(comp_bloom_tex, comp_sampler, uv).rgb;
  
  let hdr = scene + bloom * 1.8;
  let ldr = reinhard(hdr);
  
  return vec4f(ldr, 1.0);
}

// Composite with filmic tone mapping
@fragment
fn fs_composite_filmic(in: CompositeVertexOutput) -> @location(0) vec4f {
  var uv = in.uv;
  uv.y = 1.0 - uv.y;
  
  let scene = textureSample(comp_scene_tex, comp_sampler, uv).rgb;
  let bloom = textureSample(comp_bloom_tex, comp_sampler, uv).rgb;
  
  let hdr = scene + bloom * 1.8;
  
  // Filmic curve approximation
  let x = max(vec3f(0.0), hdr - 0.004);
  let ldr = (x * (6.2 * x + 0.5)) / (x * (6.2 * x + 1.7) + 0.06);
  
  return vec4f(ldr, 1.0);
}

// Composite with exposure adjustment
@fragment
fn fs_composite_exposure(in: CompositeVertexOutput, @builtin(position) pos: vec4f) -> @location(0) vec4f {
  var uv = in.uv;
  uv.y = 1.0 - uv.y;
  
  let scene = textureSample(comp_scene_tex, comp_sampler, uv).rgb;
  let bloom = textureSample(comp_bloom_tex, comp_sampler, uv).rgb;
  
  // Adaptive exposure (simplified)
  const EXPOSURE : f32 = 1.0;
  let hdr = (scene + bloom * 1.8) * EXPOSURE;
  
  let ldr = aces(hdr);
  
  return vec4f(ldr, 1.0);
}

//==============================================================================
// Starfield Background Shader
//==============================================================================

// Simple procedural starfield for background

@group(0) @binding(0) var<uniform> star_uni : Uni;  // Reuse common uniform struct

struct StarVertexOutput {
  @builtin(position) clip_position : vec4f,
  @location(0)       uv            : vec2f,
};

@vertex
fn vs_stars(@builtin(vertex_index) vi: u32) -> StarVertexOutput {
  var out: StarVertexOutput;
  
  const pts = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0)
  );
  
  let pos = pts[vi];
  out.clip_position = vec4f(pos, 0.0, 1.0);
  out.uv = pos * 0.5 + 0.5;
  
  return out;
}

// 2D hash for star generation
fn star_hash2(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

@fragment
fn fs_stars(in: StarVertexOutput) -> @location(0) vec4f {
  // Tiled star field
  let cell = floor(in.uv * 512.0);
  let h = star_hash2(cell);
  let h2 = star_hash2(cell + vec2f(1.0, 0.0));
  let h3 = star_hash2(cell + vec2f(0.0, 1.0));
  
  // Star probability and brightness
  let star = f32(h > 0.994) * pow(h2, 6.0);
  
  // Star color variation (blue to yellow)
  let color = mix(
    vec3f(0.6, 0.8, 1.0),  // Blue-white
    vec3f(1.0, 0.9, 0.7),  // Yellow-white
    h3
  );
  
  return vec4f(color * star * 1.5, 1.0);
}
