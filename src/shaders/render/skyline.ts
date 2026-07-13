/**
 * Skyline City Shader
 *
 * Instanced extruded-box buildings (260 instances, single draw) rendered into the
 * shared HDR target with a near-tuned CityUni view-projection. Procedural per-face
 * window grids — no textures.
 *
 * Night-city features:
 * - Per-floor variation (bright retail lower floors, dimmer upper, random dark units)
 * - Soft window masks + HDR cores clamped 2.0–2.85 for cohesive bloom halos
 * - Exponential depth fog with distant warm city bleed
 * - Street-level sodium strips + retail spill at building bases
 * - Rooftop equipment silhouettes on tallest decile (roofEquip flag)
 * - Fresnel sky-gradient glass reflection on dark facades
 * - Facade corner AO + recessed mullion depth
 */

import { UNIFORM_STRUCT } from '../uniforms.js';

export const SKYLINE_BUILDINGS =
  UNIFORM_STRUCT +
  /* wgsl */ `
struct Building {
  posXZ      : vec2f, // local ENU position: x = east (km), y = north (km)
  size       : vec2f, // footprint: width (east-west), depth (north-south), km
  height     : f32,   // extrusion height, km
  colorSeed  : f32,   // window tint variation seed
  windowSeed : f32,   // window on/off pattern seed
  roofEquip  : f32,   // 1.0 = tallest decile — rooftop HVAC silhouettes
};

struct CityUni {
  city_view_proj : mat4x4f,
  sun_dir_enu    : vec4f,
  params         : vec4f, // x = nightFactor, y = buildingCount, z = time, w = emissiveBoost
  camera_enu     : vec4f, // xyz = observer eye in local ENU (km)
};

@group(0) @binding(1) var<uniform> city : CityUni;
@group(0) @binding(2) var<storage, read> buildings : array<Building>;

struct VOut {
  @builtin(position) cp : vec4f,
  @location(0) localUV  : vec2f,
  @location(1) faceId   : f32,
  @location(2) instSeed : vec2f,
  @location(3) worldPos : vec3f,
  @location(4) bldgHeight : f32,
  @location(5) roofEquip : f32,
};

const CUBE_POS = array<vec3f, 36>(
  // -X (west)
  vec3f(0.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), vec3f(0.0, 1.0, 1.0),
  vec3f(0.0, 0.0, 0.0), vec3f(0.0, 1.0, 1.0), vec3f(0.0, 0.0, 1.0),
  // +X (east)
  vec3f(1.0, 0.0, 0.0), vec3f(1.0, 0.0, 1.0), vec3f(1.0, 1.0, 1.0),
  vec3f(1.0, 0.0, 0.0), vec3f(1.0, 1.0, 1.0), vec3f(1.0, 1.0, 0.0),
  // -Y (south)
  vec3f(0.0, 0.0, 0.0), vec3f(1.0, 0.0, 0.0), vec3f(1.0, 0.0, 1.0),
  vec3f(0.0, 0.0, 0.0), vec3f(1.0, 0.0, 1.0), vec3f(0.0, 0.0, 1.0),
  // +Y (north)
  vec3f(0.0, 1.0, 0.0), vec3f(0.0, 1.0, 1.0), vec3f(1.0, 1.0, 1.0),
  vec3f(0.0, 1.0, 0.0), vec3f(1.0, 1.0, 1.0), vec3f(1.0, 1.0, 0.0),
  // -Z (bottom)
  vec3f(0.0, 0.0, 0.0), vec3f(1.0, 1.0, 0.0), vec3f(0.0, 1.0, 0.0),
  vec3f(0.0, 0.0, 0.0), vec3f(1.0, 0.0, 0.0), vec3f(1.0, 1.0, 0.0),
  // +Z (roof)
  vec3f(0.0, 0.0, 1.0), vec3f(0.0, 1.0, 1.0), vec3f(1.0, 1.0, 1.0),
  vec3f(0.0, 0.0, 1.0), vec3f(1.0, 1.0, 1.0), vec3f(1.0, 0.0, 1.0)
);

const FLOOR_PITCH_KM : f32 = 0.006;  // 6 m floor-to-floor
const WINDOW_PITCH_KM : f32 = 0.004; // 4 m window spacing along facade

fn hash21(p : vec2f) -> f32 {
  let h = dot(p, vec2f(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

fn faceNormal(faceId : f32) -> vec3f {
  switch i32(faceId) {
    case 0: { return vec3f(-1.0, 0.0, 0.0); }
    case 1: { return vec3f( 1.0, 0.0, 0.0); }
    case 2: { return vec3f( 0.0,-1.0, 0.0); }
    case 3: { return vec3f( 0.0, 1.0, 0.0); }
    default: { return vec3f(0.0, 0.0, 1.0); }
  }
}

fn applyCityFog(color : vec3f, distKm : f32, streetGlow : f32) -> vec3f {
  let fog = exp(-distKm * 1.55);
  // Cool night haze + distant warm city glow bleeding into the fog.
  let fogColor = mix(vec3f(0.010, 0.016, 0.030), vec3f(0.04, 0.028, 0.018), streetGlow * 0.35);
  return mix(fogColor, color, clamp(fog, 0.0, 1.0));
}

fn softWindowMask(cellU : f32, cellV : f32) -> f32 {
  let u = smoothstep(0.14, 0.20, cellU) * smoothstep(0.86, 0.80, cellU);
  let v = smoothstep(0.18, 0.24, cellV) * smoothstep(0.82, 0.76, cellV);
  return u * v;
}

fn facadeCornerAO(cellU : f32, cellV : f32) -> f32 {
  let edgeU = min(cellU, 1.0 - cellU);
  let edgeV = min(cellV, 1.0 - cellV);
  return mix(0.72, 1.0, smoothstep(0.0, 0.12, min(edgeU, edgeV) * 4.0));
}

@vertex
fn vs(@builtin(vertex_index) vi : u32, @builtin(instance_index) ii : u32) -> VOut {
  let b = buildings[ii];
  let local = CUBE_POS[vi];
  let faceId = f32(vi / 6u);

  let worldX = b.posXZ.x + (local.x - 0.5) * b.size.x;
  let worldY = b.posXZ.y + (local.y - 0.5) * b.size.y;
  let worldZ = local.z * b.height;

  var out : VOut;
  out.cp = city.city_view_proj * vec4f(worldX, worldY, worldZ, 1.0);

  let perimeterU = select(local.x * b.size.x, local.y * b.size.y, faceId > 1.5);
  out.localUV = vec2f(perimeterU, worldZ);
  out.faceId = faceId;
  out.instSeed = vec2f(b.colorSeed, b.windowSeed);
  out.worldPos = vec3f(worldX, worldY, worldZ);
  out.bldgHeight = b.height;
  out.roofEquip = b.roofEquip;
  return out;
}

@fragment
fn fs(in : VOut) -> @location(0) vec4f {
  let cam = city.camera_enu.xyz;
  let distKm = length(in.worldPos - cam);
  let night = city.params.x;
  let windowBoost = max(city.params.w, 0.5);
  let viewDir = normalize(cam - in.worldPos);
  let N = faceNormal(in.faceId);
  let fresnel = pow(1.0 - max(dot(normalize(viewDir), N), 0.0), 2.4);

  // Bottom face: dark foundation, no windows.
  if (in.faceId > 3.5 && in.faceId < 4.5) {
    return vec4f(applyCityFog(vec3f(0.008, 0.010, 0.014), distKm, 0.0), 1.0);
  }

  // Roof face: concrete + optional HVAC silhouettes on tallest buildings.
  if (in.faceId > 4.5) {
    var roof = vec3f(0.014, 0.017, 0.022);
    if (in.roofEquip > 0.5) {
      let equipU = in.localUV.x / 0.010;
      let equipV = in.localUV.y / 0.010;
      let cell = floor(vec2f(equipU, equipV));
      let equipHash = hash21(cell + in.instSeed * 5.3);
      let boxMask = step(0.62, equipHash) * step(0.15, fract(equipU)) * step(fract(equipU), 0.85)
                  * step(0.15, fract(equipV)) * step(fract(equipV), 0.85);
      roof = mix(roof, vec3f(0.006, 0.008, 0.012), boxMask * 0.9);
      let rail = smoothstep(0.92, 0.98, fract(equipV)) * 0.04;
      roof += vec3f(0.02, 0.025, 0.03) * rail;
    }
    return vec4f(applyCityFog(roof, distKm, 0.0), 1.0);
  }

  // ── Facade faces ────────────────────────────────────────────────────────
  let heightNorm = clamp(in.localUV.y / max(in.bldgHeight, 0.001), 0.0, 1.0);

  let gridU = in.localUV.x / WINDOW_PITCH_KM + in.instSeed.x * 11.0;
  let gridV = in.localUV.y / FLOOR_PITCH_KM + in.instSeed.y * 7.0;
  let cellIdU = floor(gridU);
  let cellIdV = floor(gridV);
  let cellU = fract(gridU);
  let cellV = fract(gridV);

  let litRoll = hash21(vec2f(cellIdU, cellIdV) + in.instSeed * 13.0);
  // Brighter lower floors (retail), dimmer penthouses; random dark units.
  let floorBright = mix(1.45, 0.48, pow(heightNorm, 0.85));
  let isLit = step(0.38, litRoll);
  let isDark = step(litRoll, 0.07);
  // Slow, TAA-friendly occupancy flicker — living city without per-pixel soup.
  let flicker = 0.88 + 0.12 * sin(city.params.z * 0.55 + litRoll * 47.0 + cellIdU * 0.3);
  let windowLit = isLit * (1.0 - isDark) * flicker;

  let windowMask = softWindowMask(cellU, cellV);
  let cornerAO = facadeCornerAO(cellU, cellV);

  // Per-building facade tint so blocks don't read as identical gray slabs.
  let bldgHue = hash21(in.instSeed * 2.7);
  var facadeColor = mix(
    vec3f(0.020, 0.026, 0.040),
    vec3f(0.028, 0.032, 0.048),
    bldgHue,
  );
  let skyLow = vec3f(0.018, 0.024, 0.042);
  let skyHigh = vec3f(0.05, 0.08, 0.14);
  let skyGrad = mix(skyLow, skyHigh, clamp(viewDir.z * 0.5 + 0.5, 0.0, 1.0));
  facadeColor = mix(facadeColor, skyGrad, fresnel * 0.62 * night);
  facadeColor *= cornerAO;

  let warmWindow = vec3f(1.0, 0.76, 0.44);
  let coolWindow = vec3f(0.58, 0.80, 1.0);
  let retailWarm = vec3f(1.0, 0.82, 0.52);
  let windowTint = mix(
    mix(warmWindow, coolWindow, hash21(in.instSeed + vec2f(3.1, 1.7))),
    retailWarm,
    (1.0 - heightNorm) * 0.65,
  );

  // HDR window cores (2.0–2.8) — soft masks keep bloom cohesive, not per-pixel soup.
  let hdrCore = clamp((2.05 + floorBright * 1.15) * windowBoost * night, 2.0, 2.85);
  let windowColor = windowTint * hdrCore;

  // Recessed pane depth — darker mullion inset so units read as 3D.
  let recessShade = mix(0.58, 1.0, windowMask);

  var color = mix(facadeColor, windowColor * recessShade, windowLit * windowMask);

  // Soft spill halo around lit panes — widens bloom footprint without raising core HDR.
  let spill = windowLit * windowMask * 0.14 * night;
  color += windowTint * spill * smoothstep(0.0, 0.35, heightNorm);

  // Cheap inter-window ambient bounce on the dark glass between lit units.
  color += windowTint * windowLit * windowMask * 0.05 * night;

  // Street-level sodium light strips along the building base.
  let streetBand = smoothstep(0.018, 0.004, in.localUV.y);
  let sodium = vec3f(1.0, 0.70, 0.30) * streetBand * 2.4 * night;
  color += sodium * (1.0 - windowMask * 0.45);

  // Retail spill — warm glow bleeding up from the first two floors.
  let retailSpill = smoothstep(0.032, 0.0, in.localUV.y) * (1.0 - heightNorm);
  color += vec3f(1.0, 0.78, 0.42) * retailSpill * 0.42 * night * windowBoost;

  // Mullion lines between floors for depth.
  let mullionH = smoothstep(0.025, 0.0, abs(cellV - 0.5) - 0.36);
  let mullionV = smoothstep(0.025, 0.0, abs(cellU - 0.5) - 0.34);
  color *= 1.0 - (mullionH + mullionV) * 0.26;

  let streetGlow = smoothstep(0.04, 0.0, in.localUV.y) * (1.0 - heightNorm);
  color = applyCityFog(color, distKm, streetGlow);
  return vec4f(color, 1.0);
}
`;
