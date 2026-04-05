/**
 * "Smile from the Moon" Animation Shader
 * 
 * Creates a giant smiley face from satellites facing Earth.
 * ~2000km across, visible from 720km horizon view.
 * 
 * Colors:
 * - Left Eye:  Warm amber #FFB347
 * - Right Eye: Warm amber #FFB347  
 * - Smile:     Golden yellow #FFD700
 * 
 * Animation Phases (8 seconds each, adjustable):
 * 1. EMERGE:   Satellites fade from constellation colors to smile colors
 * 2. GLOW:     Warm pulse (0.8→1.2 brightness), eyes blink alternately
 * 3. TWINKLE:  Random sparkle on smile curve, traveling wave left→right
 * 4. FADE:     Dissolve back to original pattern over 2 seconds
 */

// Animation phase timings (in seconds)
const PHASE_EMERGE_DURATION: f32 = 3.0;
const PHASE_GLOW_DURATION: f32 = 8.0;
const PHASE_TWINKLE_DURATION: f32 = 8.0;
const PHASE_FADE_DURATION: f32 = 2.0;

// Smile geometry constants
const SMILE_CENTER: vec3f = vec3f(0.0, 0.0, 0.0); // Earth center
const SMILE_RADIUS: f32 = 1000.0; // km - radius of the smile face
const EYE_OFFSET_X: f32 = 300.0;  // km - horizontal eye offset from center
const EYE_OFFSET_Y: f32 = 300.0;  // km - vertical eye offset from center
const EYE_RADIUS: f32 = 120.0;    // km - eye size

// Feature IDs (stored in color buffer alpha channel or separate buffer)
const FEATURE_NONE: u32 = 0u;
const FEATURE_EYE_LEFT: u32 = 1u;
const FEATURE_EYE_RIGHT: u32 = 2u;
const FEATURE_SMILE_CURVE: u32 = 3u;

// ═══════════════════════════════════════════════════════════════════════════════
// COLOR DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

const COLOR_AMBER: vec3f = vec3f(1.0, 0.702, 0.278);     // #FFB347
const COLOR_GOLDEN: vec3f = vec3f(1.0, 0.843, 0.0);      // #FFD700
const COLOR_WARM_WHITE: vec3f = vec3f(1.0, 0.95, 0.85);  // Slight warm tint

// ═══════════════════════════════════════════════════════════════════════════════
// GNOMONIC PROJECTION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

