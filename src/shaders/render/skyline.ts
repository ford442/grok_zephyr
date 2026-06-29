/**
 * Skyline City Shader
 *
 * Instanced extruded-box buildings rendered into the same HDR target as the
 * main scene, using a separate near-tuned city view-projection (CityUni)
 * rather than the global planetary frustum. Windows are an emissive grid
 * faked procedurally per-face; no textures are sampled.
 */

import { UNIFORM_STRUCT } from '../uniforms.js';

export const SKYLINE_BUILDINGS = UNIFORM_STRUCT + /* wgsl */ `
struct Building {
  posXZ      : vec2f, // local ENU position: x = east (km), y = north (km)
  size       : vec2f, // footprint: width (east-west), depth (north-south), km
  height     : f32,   // extrusion height, km
  colorSeed  : f32,   // window tint variation seed
  windowSeed : f32,   // window on/off pattern seed
  pad        : f32,
};

struct CityUni {
  city_view_proj : mat4x4f,
  sun_dir_enu    : vec4f,
  params         : vec4f, // x = nightFactor, y = buildingCount, z = time, w = pad
};

@group(0) @binding(1) var<uniform> city : CityUni;
@group(0) @binding(2) var<storage, read> buildings : array<Building>;

struct VOut {
  @builtin(position) cp : vec4f,
  @location(0) localUV  : vec2f,
  @location(1) faceId   : f32,
  @location(2) instSeed : vec2f,
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

fn hash21(p : vec2f) -> f32 {
  let h = dot(p, vec2f(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

@vertex
fn vs(@builtin(vertex_index) vi : u32, @builtin(instance_index) ii : u32) -> VOut {
  let b = buildings[ii];
  let local = CUBE_POS[vi];
  let faceId = f32(vi / 6u);

  // East/North offset around the footprint center, Up extruded from the ground.
  let worldX = b.posXZ.x + (local.x - 0.5) * b.size.x;
  let worldY = b.posXZ.y + (local.y - 0.5) * b.size.y;
  let worldZ = local.z * b.height;

  var out : VOut;
  out.cp = city.city_view_proj * vec4f(worldX, worldY, worldZ, 1.0);

  // UVs span the perimeter (u) and height (v) for the side faces; unused for roof/floor.
  let perimeterU = select(local.x * b.size.x, local.y * b.size.y, faceId > 1.5);
  out.localUV = vec2f(perimeterU, worldZ);
  out.faceId = faceId;
  out.instSeed = vec2f(b.colorSeed, b.windowSeed);
  return out;
}

@fragment
fn fs(in : VOut) -> @location(0) vec4f {
  // Roof (4) and floor (5) faces: flat dark rooftop concrete, no windows.
  if (in.faceId > 3.5) {
    return vec4f(0.018, 0.02, 0.026, 1.0);
  }

  // Window grid: ~6m floor pitch, ~4m window pitch along the facade.
  let gridU = in.localUV.x / 4.0 + in.instSeed.x * 11.0;
  let gridV = in.localUV.y / 6.0 + in.instSeed.y * 7.0;
  let cellIdU = floor(gridU);
  let cellIdV = floor(gridV);
  let cellU = fract(gridU);
  let cellV = fract(gridV);

  let litRoll = hash21(vec2f(cellIdU, cellIdV) + in.instSeed * 13.0);
  let isLit = step(0.55, litRoll);
  let windowMask = step(0.18, cellU) * step(cellU, 0.82) * step(0.22, cellV) * step(cellV, 0.78);

  let facadeColor = vec3f(0.028, 0.032, 0.045);
  let warmWindow = vec3f(1.0, 0.74, 0.42);
  let coolWindow = vec3f(0.55, 0.78, 1.0);
  let windowTint = mix(warmWindow, coolWindow, hash21(in.instSeed + vec2f(3.1, 1.7)));

  let emissive = isLit * windowMask * city.params.x;
  let color = mix(facadeColor, windowTint * 2.4, emissive);

  return vec4f(color, 1.0);
}
`;
