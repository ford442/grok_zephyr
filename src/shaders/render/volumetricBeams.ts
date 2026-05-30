/**
 * Volumetric Beam Shader
 *
 * Fullscreen ray-marching pass for cinematic-quality god-ray beam projections.
 * Uses Mie scattering and Beer–Lambert transmittance over up to 64 active beams.
 *
 * Bound resources (group 0):
 *   binding 0 – Uni uniform (camera, time, …)
 *   binding 1 – beams : array<vec4f>  (same buffer as the ribbon beam pass)
 *   binding 2 – volConfig : VolumetricBeamConfig uniform
 */

import { UNIFORM_STRUCT } from '../uniforms.js';

export const VOLUMETRIC_BEAM_SHADER = UNIFORM_STRUCT + /* wgsl */ `

// ─── Volumetric configuration uniform ────────────────────────────────────────
struct VolumetricBeamConfig {
  density      : f32,   // scattering coefficient
  intensity    : f32,   // beam light intensity multiplier
  mieG         : f32,   // Mie asymmetry parameter (0=isotropic, 1=forward)
  maxSteps     : u32,   // ray-march step count (4–16)
  beamRadius   : f32,   // volumetric beam radius in km
  ambientFactor: f32,   // fraction of ambient scattering added (0–0.2)
  earthShadow  : u32,   // 1 = apply Earth occlusion, 0 = skip
  _pad         : u32,
};

// ─── Bindings ─────────────────────────────────────────────────────────────────
@group(0) @binding(1) var<storage, read> beams    : array<vec4f>;
@group(0) @binding(2) var<uniform>       volConfig: VolumetricBeamConfig;

// ─── Mie scattering ───────────────────────────────────────────────────────────

// Cornette-Shanks Mie phase function
fn miePhaseCS(cosTheta: f32, g: f32) -> f32 {
  let g2 = g * g;
  let num = 3.0 * (1.0 - g2) * (1.0 + cosTheta * cosTheta);
  let den = 2.0 * (2.0 + g2) * pow(max(0.0001, 1.0 + g2 - 2.0 * g * cosTheta), 1.5);
  return num / den;
}

// ─── Earth shadow ─────────────────────────────────────────────────────────────

const EARTH_RADIUS_KM : f32 = 6371.0;
const SHADOW_SOFTNESS : f32 = 50.0;   // km

fn earthShadow(point: vec3f, lightDir: vec3f) -> f32 {
  let toLight = -lightDir;
  let a = dot(toLight, toLight);
  let b = 2.0 * dot(point, toLight);
  let c = dot(point, point) - EARTH_RADIUS_KM * EARTH_RADIUS_KM;
  let disc = b * b - 4.0 * a * c;
  if (disc < 0.0) { return 1.0; }
  let sqrtDisc = sqrt(disc);
  let t1 = (-b - sqrtDisc) / (2.0 * a);
  let t2 = (-b + sqrtDisc) / (2.0 * a);
  if (t1 < 0.0 && t2 < 0.0) { return 1.0; }
  let closestT = max(t1, 0.0);
  let distFromSurface = length(point + toLight * closestT) - EARTH_RADIUS_KM;
  return smoothstep(-SHADOW_SOFTNESS, SHADOW_SOFTNESS, distFromSurface);
}

// ─── Beam density ─────────────────────────────────────────────────────────────

fn beamDensity(point: vec3f, bStart: vec3f, bEnd: vec3f, radius: f32) -> f32 {
  let dir = bEnd - bStart;
  let len = length(dir);
  if (len < 1.0) { return 0.0; }
  let dirN  = dir / len;
  let t     = clamp(dot(point - bStart, dirN), 0.0, len);
  let proj  = bStart + dirN * t;
  let dist  = length(point - proj);
  let nd    = dist / radius;
  return exp(-nd * nd * 2.0);
}

// ─── Ray type ─────────────────────────────────────────────────────────────────

struct Ray { origin: vec3f, dir: vec3f };

// ─── Per-beam volumetric integration ─────────────────────────────────────────

fn raymarchBeam(
  ray      : Ray,
  bStart   : vec3f,
  bEnd     : vec3f,
  bRadius  : f32,
  beamColor: vec3f,
  intensity: f32,
  lightDir : vec3f,
  phase    : f32,
) -> vec4f {
  // Cheap bounding-sphere early-out
  let bCenter = (bStart + bEnd) * 0.5;
  let bLen    = length(bEnd - bStart);
  let bBound  = bLen * 0.5 + bRadius * 2.0;
  let toC     = bCenter - ray.origin;
  let proj    = dot(toC, ray.dir);
  let distSq  = dot(toC, toC) - proj * proj;
  if (distSq > bBound * bBound) { return vec4f(0.0); }

  let entryDist = max(0.0, proj - sqrt(max(0.0, bBound * bBound - distSq)));
  let exitDist  = proj + sqrt(max(0.0, bBound * bBound - distSq));
  if (exitDist <= entryDist) { return vec4f(0.0); }

  let stepSize       = (exitDist - entryDist) / f32(volConfig.maxSteps);
  var transmittance  = 1.0;
  var scattered      = vec3f(0.0);

  for (var i = 0u; i < volConfig.maxSteps; i++) {
    let t   = entryDist + stepSize * (f32(i) + 0.5);
    let pos = ray.origin + ray.dir * t;

    let density = beamDensity(pos, bStart, bEnd, bRadius) * volConfig.density;
    if (density < 0.001) { continue; }

    var shadow = 1.0;
    if (volConfig.earthShadow != 0u) {
      shadow = earthShadow(pos, lightDir);
    }

    let scattering   = density * volConfig.intensity * shadow * phase * intensity;
    // Beer-Lambert: extinction = density + small constant to prevent zero-division
    let absorption   = density + 0.005;
    let stepTrans    = exp(-absorption * stepSize);
    scattered += beamColor * scattering * transmittance * (1.0 - stepTrans) / absorption;
    transmittance *= stepTrans;

    if (transmittance < 0.01) { break; }
  }

  return vec4f(scattered, 1.0 - transmittance);
}

// ─── Vertex shader ────────────────────────────────────────────────────────────

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0)       uv : vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
  // Full-screen triangle covering the entire viewport
  const pts = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  var out: VSOut;
  out.pos = vec4f(pts[vi], 0, 1);
  out.uv  = pts[vi] * 0.5 + 0.5;
  return out;
}

// ─── Fragment shader ──────────────────────────────────────────────────────────

// Maximum beams to ray-march per pixel (64 keeps the pass under ~1.5 ms on high-end GPUs)
const MAX_VOL_BEAMS: u32 = 64u;

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4f {
  // Reconstruct view-space ray from the camera uniform data.
  // uv is in [0,1]; ndc is in [-1,1] with Y pointing up.
  let ndcX =  in.uv.x * 2.0 - 1.0;
  let ndcY = -(in.uv.y * 2.0 - 1.0);   // flip Y for WebGPU NDC convention

  // Derive camera-forward from the orthogonal right/up pair.
  let camRight   = uni.camera_right.xyz;
  let camUp      = uni.camera_up.xyz;
  let camForward = normalize(cross(camRight, camUp));

  // Recover tan(half_fov_y) from the [1][1] element of the view-projection matrix,
  // which equals 1/tan(fov_y/2) for a standard perspective matrix.
  let tanHalfFovY = 1.0 / max(0.001, uni.view_proj[1][1]);
  let aspect      = uni.screen_size.x / max(1.0, uni.screen_size.y);
  let tanHalfFovX = tanHalfFovY * aspect;

  let rayDir = normalize(
    camForward
    + camRight * ndcX * tanHalfFovX
    + camUp    * ndcY * tanHalfFovY
  );

  let ray = Ray(uni.camera_pos.xyz, rayDir);

  // Sun direction — derive from the uniforms.
  let lightDir = normalize(uni.sun_position.xyz - uni.camera_pos.xyz);
  let cosTheta = dot(rayDir, lightDir);
  let phase    = miePhaseCS(cosTheta, volConfig.mieG) + volConfig.ambientFactor;

  // Beam palette (matches ribbon beam.ts)
  const BEAM_COLORS = array<vec3f, 3>(
    vec3f(0.45, 0.9, 1.0),   // mode 0 – CHAOS (blue-white)
    vec3f(0.15, 1.0, 0.75),  // mode 1 – GROK  (cyan-green)
    vec3f(1.0,  0.45, 0.78), // mode 2 – X     (pink)
  );

  var totalColor = vec3f(0.0);
  var totalAlpha = 0.0;

  let numStorageBeams = arrayLength(&beams);
  // Each logical beam occupies two vec4f slots: [i*2]=(start,intensity), [i*2+1]=(end,mode)
  let numBeams = min(MAX_VOL_BEAMS, numStorageBeams / 2u);

  for (var i = 0u; i < numBeams; i++) {
    let startVec = beams[i * 2u];
    let endVec   = beams[i * 2u + 1u];

    let intensity = startVec.w;
    if (intensity < 0.01) { continue; }   // inactive beam

    let mode      = u32(endVec.w) % 3u;
    let beamColor = BEAM_COLORS[mode];
    let bRadius   = volConfig.beamRadius;

    let result = raymarchBeam(
      ray,
      startVec.xyz,
      endVec.xyz,
      bRadius,
      beamColor,
      intensity,
      lightDir,
      phase,
    );

    // Additive accumulation of scattered light
    totalColor += result.rgb;
    totalAlpha  = max(totalAlpha, result.a);
  }

  // Clamp to avoid fireflies
  let finalColor = min(totalColor, vec3f(4.0));
  return vec4f(finalColor * totalAlpha, totalAlpha);
}
`;