// Project satellite position to tangent plane at sub-satellite point
fn gnomonicProject(
  satPos: vec3f,
  earthDir: vec3f,  // Direction from satellite to Earth center
  outTangent: ptr<function, vec3f>,
  outBitangent: ptr<function, vec3f>
) -> vec2f {
  // Build tangent space at the point on sphere facing Earth
  let up = normalize(-earthDir); // Points toward Earth
  
  // Create tangent/bitangent perpendicular to up
  var tangent: vec3f;
  if (abs(up.z) < 0.999) {
    tangent = normalize(cross(up, vec3f(0.0, 0.0, 1.0)));
  } else {
    tangent = normalize(cross(up, vec3f(0.0, 1.0, 0.0)));
  }
  let bitangent = cross(up, tangent);
  
  *outTangent = tangent;
  *outBitangent = bitangent;
  
  // Project satellite position onto tangent plane
  // Distance from Earth center to satellite
  let satDist = length(satPos);
  // Distance from Earth center to tangent plane (Earth radius)
  let earthRadius = 6371.0;
  
  // Gnomonic projection: intersect ray from Earth center through sat with tangent plane
  let t = earthRadius / satDist;
  let projectedPos = satPos * t;
  
  // Convert to 2D coordinates in tangent space
  let x = dot(projectedPos, tangent);
  let y = dot(projectedPos, bitangent);
  
  return vec2f(x, y);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SMILE FEATURE CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

fn isPointInLeftEye(uv: vec2f) -> bool {
  let eyeCenter = vec2f(-EYE_OFFSET_X, EYE_OFFSET_Y);
  let dist = length(uv - eyeCenter);
  return dist < EYE_RADIUS;
}

fn isPointInRightEye(uv: vec2f) -> bool {
  let eyeCenter = vec2f(EYE_OFFSET_X, EYE_OFFSET_Y);
  let dist = length(uv - eyeCenter);
  return dist < EYE_RADIUS;
}

fn isPointOnSmileCurve(uv: vec2f) -> bool {
  // Parabolic smile: y = a * x^2 - h
  // where a controls curvature, h controls vertical position
  let a = 0.0015; // Curvature
  let h = 350.0;  // Vertical offset (below center)
  let halfWidth = 500.0; // Horizontal extent
  
  if (abs(uv.x) > halfWidth) {
    return false;
  }
  
  let curveY = a * uv.x * uv.x - h;
  let dist = abs(uv.y - curveY);
  
  // Width of the smile line
  return dist < 80.0;
}

// Classify a satellite into a smile feature
fn classifySatelliteForSmile(
  satPos: vec3f,
  earthDir: vec3f
) -> u32 {
  // Only satellites facing Earth (dot > 0.7) participate
  let facing = dot(normalize(satPos), -normalize(earthDir));
  if (facing < 0.7) {
    return FEATURE_NONE;
  }
  
  var tangent: vec3f;
  var bitangent: vec3f;
  let uv = gnomonicProject(satPos, earthDir, &tangent, &bitangent);
  
  // Check if within smile face radius
  if (length(uv) > SMILE_RADIUS * 1.2) {
    return FEATURE_NONE;
  }
  
  // Classify by feature
  if (isPointInLeftEye(uv)) {
    return FEATURE_EYE_LEFT;
  }
  if (isPointInRightEye(uv)) {
    return FEATURE_EYE_RIGHT;
  }
  if (isPointOnSmileCurve(uv)) {
    return FEATURE_SMILE_CURVE;
  }
  
  return FEATURE_NONE;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANIMATION PHASE CALCULATIONS
// ═══════════════════════════════════════════════════════════════════════════════

struct SmileAnimationOutput {
  color: vec3f,
  brightness: f32,
  feature: u32,
};

fn calculateSmileAnimation(
  satPos: vec3f,
  earthDir: vec3f,
  baseColor: vec3f,
  baseBrightness: f32,
  phaseElapsed: f32,
  animationProgress: f32, // 0-1 across all phases
  randomOffset: f32
) -> SmileAnimationOutput {
  var out: SmileAnimationOutput;
  out.feature = classifySatelliteForSmile(satPos, earthDir);
  
  // No feature = no animation
  if (out.feature == FEATURE_NONE) {
    out.color = baseColor;
    out.brightness = baseBrightness * (1.0 - animationProgress * 0.3); // Slight dim for non-participants
    return out;
  }
  
  // Determine target color based on feature
  var targetColor: vec3f;
  switch (out.feature) {
    case FEATURE_EYE_LEFT: { targetColor = COLOR_AMBER; }
    case FEATURE_EYE_RIGHT: { targetColor = COLOR_AMBER; }
    case FEATURE_SMILE_CURVE: { targetColor = COLOR_GOLDEN; }
    default: { targetColor = baseColor; }
  }
  
  // Calculate which phase we're in
  let totalDuration = PHASE_EMERGE_DURATION + PHASE_GLOW_DURATION + 
                      PHASE_TWINKLE_DURATION + PHASE_FADE_DURATION;
  let t = animationProgress * totalDuration;
  
  var phaseColor: vec3f;
  var phaseBrightness: f32 = baseBrightness;
  
  if (t < PHASE_EMERGE_DURATION) {
    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 1: EMERGE
    // ═══════════════════════════════════════════════════════════════════════════
    let phaseT = t / PHASE_EMERGE_DURATION;
    // Smooth ease-out interpolation
    let blend = 1.0 - pow(1.0 - phaseT, 3.0);
    phaseColor = mix(baseColor, targetColor, blend);
    phaseBrightness = mix(baseBrightness, baseBrightness * 1.2, blend);
    
  } else if (t < PHASE_EMERGE_DURATION + PHASE_GLOW_DURATION) {
    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 2: GLOW
    // ═══════════════════════════════════════════════════════════════════════════
    let phaseT = (t - PHASE_EMERGE_DURATION) / PHASE_GLOW_DURATION;
    phaseColor = targetColor;
    
    // Warm pulse 0.8 -> 1.2
    let pulse = 1.0 + sin(phaseT * 6.28318) * 0.2;
    
    // Eyes blink alternately
    var blink = 1.0;
    if (out.feature == FEATURE_EYE_LEFT) {
      // Left eye blinks at 0.25, 0.75
      let blinkPhase = fract(phaseT * 2.0);
      blink = 1.0 - smoothstep(0.45, 0.5, blinkPhase) * smoothstep(0.55, 0.5, blinkPhase);
    } else if (out.feature == FEATURE_EYE_RIGHT) {
      // Right eye blinks at 0.0, 0.5, 1.0 (opposite)
      let blinkPhase = fract(phaseT * 2.0 + 0.5);
      blink = 1.0 - smoothstep(0.45, 0.5, blinkPhase) * smoothstep(0.55, 0.5, blinkPhase);
    }
    
    phaseBrightness = baseBrightness * pulse * blink;
    
  } else if (t < PHASE_EMERGE_DURATION + PHASE_GLOW_DURATION + PHASE_TWINKLE_DURATION) {
    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 3: TWINKLE
    // ═══════════════════════════════════════════════════════════════════════════
    let phaseT = (t - PHASE_EMERGE_DURATION - PHASE_GLOW_DURATION) / PHASE_TWINKLE_DURATION;
    phaseColor = targetColor;
    
    if (out.feature == FEATURE_SMILE_CURVE) {
      // Traveling wave left->right on smile curve
      // Get position along smile for wave
      var tangent: vec3f;
      var bitangent: vec3f;
      let uv = gnomonicProject(satPos, earthDir, &tangent, &bitangent);
      
      // Normalize x position to 0-1
      let normalizedX = (uv.x + 500.0) / 1000.0;
      
      // Traveling sparkle wave
      let wavePos = fract(phaseT * 3.0); // 3 waves per phase
      let distToWave = abs(normalizedX - wavePos);
      let sparkle = 1.0 + smoothstep(0.2, 0.0, distToWave) * 0.5;
      
      // Random individual twinkles
      let individualTwinkle = 1.0 + sin(randomOffset * 100.0 + phaseT * 20.0) * 0.15;
      
      phaseBrightness = baseBrightness * sparkle * individualTwinkle;
    } else {
      // Eyes maintain steady glow
      phaseBrightness = baseBrightness * (1.0 + sin(phaseT * 4.0) * 0.1);
    }
    
  } else {
    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 4: FADE
    // ═══════════════════════════════════════════════════════════════════════════
    let phaseT = (t - PHASE_EMERGE_DURATION - PHASE_GLOW_DURATION - PHASE_TWINKLE_DURATION) / PHASE_FADE_DURATION;
    // Smooth ease-in interpolation
    let blend = phaseT * phaseT * (3.0 - 2.0 * phaseT);
    phaseColor = mix(targetColor, baseColor, blend);
    phaseBrightness = mix(baseBrightness * 1.2, baseBrightness, blend);
  }
  
  out.color = phaseColor;
  out.brightness = phaseBrightness;
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPUTE SHADER ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════

struct SmileAnimationParams {
  // Animation state
  phase: u32,           // 0=emerge, 1=glow, 2=twinkle, 3=fade
  progress: f32,        // 0-1 within phase
  totalProgress: f32,   // 0-1 across all phases
  speed: f32,           // speed multiplier
  
  // Feature assignments (computed once at animation start)
  // Stored in separate buffer, accessed by satellite index
};

@group(0) @binding(0) var<uniform> params: SmileAnimationParams;
@group(0) @binding(1) var<storage, read> satPositions: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> satColors: array<vec4f>;
@group(0) @binding(3) var<storage, read> featureAssignments: array<u32>; // per-sat feature IDs

@compute @workgroup_size(256)
fn smileAnimationCompute(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= 1048576u) { return; }
  
  let satPos = satPositions[i].xyz;
  let earthDir = normalize(-satPos); // Direction to Earth center
  
  // Get current color
  let currentColor = satColors[i];
  let baseColor = currentColor.rgb;
  let baseBrightness = currentColor.a;
  
  // Generate deterministic random offset from satellite index
  let randomOffset = fract(sin(f32(i) * 12.9898) * 43758.5453);
  
  // Calculate animation
  let anim = calculateSmileAnimation(
    satPos,
    earthDir,
    baseColor,
    baseBrightness,
    params.progress * params.speed,
    params.totalProgress,
    randomOffset
  );
  
  // Write output color
  satColors[i] = vec4f(anim.color, anim.brightness);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRE-COMPUTATION: Feature Assignment
// ═══════════════════════════════════════════════════════════════════════════════

// This would be run once when animation starts to classify all satellites
@compute @workgroup_size(256)
fn assignSmileFeatures(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= 1048576u) { return; }
  
  let satPos = satPositions[i].xyz;
  let earthDir = normalize(-satPos);
  
  let feature = classifySatelliteForSmile(satPos, earthDir);
  
  // Store feature assignment (would write to separate buffer)
  // featureAssignments[i] = feature;
}
