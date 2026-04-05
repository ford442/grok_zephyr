/**
 * Spiral Galaxy Animation Shader
 * 
 * Satellites temporarily form spiral arm patterns rotating around Earth.
 * Creates a beautiful galaxy-like formation with swirling arms.
 */

// Galaxy parameters
const GALAXY_RADIUS: f32 = 3500.0;      // Outer radius in km
const GALAXY_CORE_RADIUS: f32 = 500.0;   // Inner core radius
const NUM_ARMS: f32 = 3.0;               // Number of spiral arms
const ARM_THICKNESS: f32 = 400.0;        // Width of each arm in km
const ARM_WRAPS: f32 = 1.5;              // How many times arms wrap around

// Animation timing
const ROTATION_PERIOD: f32 = 60.0;       // Seconds for full rotation

// Colors
const COLOR_CORE: vec3f = vec3f(1.0, 0.9, 0.7);      // Warm white core
const COLOR_ARM_INNER: vec3f = vec3f(0.9, 0.7, 0.4); // Golden
const COLOR_ARM_MID: vec3f = vec3f(0.5, 0.6, 0.9);   // Blue-white
const COLOR_ARM_OUTER: vec3f = vec3f(0.3, 0.4, 0.8); // Deep blue
const COLOR_DUST: vec3f = vec3f(0.6, 0.5, 0.4);      // Brown dust lanes

struct SpiralGalaxyParams {
  time: f32,
  speed: f32,
  phase: u32,           // 0=form, 1=rotate, 2=disperse
  progress: f32,        // 0-1 within phase
  totalProgress: f32,   // 0-1 across all phases
  armTightness: f32,    // How tight the spiral is
  rotationAngle: f32,   // Current rotation
};

// ═══════════════════════════════════════════════════════════════════════════════
// SPIRAL ARM CALCULATION
// ═══════════════════════════════════════════════════════════════════════════════

// Logarithmic spiral: r = a * exp(b * theta)
fn logarithmicSpiral(theta: f32, a: f32, b: f32) -> f32 {
  return a * exp(b * theta);
}

// Distance from point to spiral arm
fn distanceToSpiralArm(
  pos: vec2f,           // Position in polar coordinates (x=r, y=theta)
  armIndex: f32,        // Which arm (0 to NUM_ARMS-1)
  rotation: f32,        // Current rotation angle
  tightness: f32        // Spiral tightness parameter
) -> f32 {
  let armOffset = (armIndex / NUM_ARMS) * 6.28318; // 2*PI / num_arms
  let theta = pos.y - rotation - armOffset;
  
  // Normalize theta to find closest arm position
  let wrappedTheta = fract(theta / 6.28318) * 6.28318;
  
  // Calculate expected radius at this angle for the spiral
  let b = tightness * 0.3; // Spiral tightness
  let a = GALAXY_CORE_RADIUS * 0.5;
  let expectedR = logarithmicSpiral(wrappedTheta, a, b);
  
  // Distance is difference between actual and expected radius
  // But we also need to account for angular distance
  let radialDist = abs(pos.x - expectedR);
  let angularDist = pos.x * abs(sin(theta - wrappedTheta));
  
  return sqrt(radialDist * radialDist + angularDist * angularDist);
}

// Get closest arm and distance
fn getSpiralArmInfo(
  satPos: vec3f,
  rotation: f32,
  tightness: f32
) -> vec4f {
  // Returns: (distance_to_arm, arm_index, arm_intensity, angular_position)
  
  // Convert to cylindrical coordinates (looking down from pole)
  let r = sqrt(satPos.x * satPos.x + satPos.y * satPos.y);
  let theta = atan2(satPos.y, satPos.x);
  
  // Check if within galaxy radius
  if (r > GALAXY_RADIUS || r < GALAXY_CORE_RADIUS * 0.3) {
    return vec4f(10000.0, -1.0, 0.0, theta);
  }
  
  var minDist = 10000.0;
  var closestArm = -1.0;
  
  for (var i: f32 = 0.0; i < NUM_ARMS; i += 1.0) {
    let dist = distanceToSpiralArm(vec2f(r, theta), i, rotation, tightness);
    if (dist < minDist) {
      minDist = dist;
      closestArm = i;
    }
  }
  
  // Calculate intensity based on distance from arm center
  let intensity = 1.0 - smoothstep(0.0, ARM_THICKNESS, minDist);
  
  return vec4f(minDist, closestArm, intensity, theta);
}

// ═══════════════════════════════════════════════════════════════════════════════
// COLOR GRADIENT
// ═══════════════════════════════════════════════════════════════════════════════

