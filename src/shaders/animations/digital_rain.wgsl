/**
 * Digital Rain Animation Shader
 * 
 * Matrix-style cascading green columns falling across the constellation.
 * Inspired by the iconic Matrix digital rain effect.
 */

// Animation parameters
const COLUMN_WIDTH_KM: f32 = 50.0;      // Width of each character column
const FALL_SPEED_KM_S: f32 = 200.0;     // Falling speed in km/s
const TRAIL_LENGTH_KM: f32 = 800.0;     // Length of the trail
const SYMBOL_DENSITY: f32 = 20.0;       // Satellites per symbol height

// Matrix color palette
const COLOR_MATRIX_GREEN: vec3f = vec3f(0.0, 1.0, 0.2);
const COLOR_MATRIX_BRIGHT: vec3f = vec3f(0.8, 1.0, 0.8);
const COLOR_MATRIX_DARK: vec3f = vec3f(0.0, 0.3, 0.05);
const COLOR_BACKGROUND: vec3f = vec3f(0.0, 0.05, 0.0);

struct DigitalRainParams {
  time: f32,
  speed: f32,
  density: f32,      // 0-1 controlling how many columns are active
  phase: u32,        // 0=buildup, 1=falling, 2=fade
  progress: f32,     // 0-1 within phase
};

// Hash function for deterministic pseudo-random values
fn hash(value: u32) -> f32 {
  let v = value * 747796405u + 2891336453u;
  let word = ((v >> ((v >> 28u) + 4u)) ^ v) * 277803737u;
  return f32((word >> 22u) ^ word) / 4294967295.0;
}

fn hashVec3(seed: vec3f) -> f32 {
  return fract(sin(dot(seed, vec3f(12.9898, 78.233, 45.164))) * 43758.5453);
}

// ═══════════════════════════════════════════════════════════════════════════════
// DIGITAL RAIN PATTERN GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

struct RainColumn {
  xPos: f32,           // Column X position
  zPos: f32,           // Column Z position
  headY: f32,          // Current head position (falling)
  speed: f32,          // Individual column speed variation
  intensity: f32,      // How bright this column is
  isActive: bool,      // Whether this column is currently falling
}

fn getColumnIndex(satPos: vec3f) -> u32 {
  // Map satellite position to column index based on X/Z grid
  let colX = i32(floor(satPos.x / COLUMN_WIDTH_KM));
  let colZ = i32(floor(satPos.z / COLUMN_WIDTH_KM));
  return u32((colX + 1000) * 2000 + (colZ + 1000));
}

fn getColumnData(colIndex: u32, time: f32, speed: f32) -> RainColumn {
  var col: RainColumn;
  
  // Deterministic random values for this column
  col.speed = 0.8 + hash(colIndex) * 0.4; // 0.8-1.2 speed variation
  col.intensity = 0.5 + hash(colIndex + 1u) * 0.5;
  
  // Column position (reconstruct from hash)
  let angle = hash(colIndex + 2u) * 6.28318;
  let radius = 6921.0; // Orbit radius
  col.xPos = cos(angle) * radius;
  col.zPos = sin(angle) * radius;
  
  // Falling head position
  let cycleTime = 10.0 / col.speed;
  let cycleOffset = hash(colIndex + 3u) * cycleTime;
  col.headY = 2000.0 - fmod(time * FALL_SPEED_KM_S * speed * col.speed + cycleOffset, cycleTime * FALL_SPEED_KM_S);
  
  // Column activation based on density
  col.isActive = hash(colIndex + 4u) < 0.7; // 70% of columns active
  
  return col;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SATELLITE COLOR CALCULATION
// ═══════════════════════════════════════════════════════════════════════════════

struct DigitalRainOutput {
  color: vec3f,
  brightness: f32,
  isHead: bool,        // Is this the leading (bright) character?
}

fn calculateDigitalRain(
  satPos: vec3f,
  params: DigitalRainParams
) -> DigitalRainOutput {
  var out: DigitalRainOutput;
  
  let colIndex = getColumnIndex(satPos);
  let col = getColumnData(colIndex, params.time, params.speed);
  
  if (!col.isActive) {
    out.color = COLOR_BACKGROUND;
    out.brightness = 0.1;
    out.isHead = false;
    return out;
  }
  
  // Distance from satellite to column center
  let distToColumn = sqrt(
    pow(satPos.x - col.xPos, 2.0) + 
    pow(satPos.z - col.zPos, 2.0)
  );
  
  // Check if satellite is in this column
  if (distToColumn > COLUMN_WIDTH_KM * 0.5) {
    out.color = COLOR_BACKGROUND;
    out.brightness = 0.05;
    out.isHead = false;
    return out;
  }
  
  // Calculate position in trail
  let distFromHead = satPos.y - col.headY;
  let trailProgress = distFromHead / TRAIL_LENGTH_KM; // 0 at head, 1 at tail
  
  // Trail bounds
  if (trailProgress < -0.2 || trailProgress > 1.0) {
    out.color = COLOR_BACKGROUND;
    out.brightness = 0.02;
    out.isHead = false;
    return out;
  }
  
  // Symbol pattern within column (simulate characters)
  let symbolPhase = fract(trailProgress * 10.0 + hash(colIndex) * 100.0);
  let isSymbol = symbolPhase < 0.7; // 70% are "on" symbols
  
  // Trail intensity falloff
  let trailIntensity = 1.0 - smoothstep(0.0, 1.0, trailProgress);
  
  // Head is brightest
  out.isHead = trailProgress < 0.05;
  
  if (out.isHead) {
    // Leading edge - bright white-green
    out.color = COLOR_MATRIX_BRIGHT;
    out.brightness = 2.0 * col.intensity;
  } else if (isSymbol) {
    // Trail symbols - green gradient
    let greenIntensity = trailIntensity * col.intensity;
    out.color = mix(COLOR_MATRIX_DARK, COLOR_MATRIX_GREEN, greenIntensity);
    out.brightness = greenIntensity * 0.8;
  } else {
    // Gap between symbols
    out.color = COLOR_MATRIX_DARK;
    out.brightness = trailIntensity * 0.2;
  }
  
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHADER ENTRY POINTS
// ═══════════════════════════════════════════════════════════════════════════════

@group(0) @binding(0) var<uniform> rainParams: DigitalRainParams;
@group(0) @binding(1) var<storage, read> satPositions: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> satColors: array<vec4f>;

@compute @workgroup_size(256)
fn digitalRainCompute(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= 1048576u) { return; }
  
  let satPos = satPositions[i].xyz;
  
  let rain = calculateDigitalRain(satPos, rainParams);
  
  // Write output
  satColors[i] = vec4f(rain.color, rain.brightness);
}

// ═══════════════════════════════════════════════════════════════════════════════
// VERTEX/FRAGMENT SHADER VARIANT FOR REAL-TIME FALLING EFFECT
// ═══════════════════════════════════════════════════════════════════════════════

struct RainVOut {
  @builtin(position) pos: vec4f,
  @location(0) color: vec3f,
  @location(1) brightness: f32,
  @location(2) isHead: f32,
};

// This would be called from main satellite shader with rain parameters
fn getDigitalRainColor(
  satPos: vec3f,
  baseColor: vec3f,
  baseBrightness: f32,
  time: f32,
  speed: f32
) -> vec4f {
  var params: DigitalRainParams;
  params.time = time;
  params.speed = speed;
  params.density = 0.7;
  params.phase = 1u;
  params.progress = fract(time * 0.1);
  
  let rain = calculateDigitalRain(satPos, params);
  
  // Blend with base color during transitions
  return vec4f(rain.color, rain.brightness);
}
