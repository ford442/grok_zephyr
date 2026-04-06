/**
 * Shared Uniform Struct for all shaders
 */

export const UNIFORM_STRUCT = /* wgsl */ `
struct Uni {
  view_proj      : mat4x4f,
  camera_pos     : vec4f,
  camera_right   : vec4f,
  camera_up      : vec4f,
  time           : f32,
  delta_time     : f32,
  view_mode      : u32,
  is_ground_view : u32,
  frustum        : array<vec4f,6>,
  screen_size    : vec2f,
  physics_mode   : u32,
  pad1           : u32,
};
@group(0) @binding(0) var<uniform> uni : Uni;
`;