fn getGalaxyColor(radius: f32, armIntensity: f32, theta: f32) -> vec3f {
  // Normalize radius 0-1
  let t = (radius - GALAXY_CORE_RADIUS * 0.3) / (GALAXY_RADIUS - GALAXY_CORE_RADIUS * 0.3);
  
  // Base color gradient
  var color: vec3f;
  if (t < 0.2) {
    color = mix(COLOR_CORE, COLOR_ARM_INNER, t * 5.0);
  } else if (t < 0.6) {
    color = mix(COLOR_ARM_INNER, COLOR_ARM_MID, (t - 0.2) * 2.5);
  } else {
    color = mix(COLOR_ARM_MID, COLOR_ARM_OUTER, (t - 0.6) * 2.5);
  }
  
  // Dust lanes (darken periodically)
  let dustPhase = sin(theta * NUM_ARMS * 2.0) * 0.5 + 0.5;
  let dustMask = smoothstep(0.7, 0.9, dustPhase);
  color = mix(color, color * COLOR_DUST, dustMask * 0.3);
  
  // Apply arm intensity
  color = mix(COLOR_ARM_OUTER * 0.1, color, armIntensity);
  
  return color;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN CALCULATION
// ═══════════════════════════════════════════════════════════════════════════════

struct GalaxyOutput {
  color: vec3f,
  brightness: f32,
  inGalaxy: bool,
  armIndex: i32,
}

fn calculateSpiralGalaxy(
  satPos: vec3f,
  baseColor: vec3f,
  baseBrightness: f32,
  params: SpiralGalaxyParams
) -> GalaxyOutput {
  var out: GalaxyOutput;
  
  // Calculate rotation angle
  let rotation = params.rotationAngle + params.time * params.speed * (6.28318 / ROTATION_PERIOD);
  
  // Get arm info
  let armInfo = getSpiralArmInfo(satPos, rotation, params.armTightness);
  let distToArm = armInfo.x;
  let armIndex = i32(armInfo.y);
  let armIntensity = armInfo.z;
  let theta = armInfo.w;
  
  // Calculate radius
  let radius = length(satPos.xy);
  
  // Check if in galaxy
  if (armIndex < 0 || radius > GALAXY_RADIUS) {
    out.color = baseColor;
    out.brightness = baseBrightness * 0.3;
    out.inGalaxy = false;
    out.armIndex = -1;
    return out;
  }
  
  out.inGalaxy = true;
  out.armIndex = armIndex;
  
  // Calculate color
  let galaxyColor = getGalaxyColor(radius, armIntensity, theta);
  
  // Phase-based blending
  switch (params.phase) {
    case 0u: { // FORM - spiral forms from chaos
      let t = params.progress;
      let formT = 1.0 - pow(1.0 - t, 2.0);
      
      // Particles spiral in from outside
      let targetR = (GALAXY_CORE_RADIUS + (GALAXY_RADIUS - GALAXY_CORE_RADIUS) * 
                    fract(f32(armIndex) / NUM_ARMS + theta / 6.28318));
      let radialDiff = abs(radius - targetR) / GALAXY_RADIUS;
      let formed = 1.0 - smoothstep(0.0, 0.5 * (1.0 - formT), radialDiff);
      
      out.color = mix(baseColor, galaxyColor, formed * formT);
      out.brightness = mix(baseBrightness, baseBrightness * (1.0 + armIntensity), formed * formT);
    }
    case 1u: { // ROTATE - steady rotation
      // Twinkle effect based on position in arm
      let twinkle = sin(theta * 20.0 + params.time * 5.0) * 0.1 + 0.9;
      
      out.color = galaxyColor;
      out.brightness = baseBrightness * (0.5 + armIntensity * twinkle * 2.0);
    }
    case 2u: { // DISPERSE - spiral dissolves
      let t = params.progress;
      let disperseT = t * t;
      
      // Particles drift outward
      let dispersion = disperseT * GALAXY_RADIUS * 0.5;
      let dispersed = smoothstep(0.0, dispersion, distToArm);
      
      out.color = mix(galaxyColor, baseColor, disperseT);
      out.brightness = mix(baseBrightness * (1.0 + armIntensity), baseBrightness, disperseT);
    }
    default: {
      out.color = baseColor;
      out.brightness = baseBrightness;
    }
  }
  
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPUTE SHADER ENTRY
// ═══════════════════════════════════════════════════════════════════════════════

@group(0) @binding(0) var<uniform> galaxyParams: SpiralGalaxyParams;
@group(0) @binding(1) var<storage, read> satPositions: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> satColors: array<vec4f>;

@compute @workgroup_size(256)
fn spiralGalaxyCompute(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= 1048576u) { return; }
  
  let satPos = satPositions[i].xyz;
  let currentColor = satColors[i];
  
  let galaxy = calculateSpiralGalaxy(
    satPos,
    currentColor.rgb,
    currentColor.a,
    galaxyParams
  );
  
  satColors[i] = vec4f(galaxy.color, galaxy.brightness);
}
