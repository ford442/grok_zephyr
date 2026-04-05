/**
 * Fireworks Animation Shader
 * 
 * Burst patterns from random centers across the constellation.
 * Multiple fireworks launch and explode in sequence.
 */

// Firework parameters
const NUM_FIREWORKS: u32 = 12u;          // Maximum simultaneous fireworks
const PARTICLES_PER_BURST: u32 = 256u;   // Satellites per firework
const BURST_RADIUS: f32 = 300.0;         // Explosion radius in km
const PARTICLE_SPREAD: f32 = 50.0;       // Spread of particle assignment

// Animation timing
const LAUNCH_DURATION: f32 = 1.0;        // Time to rise
const EXPLODE_DURATION: f32 = 2.0;       // Explosion duration
const FADE_DURATION: f32 = 1.5;          // Fade out time
const TOTAL_FIREWORK_DURATION: f32 = LAUNCH_DURATION + EXPLODE_DURATION + FADE_DURATION;

// Color palettes for different firework types
const PALETTE_GOLD: array<vec3f, 3> = array(
  vec3f(1.0, 0.84, 0.0),    // Gold
  vec3f(1.0, 0.65, 0.0),    // Orange
  vec3f(1.0, 0.95, 0.5)     // Light yellow
);

const PALETTE_RED: array<vec3f, 3> = array(
  vec3f(1.0, 0.0, 0.0),     // Red
  vec3f(1.0, 0.2, 0.3),     // Pink
  vec3f(0.8, 0.0, 0.2)      // Dark red
);

const PALETTE_BLUE: array<vec3f, 3> = array(
  vec3f(0.0, 0.5, 1.0),     // Blue
  vec3f(0.3, 0.7, 1.0),     // Light blue
  vec3f(0.5, 0.8, 1.0)      // Cyan
);

const PALETTE_GREEN: array<vec3f, 3> = array(
  vec3f(0.0, 1.0, 0.2),     // Green
  vec3f(0.3, 1.0, 0.4),     // Light green
  vec3f(0.0, 0.8, 0.3)      // Teal
);

const PALETTE_PURPLE: array<vec3f, 3> = array(
  vec3f(0.6, 0.2, 0.8),     // Purple
  vec3f(0.8, 0.4, 1.0),     // Light purple
  vec3f(0.9, 0.6, 1.0)      // Lavender
);

struct FireworkParams {
  time: f32,
  speed: f32,
  phase: u32,
  progress: f32,
  totalProgress: f32,
  globalSeed: u32,      // Random seed for this show
};

// Per-firework state (would be stored in uniform buffer)
struct FireworkState {
  center: vec3f,
  colorPalette: u32,    // 0-4 for different palettes
  startTime: f32,
  seed: u32,
};

// ═══════════════════════════════════════════════════════════════════════════════
// RANDOM NUMBER GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

fn hashU32(v: u32) -> u32 {
  let x = v * 747796405u + 2891336453u;
  let word = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  return (word >> 22u) ^ word;
}

fn randomFloat(seed: u32) -> f32 {
  return f32(hashU32(seed)) / 4294967295.0;
}

