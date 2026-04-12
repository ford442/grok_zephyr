/**
 * Earth Sphere Shader
 * FBM terrain with biomes, PBR ocean with Fresnel + sun glint, city lights
 */

import { UNIFORM_STRUCT } from '../uniforms.js';

export const EARTH_SHADER = UNIFORM_STRUCT + /* wgsl */ `
struct VIn  { @location(0) pos:vec3f, @location(1) nrm:vec3f }
struct VOut { @builtin(position) cp:vec4f, @location(0) wp:vec3f, @location(1) n:vec3f }

const PI: f32 = 3.14159265;

@vertex fn vs(v:VIn) -> VOut {
  var o:VOut;
  o.cp = uni.view_proj * vec4f(v.pos,1);
  o.wp = v.pos;
  o.n  = v.nrm;
  return o;
}

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

// Schlick Fresnel approximation
fn schlickFresnel(cosTheta:f32, F0:f32)->f32 {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

// Gerstner wave contribution for ocean normals
fn gerstnerWave(pos2d:vec2f, dir:vec2f, wavelength:f32, amplitude:f32, time:f32)->vec3f {
  let k = 2.0 * PI / wavelength;
  let c = sqrt(9.8 / k);
  let phase = k * (dot(dir, pos2d) - c * time);
  return vec3f(dir.x * amplitude * cos(phase), amplitude * sin(phase), dir.y * amplitude * cos(phase));
}

fn getOceanNormal(worldPos:vec3f, time:f32)->vec3f {
  let lat = asin(clamp(worldPos.z / length(worldPos), -1.0, 1.0));
  let lon = atan2(worldPos.y, worldPos.x);
  let pos2d = vec2f(lon * 6371.0, lat * 6371.0);

  var wavePos = vec3f(0.0);
  wavePos += gerstnerWave(pos2d, normalize(vec2f(1.0, 0.3)), 2000.0, 15.0, time * 0.05);
  wavePos += gerstnerWave(pos2d, normalize(vec2f(0.8, 0.6)), 800.0, 6.0, time * 0.08);
  wavePos += gerstnerWave(pos2d, normalize(vec2f(0.3, 0.9)), 300.0, 2.0, time * 0.12);
  wavePos += gerstnerWave(pos2d, normalize(vec2f(0.5, 0.5)), 100.0, 0.5, time * 0.2);

  let tangent = normalize(vec3f(1.0, 0.0, wavePos.x / 100.0));
  let bitangent = normalize(vec3f(0.0, 1.0, wavePos.z / 100.0));
  return normalize(cross(tangent, bitangent));
}

fn oceanColor(worldPos:vec3f, normal:vec3f, viewDir:vec3f, sunDir:vec3f, time:f32)->vec3f {
  let waveNormal = getOceanNormal(worldPos, time);
  let N = normalize(normal + waveNormal * 0.3);

  // Fresnel reflectance
  let VdotN = max(dot(viewDir, N), 0.0);
  let fresnel = schlickFresnel(VdotN, 0.02);

  // Base ocean color with depth variation
  let deepColor = vec3f(0.02, 0.08, 0.18);
  let shallowColor = vec3f(0.05, 0.25, 0.40);
  let baseColor = mix(deepColor, shallowColor, 0.3);

  // Diffuse lighting
  let NdotL = max(dot(N, sunDir), 0.0);
  let diffuse = baseColor * NdotL * (1.0 - fresnel);

  // Sun glint (Blinn-Phong)
  let H = normalize(viewDir + sunDir);
  let NdotH = max(dot(N, H), 0.0);
  let roughness = 0.1 + 0.2 * (1.0 - VdotN);
  let specPower = mix(200.0, 20.0, roughness);
  let specular = pow(NdotH, specPower) * fresnel * 2.0;

  // Environment reflection (sky color approximation)
  let skyColor = vec3f(0.4, 0.7, 1.0);
  let reflection = skyColor * fresnel * 0.5;

  return diffuse + vec3f(specular) + reflection;
}

@fragment fn fs(in:VOut) -> @location(0) vec4f {
  let N       = normalize(in.n);
  let sun_dir = normalize(vec3f(1.0,0.4,0.2));
  let V       = normalize(uni.camera_pos.xyz - in.wp);
  let diff    = max(dot(N,sun_dir),0.0);

  let lat = asin(clamp(N.z,-1.0,1.0));
  let lon = atan2(N.y,N.x);

  // FBM terrain height
  let terrainPos = normalize(in.wp) * 3.0;
  let height = fbmTerrain(terrainPos, 4);

  // Determine land vs ocean
  let isLand = height > 0.45;

  // Ice caps (polar regions + high altitude)
  let pole = smoothstep(1.1, 1.4, abs(lat));
  let snowLine = smoothstep(0.82, 0.88, height) * (1.0 - abs(lat) / (PI / 2.0));

  var surf: vec3f;
  if (isLand) {
    // Terrain normal from height gradient for self-shadowing
    let eps = 0.01;
    let hL = fbmTerrain(normalize(in.wp + vec3f(-eps, 0.0, 0.0)) * 3.0, 4);
    let hR = fbmTerrain(normalize(in.wp + vec3f(eps, 0.0, 0.0)) * 3.0, 4);
    let hD = fbmTerrain(normalize(in.wp + vec3f(0.0, -eps, 0.0)) * 3.0, 4);
    let hU = fbmTerrain(normalize(in.wp + vec3f(0.0, eps, 0.0)) * 3.0, 4);
    let gradient = vec2f(hR - hL, hU - hD) / (2.0 * eps);
    let terrainNormal = normalize(vec3f(-gradient.x, -gradient.y, 1.0));
    let modN = normalize(N + terrainNormal * 0.3);

    // Slope for biome classification
    let slope = length(N - normalize(in.wp));

    // Get biome color
    surf = biomeColor(height, lat, slope);

    // Apply ice/snow
    surf = mix(surf, vec3f(0.90, 0.92, 0.95), max(pole, snowLine));

    // Lighting with terrain-modulated normal
    let NdotL = max(dot(modN, sun_dir), 0.0);
    surf = surf * (NdotL * 0.92 + 0.04);
  } else {
    // PBR Ocean with Fresnel and sun glint
    surf = oceanColor(in.wp, N, V, sun_dir, uni.time);
    surf = mix(surf, vec3f(0.90, 0.92, 0.95), pole);
  }

  // City lights on night side
  let night = smoothstep(0.12, -0.04, dot(N, sun_dir));
  let cityA = 0.5 + 0.5 * sin(lon * 22.0 + lat * 18.0);
  let cityB = 0.5 + 0.5 * sin(lon * 61.0 + lat * 47.0);
  let cityMask = f32(isLand) * cityA * (0.4 + 0.3*cityB);
  let cityWarm = vec3f(1.0, 0.78, 0.28) * cityMask * night * 0.12;

  return vec4f(surf + cityWarm, 1.0);
}
`;
