/**
 * Enhanced Earth Atmosphere Shader
 * 
 * Cinematic atmospheric effects with:
 * - Accurate Rayleigh scattering (blue limb)
 * - Mie scattering for horizon haze
 * - Twilight color temperature gradients
 * - Procedural city lights on night side
 */

// Atmospheric constants (Earth)
const EARTH_RADIUS_KM: f32 = 6371.0;
const ATMOSPHERE_HEIGHT_KM: f32 = 100.0;
const ATMOSPHERE_RADIUS_KM: f32 = EARTH_RADIUS_KM + ATMOSPHERE_HEIGHT_KM;

// Scattering coefficients
const RAYLEIGH_SCALE_HEIGHT: f32 = 8.0;    // km - Rayleigh scattering scale height
const MIE_SCALE_HEIGHT: f32 = 1.2;          // km - Mie scattering scale height

// Scattering strengths (tuned for visual appeal)
const RAYLEIGH_SCATTERING: vec3f = vec3f(0.0058, 0.0135, 0.0331); // λ^-4 dependence
const MIE_SCATTERING: f32 = 0.003996;       // Mie scattering coefficient
const MIE_ABSORPTION: f32 = 0.000444;       // Mie absorption
const MIE_G: f32 = 0.8;                     // Mie scattering phase asymmetry

// Sun parameters
const SUN_INTENSITY: f32 = 20.0;
const SUN_ANGULAR_RADIUS: f32 = 0.00465;    // ~0.266 degrees in radians

// City lights
const CITY_LIGHTS_INTENSITY: f32 = 0.5;
const CITY_LIGHTS_THRESHOLD: f32 = -0.1;    // cos(90° + small angle)

// ═══════════════════════════════════════════════════════════════════════════════
// ATMOSPHERE DENSITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

// Rayleigh density at altitude
fn rayleighDensity(altitude: f32) -> f32 {
  return exp(-altitude / RAYLEIGH_SCALE_HEIGHT);
}

// Mie density at altitude
fn mieDensity(altitude: f32) -> f32 {
  return exp(-altitude / MIE_SCALE_HEIGHT);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCATTERING PHASE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

// Rayleigh phase function (isotropic-ish)
fn rayleighPhase(cosTheta: f32) -> f32 {
  return (3.0 / (16.0 * 3.14159)) * (1.0 + cosTheta * cosTheta);
}

// Mie phase function (Henyey-Greenstein)
fn miePhaseHG(cosTheta: f32, g: f32) -> f32 {
  let g2 = g * g;
  let denom = pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5);
  return (1.0 - g2) / (4.0 * 3.14159 * denom);
}

// ═══════════════════════════════════════════════════════════════════════════════
// RAY-ATMOSPHERE INTERSECTION
// ═══════════════════════════════════════════════════════════════════════════════

// Calculate ray intersection with atmosphere
fn raySphereIntersect(
  rayOrigin: vec3f,
  rayDir: vec3f,
  sphereRadius: f32
) -> vec2f {
  let a = dot(rayDir, rayDir);
  let b = 2.0 * dot(rayOrigin, rayDir);
  let c = dot(rayOrigin, rayOrigin) - sphereRadius * sphereRadius;
  
  let discriminant = b * b - 4.0 * a * c;
  
  if (discriminant < 0.0) {
    return vec2f(-1.0, -1.0); // No intersection
  }
  
  let sqrtDisc = sqrt(discriminant);
  let t1 = (-b - sqrtDisc) / (2.0 * a);
  let t2 = (-b + sqrtDisc) / (2.0 * a);
  
  return vec2f(t1, t2);
}

// ═══════════════════════════════════════════════════════════════════════════════
// OPTICAL DEPTH INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════════

