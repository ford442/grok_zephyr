/**
 * Shared WGSL Terrain Helpers
 *
 * Procedural terrain, biome, and city-light functions used by both the Earth
 * sphere shader (orbit views) and the Ground View horizon shader, so both
 * sample identical terrain heights, biome colors, and night-light clusters.
 *
 * Concatenate after UNIFORM_STRUCT and before shader-specific code.
 */

export const TERRAIN_COMMON = /* wgsl */ `
const PI: f32 = 3.14159265;
const EARTH_SIDEREAL_PERIOD: f32 = 86164.0;  // seconds — one sidereal day
const TWILIGHT_COS_HALF:     f32 = 0.12;     // ≈ 6.9° angular half-width of twilight band
const NIGHT_START:           f32 = 0.08;     // sun-dot threshold where night begins
const NIGHT_END:             f32 = -0.06;    // sun-dot threshold where night is full
const RAYLEIGH_COEFF = vec3f(5.8e-3, 13.5e-3, 33.1e-3);
const MIE_COEFF = vec3f(2.1e-2);

// Simplex-like noise (hash-based approximation)
fn hash3d(p:vec3f)->f32 {
  return fract(sin(dot(p,vec3f(127.1,311.7,74.7)))*43758.5453);
}

fn noise3d(p:vec3f)->f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3d(i + vec3f(0,0,0)), hash3d(i + vec3f(1,0,0)), u.x),
        mix(hash3d(i + vec3f(0,1,0)), hash3d(i + vec3f(1,1,0)), u.x), u.y),
    mix(mix(hash3d(i + vec3f(0,0,1)), hash3d(i + vec3f(1,0,1)), u.x),
        mix(hash3d(i + vec3f(0,1,1)), hash3d(i + vec3f(1,1,1)), u.x), u.y),
    u.z
  );
}

fn fbmTerrain(pos:vec3f, octaves:i32)->f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var frequency = 1.0;
  var maxValue = 0.0;
  for (var i = 0; i < octaves; i++) {
    value += amplitude * noise3d(pos * frequency);
    maxValue += amplitude;
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  return value / maxValue;
}

fn biomeColor(height:f32, latitude:f32, slope:f32)->vec3f {
  const SEA_LEVEL = 0.45;
  const COASTAL   = 0.48;
  const PLAINS    = 0.55;
  const HILLS     = 0.70;
  const MOUNTAIN  = 0.85;

  let temp = 1.0 - abs(latitude) / (PI / 2.0);

  let ocean  = vec3f(0.02, 0.08, 0.18);
  let beach  = vec3f(0.76, 0.70, 0.50);
  let grass  = mix(vec3f(0.25, 0.45, 0.15), vec3f(0.15, 0.35, 0.10), temp);
  let forest = mix(vec3f(0.12, 0.28, 0.08), vec3f(0.08, 0.20, 0.05), temp);
  let rock   = vec3f(0.35, 0.32, 0.28);
  let snow   = vec3f(0.90, 0.92, 0.95);

  var color: vec3f;
  if (height < SEA_LEVEL) {
    color = ocean;
  } else if (height < COASTAL) {
    color = mix(ocean, beach, (height - SEA_LEVEL) / (COASTAL - SEA_LEVEL));
  } else if (height < PLAINS) {
    color = mix(beach, grass, (height - COASTAL) / (PLAINS - COASTAL));
  } else if (height < HILLS) {
    color = mix(grass, forest, (height - PLAINS) / (HILLS - PLAINS));
  } else if (height < MOUNTAIN) {
    color = mix(forest, rock, (height - HILLS) / (MOUNTAIN - HILLS));
  } else {
    color = mix(rock, snow, (height - MOUNTAIN) / (1.0 - MOUNTAIN));
  }

  // Steeper terrain shows more rock
  let slopeFactor = smoothstep(0.3, 0.7, slope);
  color = mix(color, rock, slopeFactor * 0.7);

  // Texture variation via noise
  let detail = noise3d(normalize(vec3f(height, latitude, slope)) * 500.0) * 0.1 + 0.9;
  return color * detail;
}

// ── 2-D noise helpers for city-light clustering ──────────────────────────────
// Separate from the 3-D terrain hash to avoid any frequency aliasing.
// Constants 127.1, 311.7, 43758.5453 are standard hash primes for smooth PRNG.
fn hash2c(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

fn noise2c(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash2c(i + vec2f(0,0)), hash2c(i + vec2f(1,0)), u.x),
    mix(hash2c(i + vec2f(0,1)), hash2c(i + vec2f(1,1)), u.x),
    u.y
  );
}

// 4-octave 2-D FBM for organic, non-repeating city-light patterns
fn fbmCity(p: vec2f) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var x = p;
  for (var i = 0; i < 4; i++) {
    v += a * noise2c(x);
    x *= 2.0;
    a *= 0.5;
  }
  return v;
}

fn schlickFresnel(cosTheta:f32, F0:f32)->f32 {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

// City-light emission for a surface point given its body-frame lat/lon,
// terrain height, land mask, and sun-dot (night factor). Shared between the
// Earth sphere shader and the Ground View horizon shader so night lights
// match across views.
fn cityLightEmission(lat: f32, lon: f32, height: f32, isLand: bool, sunDot: f32) -> vec3f {
  // Strictly night-side — fade in only as sunDot goes negative.
  let night = smoothstep(NIGHT_START, NIGHT_END, sunDot);
  // Coarse FBM captures large population clusters; fine FBM adds sub-city variation
  let cityCoarse = fbmCity(vec2f(lat * 6.0,  lon * 8.0));
  let cityFine   = fbmCity(vec2f(lat * 25.0 + 1.7, lon * 19.0 + 2.3));
  // Coastal elevation bias: cities cluster near coasts and river-delta plains
  let coastalBias = smoothstep(0.44, 0.52, height) * (1.0 - smoothstep(0.52, 0.76, height));
  // Latitude weighting: favour temperate zones ~20°-60° (less near equator/poles)
  let absLat = abs(lat) / (PI / 2.0);
  let latWeight = smoothstep(0.07, 0.22, absLat) * (1.0 - smoothstep(0.60, 0.80, absLat));
  // Final density: land × coastal × latitude × FBM cluster threshold
  let cityDensity = f32(isLand) * coastalBias * latWeight * smoothstep(0.38, 0.58, cityCoarse);
  let cityMask = cityDensity * (0.55 + 0.45 * cityFine);
  // Warm sodium-vapour lights + cool LED cores in dense centres + faint blue atmospheric haze
  let warmLight = vec3f(1.0, 0.78, 0.28) * cityMask;
  let coolLight = vec3f(0.9, 0.95, 1.0) * pow(cityMask, 2.5) * 0.45;
  let cityHaze  = vec3f(0.15, 0.20, 0.40) * cityMask * 0.35;
  return (warmLight + coolLight + cityHaze) * night * 0.18;
}
`;
