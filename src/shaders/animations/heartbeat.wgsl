/**
 * Heartbeat Animation Shader
 * 
 * Lub-dub pulse with red→pink color shift.
 * Satellites form a giant pulsing heart shape facing Earth.
 */

// Heart shape parameters
const HEART_CENTER: vec3f = vec3f(0.0, 0.0, 0.0);
const HEART_SCALE: f32 = 1200.0;  // Size of the heart in km
const HEART_THICKNESS: f32 = 150.0; // Thickness of heart outline

// Animation timing (seconds per cycle)
const CYCLE_DURATION: f32 = 1.2;    // Full lub-dub cycle
const LUB_DURATION: f32 = 0.15;     // First beat
const DUB_DURATION: f32 = 0.12;     // Second beat
const REST_DURATION: f32 = CYCLE_DURATION - LUB_DURATION - DUB_DURATION;

// Colors
const COLOR_HEART_RED: vec3f = vec3f(0.9, 0.1, 0.15);     // Deep red
const COLOR_HEART_PINK: vec3f = vec3f(1.0, 0.4, 0.6);     // Pink
const COLOR_HEART_BRIGHT: vec3f = vec3f(1.0, 0.7, 0.75);  // Light pink

struct HeartbeatParams {
  time: f32,
  speed: f32,
  intensity: f32,      // Overall effect intensity
  phase: u32,          // 0=emerge, 1=pulse, 2=fade
  progress: f32,       // 0-1 within phase
};

// ═══════════════════════════════════════════════════════════════════════════════
// HEART SHAPE SDF (Signed Distance Function)
// ═══════════════════════════════════════════════════════════════════════════════

// 2D heart shape SDF
fn heartSDF(p: vec2f) -> f32 {
  // Classic heart shape formula
  // Adjust coordinates: heart center at (0,0), pointing up
  let x = p.x;
  let y = -p.y; // Flip Y so heart points up
  
  // Heart formula
  let a = x * x + y * y - 0.5;
  let b = x * x * y * y * y;
  let d = a * a * a - b;
  
  return d;
}

// Check if point is inside heart shape (outline version)
fn isInHeartOutline(p: vec2f, scale: f32, thickness: f32) -> f32 {
  // Normalize to heart scale
  let np = p / scale;
  
  // Calculate distance from heart surface
  let d = heartSDF(np);
  
  // Convert to approximate signed distance (this is a simplification)
  let absD = abs(d);
  
  // Normalize thickness
  let normThickness = thickness / scale;
  
  // Return 1.0 if on the outline, fading to 0.0 at edges
  let edgeDist = abs(absD - 0.125) / 0.125; // Normalize around typical surface
  return 1.0 - smoothstep(0.0, normThickness * 2.0, edgeDist);
}

