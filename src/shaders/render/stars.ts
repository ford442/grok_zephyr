/**
 * Starfield Background Shader
 * Blackbody star colors, magnitude-based distribution, Milky Way band
 */

import { UNIFORM_STRUCT } from '../uniforms.js';

export const STARS_SHADER = UNIFORM_STRUCT + /* wgsl */ `
struct VSOut { @builtin(position) pos:vec4f, @location(0) uv:vec2f };

@vertex fn vs(@builtin(vertex_index) vi:u32) -> VSOut {
  const pts = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
  var o:VSOut;
  o.pos = vec4f(pts[vi],0,1);
  o.uv  = pts[vi]*0.5 + 0.5;
  return o;
}

const PI: f32 = 3.14159265;

fn hash2(p:vec2f)->f32 {
  return fract(sin(dot(p,vec2f(127.1,311.7)))*43758.5453);
}

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

fn fbm(p:vec3f)->f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var freq = 1.0;
  var maxValue = 0.0;
  for (var i = 0; i < 4; i++) {
    value += amplitude * noise3d(p * freq);
    maxValue += amplitude;
    amplitude *= 0.5;
    freq *= 2.0;
  }
  return value / maxValue;
}

fn blackbodyColor(temp:f32)->vec3f {
  let t = clamp(temp, 1000.0, 40000.0) / 1000.0;
  var r: f32 = 1.0;
  if (t > 6.6) {
    r = clamp(1.292 - 0.1292*t + 0.0054*t*t - 0.00007*t*t*t, 0.0, 1.0);
  }
  var g: f32;
  if (t <= 6.6) {
    g = clamp(0.04 + 0.319*t - 0.026*t*t + 0.0009*t*t*t, 0.0, 1.0);
  } else {
    g = clamp(1.016 - 0.0638*t + 0.0014*t*t, 0.0, 1.0);
  }
  var b: f32;
  if (t < 4.0) {
    b = clamp(0.07 * t, 0.0, 1.0);
  } else if (t < 6.6) {
    b = clamp(-1.839 + 0.839*t - 0.0956*t*t + 0.0036*t*t*t, 0.0, 1.0);
  } else {
    b = 1.0;
  }
  return vec3f(r, g, b);
}

fn renderMilkyWay(uv: vec2f) -> vec3f {
  // Convert UV to approximate view direction
  let theta = (uv.x - 0.5) * 2.0 * PI;
  let phi = (uv.y - 0.5) * PI;
  let viewDir = normalize(vec3f(cos(phi)*cos(theta), sin(phi), cos(phi)*sin(theta)));

  // Approximate galactic coordinates
  let galacticNorth = normalize(vec3f(-0.0548, 0.4941, 0.8677));
  let galacticCenter = normalize(vec3f(-0.0558, -0.8744, 0.4821));

  let galacticLat = asin(clamp(dot(viewDir, galacticNorth), -1.0, 1.0));
  let projGC = normalize(viewDir - galacticNorth * dot(viewDir, galacticNorth) + vec3f(0.0001));
  let galacticLon = atan2(dot(projGC, cross(galacticNorth, galacticCenter)),
                          dot(projGC, galacticCenter));

  // Vertical profile: Gaussian band
  let verticalProfile = exp(-galacticLat * galacticLat / (2.0 * 0.15 * 0.15));

  // Radial profile: brighter toward center
  let r = length(vec2f(cos(galacticLon) - 0.1, sin(galacticLon)));
  let radialProfile = 0.3 * exp(-r * 3.0) + 0.7 * exp(-r * 0.8);

  // Noise modulation for cloud structure
  let noiseCoord = viewDir * 8.0 + vec3f(100.0);
  let detail = fbm(noiseCoord) * 0.4 + 0.6;

  // Color: yellow-white center, blue-white arms
  let color = mix(vec3f(0.9, 0.85, 0.7), vec3f(0.75, 0.8, 1.0), clamp(r, 0.0, 1.0));

  let intensity = verticalProfile * radialProfile * detail * 0.15;
  return color * intensity;
}

@fragment fn fs(in:VSOut) -> @location(0) vec4f {
  var total = vec3f(0.0);

  // Milky Way background (deepest layer)
  total += renderMilkyWay(in.uv);

  // Layer 1: Distant fine stars with blackbody colors and magnitude distribution
  let cell1  = floor(in.uv * 512.0);
  let h1     = hash2(cell1);
  let h1b    = hash2(cell1 + vec2f(1.0,0.0));
  let h1c    = hash2(cell1 + vec2f(0.0,1.0));
  // Magnitude-based probability (Pogson's law: more dim stars)
  let mag1   = h1 * 7.0;
  let prob1  = pow(2.512, -mag1) * 2.0;
  let star1  = f32(h1b < prob1 * 0.3) * pow(h1b, 4.0);
  // Blackbody color from temperature
  let temp1  = mix(3000.0, 12000.0, h1c);
  let color1 = blackbodyColor(temp1);
  // Multi-octave twinkling (chaotic, not periodic)
  let twinkle1 = 0.7 + 0.15 * sin(uni.time * (1.5 + h1b*3.0) + h1*20.0)
               + 0.1 * sin(uni.time * (4.0 + h1c*5.0) + h1b*30.0)
               + 0.05 * sin(uni.time * (8.0 + h1*7.0) + h1c*40.0);
  total += color1 * star1 * twinkle1 * 1.5;

  // Layer 2: Mid-range brighter stars
  let cell2  = floor(in.uv * 200.0);
  let h2     = hash2(cell2 + vec2f(43.0,17.0));
  let h2b    = hash2(cell2 + vec2f(71.0,53.0));
  let h2c    = hash2(cell2 + vec2f(97.0,23.0));
  let mag2   = h2 * 5.0;
  let prob2  = pow(2.512, -mag2) * 1.5;
  let star2  = f32(h2b < prob2 * 0.15) * pow(h2b, 3.0);
  let temp2  = mix(3500.0, 20000.0, h2c);
  let color2 = blackbodyColor(temp2);
  let twinkle2 = 0.8 + 0.1 * sin(uni.time * (0.8 + h2b*1.5) + h2*15.0)
               + 0.07 * sin(uni.time * (3.5 + h2c*3.0) + h2b*25.0)
               + 0.03 * sin(uni.time * (7.0 + h2*5.0) + h2c*35.0);
  total += color2 * star2 * twinkle2 * 2.5;

  // Layer 3: Bright foreground stars (sparse, vivid colors)
  let cell3  = floor(in.uv * 80.0);
  let h3     = hash2(cell3 + vec2f(13.0, 91.0));
  let h3b    = hash2(cell3 + vec2f(37.0, 67.0));
  let h3c    = hash2(cell3 + vec2f(59.0, 41.0));
  let star3  = f32(h3 > 0.998) * pow(h3b, 2.0);
  let temp3  = mix(2500.0, 30000.0, h3c);
  let color3 = blackbodyColor(temp3);
  let twinkle3 = 0.85 + 0.1 * sin(uni.time * (0.5 + h3b*0.8) + h3*10.0)
               + 0.05 * sin(uni.time * (2.0 + h3c*2.0) + h3b*20.0);
  total += color3 * star3 * twinkle3 * 3.5;

  return vec4f(total, 1.0);
}
`;