fn randomVec3(seed: u32) -> vec3f {
  return vec3f(
    randomFloat(seed),
    randomFloat(seed + 1u),
    randomFloat(seed + 2u)
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// FIREWORK GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

fn generateFireworkCenter(seed: u32) -> vec3f {
  // Generate random position within constellation bounds
  let angle = randomFloat(seed) * 6.28318;
  let height = (randomFloat(seed + 1u) - 0.5) * 1000.0; // ±500km vertical
  let radius = 6500.0 + randomFloat(seed + 2u) * 1000.0; // 6500-7500km radius
  
  return vec3f(
    cos(angle) * radius,
    sin(angle) * radius,
    height
  );
}

fn getPaletteColor(paletteIndex: u32, colorIndex: u32) -> vec3f {
  let idx = colorIndex % 3u;
  switch (paletteIndex % 5u) {
    case 0u: { return PALETTE_GOLD[idx]; }
    case 1u: { return PALETTE_RED[idx]; }
    case 2u: { return PALETTE_BLUE[idx]; }
    case 3u: { return PALETTE_GREEN[idx]; }
    case 4u: { return PALETTE_PURPLE[idx]; }
    default: { return PALETTE_GOLD[idx]; }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARTICLE ASSIGNMENT
// ═══════════════════════════════════════════════════════════════════════════════

// Assign a satellite to a firework based on its position
fn assignToFirework(
  satPos: vec3f,
  fireworkIndex: u32,
  seed: u32
) -> vec3f {
  // Generate deterministic target position for this satellite
  let satSeed = seed + fireworkIndex * 10000u + u32(length(satPos)) % 10000u;
  
  // Random direction from center
  let theta = randomFloat(satSeed) * 6.28318;
  let phi = randomFloat(satSeed + 1u) * 3.14159;
  
  // Random radius with more particles near center
  let r = pow(randomFloat(satSeed + 2u), 0.5) * BURST_RADIUS;
  
  return vec3f(
    r * sin(phi) * cos(theta),
    r * sin(phi) * sin(theta),
    r * cos(phi)
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// FIREWORK CALCULATION
// ═══════════════════════════════════════════════════════════════════════════════

struct FireworkOutput {
  color: vec3f,
  brightness: f32,
  inFirework: bool,
}

fn calculateFireworks(
  satPos: vec3f,
  baseColor: vec3f,
  baseBrightness: f32,
  params: FireworkParams,
  fireworkStates: ptr<function, array<FireworkState, 12>>
) -> FireworkOutput {
  var out: FireworkOutput;
  out.inFirework = false;
  
  var closestFirework: i32 = -1;
  var closestDist: f32 = 100000.0;
  var closestPhase: f32 = 0.0;
  var closestOffset: vec3f = vec3f(0.0);
  var closestPalette: u32 = 0u;
  
  // Check each firework
  for (var i: u32 = 0u; i < NUM_FIREWORKS; i++) {
    let fw = (*fireworkStates)[i];
    let elapsed = params.time * params.speed - fw.startTime;
    
    // Skip if not started yet or already finished
    if (elapsed < 0.0 || elapsed > TOTAL_FIREWORK_DURATION) {
      continue;
    }
    
    // Calculate target position for this satellite in this firework
    let offset = assignToFirework(satPos, i, fw.seed);
    let targetPos = fw.center + offset;
    
    // Calculate actual position based on phase
    var actualPos: vec3f;
    var phase: f32;
    
    if (elapsed < LAUNCH_DURATION) {
      // Launch phase - rising from below
      phase = elapsed / LAUNCH_DURATION;
      let launchStart = fw.center - vec3f(0.0, 0.0, BURST_RADIUS * 2.0);
      actualPos = mix(launchStart, fw.center, phase);
      actualPos = actualPos + offset * 0.1; // Slightly spread during launch
    } else if (elapsed < LAUNCH_DURATION + EXPLODE_DURATION) {
      // Explosion phase
      phase = 1.0 + (elapsed - LAUNCH_DURATION) / EXPLODE_DURATION;
      // Expand from center
      let expandT = (elapsed - LAUNCH_DURATION) / 0.3; // Fast expansion
      let expansion = min(expandT, 1.0);
      actualPos = fw.center + offset * expansion;
    } else {
      // Fade phase
      phase = 2.0 + (elapsed - LAUNCH_DURATION - EXPLODE_DURATION) / FADE_DURATION;
      // Gravity fall
      let fallTime = elapsed - LAUNCH_DURATION - EXPLODE_DURATION;
      let gravity = vec3f(0.0, 0.0, -100.0) * fallTime * fallTime;
      actualPos = fw.center + offset + gravity;
    }
    
    // Distance to this firework's particle position
    let dist = length(satPos - actualPos);
    
    if (dist < PARTICLE_SPREAD && dist < closestDist) {
      closestDist = dist;
      closestFirework = i32(i);
      closestPhase = phase;
      closestOffset = offset;
      closestPalette = fw.colorPalette;
    }
  }
  
  if (closestFirework < 0) {
    out.color = baseColor;
    out.brightness = baseBrightness * 0.5;
    return out;
  }
  
  out.inFirework = true;
  
  // Calculate color based on palette and position
  let colorIdx = u32(length(closestOffset) / BURST_RADIUS * 3.0);
  let fwColor = getPaletteColor(closestPalette, colorIdx);
  
  // Calculate brightness based on phase
  var brightness: f32;
  if (closestPhase < 1.0) {
    // Launch - dim trail
    brightness = closestPhase * 0.5;
  } else if (closestPhase < 2.0) {
    // Explosion - bright burst
    let explodeT = closestPhase - 1.0;
    brightness = 2.0 * (1.0 - explodeT * 0.3); // Slight fade during explosion
  } else {
    // Fade - falling sparks
    let fadeT = closestPhase - 2.0;
    brightness = 1.5 * (1.0 - fadeT);
  }
  
  // Distance falloff
  let distFalloff = 1.0 - smoothstep(0.0, PARTICLE_SPREAD, closestDist);
  brightness = brightness * distFalloff;
  
  // Trail effect for falling phase
  if (closestPhase >= 2.0) {
    let trail = sin(closestPhase * 20.0) * 0.2 + 0.8;
    brightness = brightness * trail;
  }
  
  out.color = mix(baseColor, fwColor, brightness);
  out.brightness = max(baseBrightness, baseBrightness * brightness * 3.0);
  
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIMPLIFIED VERSION FOR GPU COMPUTE
// ═══════════════════════════════════════════════════════════════════════════════

fn calculateFireworksSimple(
  satPos: vec3f,
  baseColor: vec3f,
  baseBrightness: f32,
  params: FireworkParams
) -> FireworkOutput {
  var out: FireworkOutput;
  
  // Generate firework centers deterministically from global seed
  var totalBrightness: f32 = 0.0;
  var totalColor = vec3f(0.0);
  var inAnyFirework = false;
  
  for (var i: u32 = 0u; i < NUM_FIREWORKS; i++) {
    let fwSeed = params.globalSeed + i * 7919u;
    let startTime = randomFloat(fwSeed) * 10.0; // Staggered starts
    let elapsed = params.time * params.speed - startTime;
    
    if (elapsed < 0.0 || elapsed > TOTAL_FIREWORK_DURATION) {
      continue;
    }
    
    let center = generateFireworkCenter(fwSeed);
    let paletteIdx = u32(randomFloat(fwSeed + 100u) * 5.0);
    
    // Get particle offset for this satellite
    let satSeed = fwSeed + u32(fract(dot(satPos, vec3f(12.9898, 78.233, 45.164))) * 10000.0);
    let offset = assignToFirework(satPos, i, fwSeed);
    
    // Calculate position
    var actualPos: vec3f;
    var brightness: f32;
    
    if (elapsed < LAUNCH_DURATION) {
      let t = elapsed / LAUNCH_DURATION;
      let launchStart = center - normalize(offset) * BURST_RADIUS * 2.0;
      actualPos = mix(launchStart, center, t);
      brightness = t * 0.5;
    } else if (elapsed < LAUNCH_DURATION + EXPLODE_DURATION) {
      let t = (elapsed - LAUNCH_DURATION) / 0.3;
      let expansion = min(t, 1.0);
      actualPos = center + offset * expansion;
      brightness = 2.0;
    } else {
      let t = (elapsed - LAUNCH_DURATION - EXPLODE_DURATION) / FADE_DURATION;
      let fall = vec3f(0.0, 0.0, -50.0) * t * t;
      actualPos = center + offset + fall;
      brightness = 1.5 * (1.0 - t);
    }
    
    let dist = length(satPos - actualPos);
    if (dist < PARTICLE_SPREAD) {
      let distFactor = 1.0 - smoothstep(0.0, PARTICLE_SPREAD, dist);
      let colorIdx = u32(length(offset) / BURST_RADIUS * 3.0);
      let fwColor = getPaletteColor(paletteIdx, colorIdx);
      
      totalColor = totalColor + fwColor * brightness * distFactor;
      totalBrightness = totalBrightness + brightness * distFactor;
      inAnyFirework = true;
    }
  }
  
  if (!inAnyFirework) {
    out.color = baseColor;
    out.brightness = baseBrightness * 0.5;
    out.inFirework = false;
    return out;
  }
  
  out.color = mix(baseColor, totalColor, min(totalBrightness, 1.0));
  out.brightness = max(baseBrightness, baseBrightness * totalBrightness * 2.0);
  out.inFirework = true;
  
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPUTE SHADER ENTRY
// ═══════════════════════════════════════════════════════════════════════════════

@group(0) @binding(0) var<uniform> fireworkParams: FireworkParams;
@group(0) @binding(1) var<storage, read> satPositions: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> satColors: array<vec4f>;

@compute @workgroup_size(256)
fn fireworksCompute(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= 1048576u) { return; }
  
  let satPos = satPositions[i].xyz;
  let currentColor = satColors[i];
  
  let fw = calculateFireworksSimple(
    satPos,
    currentColor.rgb,
    currentColor.a,
    fireworkParams
  );
  
  satColors[i] = vec4f(fw.color, fw.brightness);
}