// Sample optical depth along ray
fn integrateOpticalDepth(
  rayOrigin: vec3f,
  rayDir: vec3f,
  rayLength: f32,
  numSamples: i32
) -> vec2f {
  // Returns: (rayleigh optical depth, mie optical depth)
  
  let stepSize = rayLength / f32(numSamples);
  var rayleighDepth = 0.0;
  var mieDepth = 0.0;
  
  for (var i: i32 = 0; i < numSamples; i++) {
    let t = (f32(i) + 0.5) * stepSize;
    let pos = rayOrigin + rayDir * t;
    let altitude = length(pos) - EARTH_RADIUS_KM;
    
    if (altitude < 0.0) {
      continue; // Inside Earth
    }
    
    rayleighDepth += rayleighDensity(altitude) * stepSize;
    mieDepth += mieDensity(altitude) * stepSize;
  }
  
  return vec2f(rayleighDepth, mieDepth);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ATMOSPHERIC SCATTERING INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════════

const NUM_SAMPLES: i32 = 8;        // Primary ray samples
const NUM_LIGHT_SAMPLES: i32 = 4;  // Light ray samples

struct ScatteringResult {
  rayleigh: vec3f,
  mie: vec3f,
};

// Main atmospheric scattering calculation
fn integrateAtmosphere(
  rayOrigin: vec3f,
  rayDir: vec3f,
  sunDir: vec3f,
  tMin: f32,
  tMax: f32
) -> ScatteringResult {
  var result: ScatteringResult;
  result.rayleigh = vec3f(0.0);
  result.mie = vec3f(0.0);
  
  let cosTheta = dot(rayDir, sunDir);
  let rayleighPhase = rayleighPhase(cosTheta);
  let miePhase = miePhaseHG(cosTheta, MIE_G);
  
  let stepSize = (tMax - tMin) / f32(NUM_SAMPLES);
  
  // Pre-calculate optical depth from camera to each sample point
  for (var i: i32 = 0; i < NUM_SAMPLES; i++) {
    let t = tMin + (f32(i) + 0.5) * stepSize;
    let pos = rayOrigin + rayDir * t;
    let altitude = length(pos) - EARTH_RADIUS_KM;
    
    if (altitude < 0.0) {
      continue; // Skip points inside Earth
    }
    
    // Sample densities
    let rayleighDens = rayleighDensity(altitude);
    let mieDens = mieDensity(altitude);
    
    // Calculate optical depth to sun
    let sunIntersect = raySphereIntersect(pos, sunDir, ATMOSPHERE_RADIUS_KM);
    let sunDist = sunIntersect.y;
    let lightOpticalDepth = integrateOpticalDepth(pos, sunDir, sunDist, NUM_LIGHT_SAMPLES);
    
    // Calculate optical depth from camera to this point
    let viewOpticalDepth = integrateOpticalDepth(rayOrigin, rayDir, t, NUM_SAMPLES);
    
    // Total optical depth
    let totalRayleighDepth = viewOpticalDepth.x + lightOpticalDepth.x;
    let totalMieDepth = viewOpticalDepth.y + lightOpticalDepth.y;
    
    // Transmittance (Beer-Lambert law)
    let transmittance = exp(-(
      RAYLEIGH_SCATTERING * totalRayleighDepth +
      vec3f(MIE_SCATTERING) * totalMieDepth
    ));
    
    // Accumulate scattering
    result.rayleigh += rayleighDens * transmittance * stepSize;
    result.mie += mieDens * transmittance * stepSize;
  }
  
  // Apply phase functions
  result.rayleigh *= RAYLEIGH_SCATTERING * rayleighPhase * SUN_INTENSITY;
  result.mie *= MIE_SCATTERING * miePhase * SUN_INTENSITY;
  
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TWILIGHT COLOR TEMPERATURE
// ═══════════════════════════════════════════════════════════════════════════════

fn calculateTwilightColor(cosSunAngle: f32) -> vec3f {
  // cosSunAngle: 1.0 = noon, 0.0 = horizon, -1.0 = midnight
  
  // Color temperatures at different sun angles
  let colorNoon = vec3f(1.0, 0.98, 0.95);        // 5500K - neutral white
  let colorSunset = vec3f(1.0, 0.6, 0.3);        // 3000K - warm orange
  let colorTwilight = vec3f(0.4, 0.5, 0.8);      // 8000K - blue
  let colorNight = vec3f(0.05, 0.08, 0.15);      // Deep blue-black
  
  if (cosSunAngle > 0.1) {
    // Day
    return colorNoon;
  } else if (cosSunAngle > -0.1) {
    // Sunset/sunrise transition
    let t = smoothstep(0.1, -0.1, cosSunAngle);
    return mix(colorNoon, colorSunset, t);
  } else if (cosSunAngle > -0.3) {
    // Twilight
    let t = smoothstep(-0.1, -0.3, cosSunAngle);
    return mix(colorSunset, colorTwilight, t);
  } else {
    // Night
    let t = smoothstep(-0.3, -0.5, cosSunAngle);
    return mix(colorTwilight, colorNight, t);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CITY LIGHTS
// ═══════════════════════════════════════════════════════════════════════════════

fn hash2(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

fn noise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash2(i + vec2f(0.0, 0.0)), hash2(i + vec2f(1.0, 0.0)), u.x),
    mix(hash2(i + vec2f(0.0, 1.0)), hash2(i + vec2f(1.0, 1.0)), u.x),
    u.y
  );
}

fn fbm(p: vec2f) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var x = p;
  for (var i: i32 = 0; i < 4; i++) {
    v += a * noise(x);
    x *= 2.0;
    a *= 0.5;
  }
  return v;
}

fn calculateCityLights(
  worldPos: vec3f,
  normal: vec3f,
  sunDir: vec3f
) -> vec3f {
  // Only visible on night side
  let sunDot = dot(normal, sunDir);
  if (sunDot > CITY_LIGHTS_THRESHOLD) {
    return vec3f(0.0);
  }
  
  // Convert to lat/lon
  let lat = asin(clamp(normal.z, -1.0, 1.0));
  let lon = atan2(normal.y, normal.x);
  
  // Multi-octave city noise
  let cityA = fbm(vec2f(lon * 20.0, lat * 20.0));
  let cityB = fbm(vec2f(lon * 61.0, lat * 47.0));
  let cityC = fbm(vec2f(lon * 113.0, lat * 89.0));
  
  // Population centers favor certain latitudes
  let latWeight = 1.0 - abs(lat) * 0.6;
  let landBias = smoothstep(0.3, 0.6, cityA);
  
  let cityMask = landBias * (0.3 + 0.4 * cityB + 0.3 * cityC) * latWeight;
  
  // Night intensity
  let nightIntensity = smoothstep(CITY_LIGHTS_THRESHOLD, -0.2, sunDot);
  
  // City light colors (warm sodium lamps, cool LEDs in dense cores)
  let warmLight = vec3f(1.0, 0.78, 0.28) * cityMask * nightIntensity;
  let coolLight = vec3f(0.9, 0.95, 1.0) * pow(cityMask, 3.0) * nightIntensity * 0.5;
  
  return (warmLight + coolLight) * CITY_LIGHTS_INTENSITY;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN SHADER
// ═══════════════════════════════════════════════════════════════════════════════

struct Uniforms {
  view_proj: mat4x4f,
  camera_pos: vec4f,
  sun_dir: vec4f,
  time: f32,
  pad: vec3f,
};

@group(0) @binding(0) var<uniform> uni: Uniforms;

struct VIn {
  @location(0) pos: vec3f,
  @location(1) nrm: vec3f,
};

struct VOut {
  @builtin(position) cp: vec4f,
  @location(0) world_pos: vec3f,
  @location(1) normal: vec3f,
  @location(2) ray_dir: vec3f,
  @location(3) ray_length: f32,
};

@vertex
fn vs(v: VIn) -> VOut {
  var out: VOut;
  
  // Scale to atmosphere radius
  let atmScale = ATMOSPHERE_RADIUS_KM / EARTH_RADIUS_KM;
  let atmPos = v.pos * atmScale;
  
  out.cp = uni.view_proj * vec4f(atmPos, 1.0);
  out.world_pos = atmPos;
  out.normal = v.nrm;
  
  // Ray from camera through this vertex
  out.ray_dir = normalize(atmPos - uni.camera_pos.xyz);
  
  // Calculate ray intersection with atmosphere
  let rayOrigin = uni.camera_pos.xyz;
  let intersect = raySphereIntersect(rayOrigin, out.ray_dir, ATMOSPHERE_RADIUS_KM);
  out.ray_length = intersect.y - max(intersect.x, 0.0);
  
  return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let rayOrigin = uni.camera_pos.xyz;
  let rayDir = in.ray_dir;
  let sunDir = normalize(uni.sun_dir.xyz);
  
  // Find atmosphere intersection
  let intersect = raySphereIntersect(rayOrigin, rayDir, ATMOSPHERE_RADIUS_KM);
  let earthIntersect = raySphereIntersect(rayOrigin, rayDir, EARTH_RADIUS_KM);
  
  // If we hit Earth first, clip the ray
  var tMin = max(intersect.x, 0.0);
  var tMax = intersect.y;
  
  if (earthIntersect.x > 0.0 && earthIntersect.x < tMax) {
    tMax = earthIntersect.x; // Stop at Earth's surface
  }
  
  if (tMin >= tMax) {
    discard;
  }
  
  // Integrate atmospheric scattering
  let scattering = integrateAtmosphere(rayOrigin, rayDir, sunDir, tMin, tMax);
  
  // Combine Rayleigh and Mie scattering
  let totalScattering = scattering.rayleigh + scattering.mie;
  
  // Apply twilight color grading
  let cosSunAngle = dot(normalize(-rayOrigin), sunDir);
  let twilightColor = calculateTwilightColor(cosSunAngle);
  let gradedScattering = totalScattering * twilightColor;
  
  // Alpha based on scattering intensity
  let alpha = min(length(totalScattering) * 0.5, 1.0);
  
  return vec4f(gradedScattering, alpha);
}
