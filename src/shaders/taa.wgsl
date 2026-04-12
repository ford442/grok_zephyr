/**
 * Temporal Anti-Aliasing (TAA) Shader
 * 
 * Implements sub-pixel jittering and temporal accumulation for
 * smooth satellite rendering without flickering.
 */

// Uniforms for TAA pass
struct TAAUniforms {
  // Halton sequence jitter (x, y) in pixel units
  jitter: vec2f,
  // Blend weight for history (0.8-0.95 typical)
  historyWeight: f32,
  // Enable neighborhood clamping
  neighborhoodClamp: u32,
  // Screen dimensions
  screenSize: vec2f,
};

@group(0) @binding(0) var<uniform> taaUni: TAAUniforms;
@group(0) @binding(1) var currentFrame: texture_2d<f32>;
@group(0) @binding(2) var historyFrame: texture_2d<f32>;
@group(0) @binding(3) var velocityBuffer: texture_2d<f32>; // optional motion vectors
@group(0) @binding(4) var linearSampler: sampler;
@group(0) @binding(5) var nearestSampler: sampler;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  const pts = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  var o: VSOut;
  o.pos = vec4f(pts[vi], 0, 1);
  o.uv = pts[vi] * 0.5 + 0.5;
  return o;
}

// Color space conversions for better blending
fn rgbToYCoCg(rgb: vec3f) -> vec3f {
  let y = dot(rgb, vec3f(0.25, 0.5, 0.25));
  let co = dot(rgb, vec3f(0.5, 0.0, -0.5));
  let cg = dot(rgb, vec3f(-0.25, 0.5, -0.25));
  return vec3f(y, co, cg);
}

fn yCoCgToRGB(ycocg: vec3f) -> vec3f {
  let y = ycocg.x;
  let co = ycocg.y;
  let cg = ycocg.z;
  let r = y + co - cg;
  let g = y + cg;
  let b = y - co - cg;
  return vec3f(r, g, b);
}

// Neighborhood sampling for clamping
fn sampleNeighborhood(uv: vec2f) -> vec3f {
  let texel = 1.0 / taaUni.screenSize;
  
  var color = textureSample(currentFrame, linearSampler, uv).rgb;
  
  // 3x3 neighborhood
  var minColor = color;
  var maxColor = color;
  
  for (var y: i32 = -1; y <= 1; y++) {
    for (var x: i32 = -1; x <= 1; x++) {
      if (x == 0 && y == 0) { continue; }
      let offset = vec2f(f32(x), f32(y)) * texel;
      let neighbor = textureSample(currentFrame, linearSampler, uv + offset).rgb;
      minColor = min(minColor, neighbor);
      maxColor = max(maxColor, neighbor);
    }
  }
  
  // Expand neighborhood slightly for stability
  let expansion = (maxColor - minColor) * 0.5;
  minColor = minColor - expansion;
  maxColor = maxColor + expansion;
  
  return clamp(color, minColor, maxColor);
}

// Velocity-based reprojection
fn reprojectUV(uv: vec2f) -> vec2f {
  let velocity = textureSample(velocityBuffer, linearSampler, uv).rg;
  return uv - velocity;
}

// Sharpen filter to counteract TAA blur
fn sharpen(uv: vec2f, center: vec3f) -> vec3f {
  let texel = 1.0 / taaUni.screenSize;
  
  // Laplacian sharpening
  var sum = vec3f(0.0);
  sum += textureSample(currentFrame, linearSampler, uv + vec2f(texel.x, 0.0)).rgb;
  sum += textureSample(currentFrame, linearSampler, uv - vec2f(texel.x, 0.0)).rgb;
  sum += textureSample(currentFrame, linearSampler, uv + vec2f(0.0, texel.y)).rgb;
  sum += textureSample(currentFrame, linearSampler, uv - vec2f(0.0, texel.y)).rgb;
  
  let sharpened = center * 5.0 - sum;
  return mix(center, sharpened, 0.15); // subtle sharpening
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let uv = in.uv;
  
  // Sample current frame with anti-flicker filtering
  let currentColor = textureSample(currentFrame, linearSampler, uv).rgb;
  
  // Reproject to get history UV
  var historyUV = uv;
  if (taaUni.neighborhoodClamp != 0u) {
    historyUV = reprojectUV(uv);
  }
  
  // Sample history (clamp to valid UV range with border handling)
  historyUV = clamp(historyUV, vec2f(0.001), vec2f(0.999));
  let historyColor = textureSample(historyFrame, linearSampler, historyUV).rgb;
  
  // Neighborhood clamping to reduce ghosting
  var clampedHistory = historyColor;
  if (taaUni.neighborhoodClamp != 0u) {
    let neighborhood = sampleNeighborhood(uv);
    // Soft clamp using YCoCg space for better color handling
    let historyYCoCg = rgbToYCoCg(clampedHistory);
    let minYCoCg = rgbToYCoCg(neighborhood * 0.95);
    let maxYCoCg = rgbToYCoCg(neighborhood * 1.05);
    let clampedYCoCg = clamp(historyYCoCg, minYCoCg, maxYCoCg);
    clampedHistory = yCoCgToRGB(clampedYCoCg);
  }
  
  // Blend current and history
  let weight = taaUni.historyWeight;
  var blended = currentColor * (1.0 - weight) + clampedHistory * weight;
  
  // Apply sharpening to counteract blur
  blended = sharpen(uv, blended);
  
  // Prevent NaN/Inf
  blended = clamp(blended, vec3f(0.0), vec3f(65504.0)); // max half-float
  
  return vec4f(blended, 1.0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Halton Sequence Generator (CPU-side helper functions)
// ═══════════════════════════════════════════════════════════════════════════════
// These would be called from TypeScript to generate jitter values:
//
// function halton(index: number, base: number): number {
//   let result = 0;
//   let f = 1 / base;
//   let i = index;
//   while (i > 0) {
//     result += f * (i % base);
//     i = Math.floor(i / base);
//     f /= base;
//   }
//   return result;
// }
//
// function getJitter(frameIndex: number): [number, number] {
//   const jitterX = (halton(frameIndex % 16, 2) - 0.5) * 2.0; // [-1, 1]
//   const jitterY = (halton(frameIndex % 16, 3) - 0.5) * 2.0;
//   return [jitterX, jitterY];
// }
