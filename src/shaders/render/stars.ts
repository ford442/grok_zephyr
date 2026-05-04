/**
 * Starfield Background Shader
 * High-quality procedural starfield with atmospheric horizon glow.
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
  let theta = (uv.x - 0.5) * 2.0 * PI;
  let phi = (uv.y - 0.5) * PI;
  let viewDir = normalize(vec3f(cos(phi)*cos(theta), sin(phi), cos(phi)*sin(theta)));

  let galacticNorth = normalize(vec3f(-0.0548, 0.4941, 0.8677));
  let galacticCenter = normalize(vec3f(-0.0558, -0.8744, 0.4821));

  let galacticLat = asin(clamp(dot(viewDir, galacticNorth), -1.0, 1.0));
  let projGC = normalize(viewDir - galacticNorth * dot(viewDir, galacticNorth) + vec3f(0.0001));
  let galacticLon = atan2(dot(projGC, cross(galacticNorth, galacticCenter)),
                          dot(projGC, galacticCenter));

  let verticalProfile = exp(-galacticLat * galacticLat / (2.0 * 0.15 * 0.15));
  let r = length(vec2f(cos(galacticLon) - 0.1, sin(galacticLon)));
  let radialProfile = 0.3 * exp(-r * 3.0) + 0.7 * exp(-r * 0.8);

  let noiseCoord = viewDir * 8.0 + vec3f(100.0);
  let detail = fbm(noiseCoord) * 0.4 + 0.6;

  let color = mix(vec3f(0.9, 0.85, 0.7), vec3f(0.75, 0.8, 1.0), clamp(r, 0.0, 1.0));
  let intensity = verticalProfile * radialProfile * detail * 0.16;
  return color * intensity;
}

fn renderNebula(uv: vec2f) -> vec3f {
  let pink = vec3f(0.28, 0.14, 0.32);
  let blue = vec3f(0.18, 0.20, 0.40);
  let p = vec3f(uv * 3.4, uni.time * 0.04);
  let n = fbm(p + vec3f(12.1, 21.4, 0.0)) * 0.55 + fbm(p * 2.2 + vec3f(9.3, 5.7, 0.0)) * 0.35;
  let band = smoothstep(0.1, 0.6, fract(uv.x * 1.7 + uv.y * 0.28));
  let cloud = smoothstep(0.35, 0.72, n + 0.28 - pow(abs(uv.y - 0.55), 1.8));
  return mix(blue, pink, band) * cloud * 0.35;
}

fn horizonFog(uv: vec2f, mode: u32) -> vec3f {
  let glow = pow(max(0.0, 0.38 - uv.y), 2.8);
  let horizonColor = vec3f(0.26, 0.16, 0.08);
  let warm = vec3f(0.20, 0.12, 0.06);
  let cold = vec3f(0.07, 0.09, 0.16);

  let horizonScale = select(0.0, 0.42, mode == 1u) + select(0.0, 0.88, mode == 2u);
  let glowLayer = horizonColor * glow * horizonScale;
  let scatter = mix(cold, warm, smoothstep(0.55, 0.90, uv.y));
  let scatterStrength = pow(clamp(1.0 - uv.y * 1.2, 0.0, 1.0), 2.6) * select(0.18, 0.32, mode == 1u) + select(0.0, 0.22, mode == 2u);
  return scatter * scatterStrength + glowLayer;
}

fn starLayer(uv: vec2f, scale: f32, density: f32, twinklePower: f32) -> vec3f {
  let cell = floor(uv * scale);
  let a = hash2(cell);
  let b = hash2(cell + vec2f(1.0, 0.0));
  let c = hash2(cell + vec2f(0.0, 1.0));
  let mag = mix(1.8, 6.2, a);
  let prob = pow(2.512, -mag) * density;
  let starMask = f32(b < prob);
  let radius = pow(c, 2.4) * 0.9 + 0.05;
  let intensity = starMask * pow(c, 3.0) * radius;
  let temperature = mix(2800.0, 18000.0, a);
  let color = blackbodyColor(temperature);
  let twinkle = 0.82 + twinklePower * sin(uni.time * (1.2 + b * 3.5) + a * 19.0)
                 + 0.09 * sin(uni.time * (4.3 + c * 5.1) + b * 23.0);
  return color * intensity * twinkle;
}

@fragment fn fs(in:VSOut) -> @location(0) vec4f {
  var sky = mix(vec3f(0.01, 0.02, 0.05), vec3f(0.06, 0.08, 0.15), pow(in.uv.y, 1.7));
  var stars = vec3f(0.0);

  stars += renderMilkyWay(in.uv) * 2.0;
  stars += renderNebula(in.uv);
  stars += starLayer(in.uv, 1024.0, 0.22, 0.22);
  stars += starLayer(in.uv + vec2f(0.002, 0.007), 512.0, 0.16, 0.14);
  stars += starLayer(in.uv + vec2f(0.001, 0.003), 256.0, 0.11, 0.10);
  stars += starLayer(in.uv + vec2f(0.006, 0.004), 78.0, 0.02, 0.05);

  let atmosphere = horizonFog(in.uv, uni.background_mode);
  let modeBoost = select(0.88, select(1.02, 1.18, uni.background_mode == 1u), uni.background_mode == 2u);
  var color = sky * 0.92 + stars * 1.05 + atmosphere;
  color = mix(sky, color, 0.88) * modeBoost;
  color = pow(color, vec3f(0.96, 0.97, 0.99));
  return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;