// Check if point is inside filled heart
fn isInHeart(p: vec2f, scale: f32) -> bool {
  let np = p / scale;
  return heartSDF(np) < 0.0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GNOMONIC PROJECTION (same as smile animation)
// ═══════════════════════════════════════════════════════════════════════════════

fn gnomonicProjectHeart(
  satPos: vec3f,
  earthDir: vec3f,
  outTangent: ptr<function, vec3f>,
  outBitangent: ptr<function, vec3f>
) -> vec2f {
  let up = normalize(-earthDir);
  
  var tangent: vec3f;
  if (abs(up.z) < 0.999) {
    tangent = normalize(cross(up, vec3f(0.0, 0.0, 1.0)));
  } else {
    tangent = normalize(cross(up, vec3f(0.0, 1.0, 0.0)));
  }
  let bitangent = cross(up, tangent);
  
  *outTangent = tangent;
  *outBitangent = bitangent;
  
  let earthRadius = 6371.0;
  let satDist = length(satPos);
  let t = earthRadius / satDist;
  let projectedPos = satPos * t;
  
  let x = dot(projectedPos, tangent);
  let y = dot(projectedPos, bitangent);
  
  return vec2f(x, y);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PULSE CALCULATION
// ═══════════════════════════════════════════════════════════════════════════════

fn calculatePulse(cycleTime: f32) -> vec2f {
  // Returns (pulse scale, pulse brightness)
  // Pulse scale: 1.0 = normal, >1.0 = expanded
  // Pulse brightness: 0.0-1.0
  
  let t = fract(cycleTime / CYCLE_DURATION) * CYCLE_DURATION;
  
  var scale = 1.0;
  var brightness = 0.3; // Base brightness
  
  // Lub beat (first, stronger)
  if (t < LUB_DURATION) {
    let beatT = t / LUB_DURATION;
    // Attack-decay envelope
    let envelope = sin(beatT * 3.14159);
    scale = 1.0 + envelope * 0.15;
    brightness = 0.3 + envelope * 0.7;
  }
  // Dub beat (second, weaker)
  else if (t < LUB_DURATION + DUB_DURATION) {
    let beatT = (t - LUB_DURATION) / DUB_DURATION;
    let envelope = sin(beatT * 3.14159);
    scale = 1.0 + envelope * 0.08;
    brightness = 0.3 + envelope * 0.5;
  }
  // Rest phase - gentle pulsing
  else {
    let restT = (t - LUB_DURATION - DUB_DURATION) / REST_DURATION;
    brightness = 0.3 + sin(restT * 6.28318) * 0.1;
  }
  
  return vec2f(scale, brightness);
}

// ═══════════════════════════════════════════════════════════════════════════════
// COLOR CALCULATION
// ═══════════════════════════════════════════════════════════════════════════════

struct HeartbeatOutput {
  color: vec3f,
  brightness: f32,
  inHeart: bool,
}

fn calculateHeartbeat(
  satPos: vec3f,
  earthDir: vec3f,
  baseColor: vec3f,
  baseBrightness: f32,
  params: HeartbeatParams
) -> HeartbeatOutput {
  var out: HeartbeatOutput;
  
  // Only satellites facing Earth participate
  let facing = dot(normalize(satPos), -normalize(earthDir));
  if (facing < 0.6) {
    out.color = baseColor;
    out.brightness = baseBrightness * 0.3;
    out.inHeart = false;
    return out;
  }
  
  var tangent: vec3f;
  var bitangent: vec3f;
  let uv = gnomonicProjectHeart(satPos, earthDir, &tangent, &bitangent);
  
  // Calculate pulse
  let pulse = calculatePulse(params.time * params.speed);
  let currentScale = HEART_SCALE * pulse.x;
  
  // Check if in heart outline
  let outlineIntensity = isInHeartOutline(uv, currentScale, HEART_THICKNESS);
  
  if (outlineIntensity < 0.01) {
    out.color = baseColor;
    out.brightness = baseBrightness * 0.2;
    out.inHeart = false;
    return out;
  }
  
  out.inHeart = true;
  
  // Color based on pulse - red to pink shift
  let colorT = pulse.y; // 0.3 to 1.0
  let heartColor = mix(COLOR_HEART_RED, COLOR_HEART_PINK, colorT);
  let brightColor = mix(heartColor, COLOR_HEART_BRIGHT, (colorT - 0.5) * 2.0);
  
  out.color = mix(baseColor, brightColor, params.intensity);
  out.brightness = baseBrightness * (0.5 + pulse.y) * outlineIntensity;
  
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHADER ENTRY POINTS
// ═══════════════════════════════════════════════════════════════════════════════

@group(0) @binding(0) var<uniform> heartbeatParams: HeartbeatParams;
@group(0) @binding(1) var<storage, read> satPositions: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> satColors: array<vec4f>;

@compute @workgroup_size(256)
fn heartbeatCompute(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= 1048576u) { return; }
  
  let satPos = satPositions[i].xyz;
  let earthDir = normalize(-satPos);
  
  let currentColor = satColors[i];
  
  let beat = calculateHeartbeat(
    satPos,
    earthDir,
    currentColor.rgb,
    currentColor.a,
    heartbeatParams
  );
  
  satColors[i] = vec4f(beat.color, beat.brightness);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE-BASED ANIMATION
// ═══════════════════════════════════════════════════════════════════════════════

fn calculateHeartbeatPhased(
  satPos: vec3f,
  earthDir: vec3f,
  baseColor: vec3f,
  baseBrightness: f32,
  phase: u32,
  phaseProgress: f32,
  totalProgress: f32,
  time: f32,
  speed: f32
) -> HeartbeatOutput {
  var out: HeartbeatOutput;
  
  // Calculate feature assignment (same as before)
  let facing = dot(normalize(satPos), -normalize(earthDir));
  if (facing < 0.6) {
    out.color = baseColor;
    out.brightness = baseBrightness;
    out.inHeart = false;
    return out;
  }
  
  var tangent: vec3f;
  var bitangent: vec3f;
  let uv = gnomonicProjectHeart(satPos, earthDir, &tangent, &bitangent);
  let isInShape = isInHeartOutline(uv, HEART_SCALE, HEART_THICKNESS) > 0.1;
  
  if (!isInShape) {
    out.color = baseColor;
    out.brightness = baseBrightness * (1.0 - totalProgress * 0.2);
    out.inHeart = false;
    return out;
  }
  
  // Phase-specific behavior
  switch (phase) {
    case 0u: { // EMERGE
      let t = phaseProgress;
      let blend = 1.0 - pow(1.0 - t, 3.0);
      let pulse = calculatePulse(time * speed);
      let heartColor = mix(COLOR_HEART_RED, COLOR_HEART_PINK, pulse.y);
      out.color = mix(baseColor, heartColor, blend);
      out.brightness = mix(baseBrightness, baseBrightness * pulse.y * 2.0, blend);
    }
    case 1u: { // PULSE (main phase)
      let pulse = calculatePulse(time * speed);
      let heartColor = mix(COLOR_HEART_RED, COLOR_HEART_PINK, pulse.y);
      out.color = heartColor;
      out.brightness = baseBrightness * pulse.y * 2.0;
    }
    case 2u: { // FADE
      let t = phaseProgress;
      let blend = t * t;
      let pulse = calculatePulse(time * speed);
      let heartColor = mix(COLOR_HEART_RED, COLOR_HEART_PINK, pulse.y);
      out.color = mix(heartColor, baseColor, blend);
      out.brightness = mix(baseBrightness * pulse.y * 2.0, baseBrightness, blend);
    }
    default: {
      out.color = baseColor;
      out.brightness = baseBrightness;
    }
  }
  
  out.inHeart = true;
  return out;
}
