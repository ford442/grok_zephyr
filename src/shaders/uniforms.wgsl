/**
 * Shared Uniform Structure
 * 
 * This struct is used across all shaders for frame data.
 * Total size: 256 bytes (aligned)
 */
struct Uni {
  view_proj      : mat4x4f,       // offset   0  size 64
  camera_pos     : vec4f,         // offset  64  size 16
  camera_right   : vec4f,         // offset  80  size 16
  camera_up      : vec4f,         // offset  96  size 16
  time           : f32,           // offset 112  size 4
  delta_time     : f32,           // offset 116  size 4
  view_mode      : u32,           // offset 120  size 4
  is_ground_view : u32,           // offset 124  size 4
  frustum        : array<vec4f,6>,// offset 128  size 96
  screen_size    : vec2f,         // offset 224  size 8
  pad1           : vec2f,         // offset 232  size 8
};                                // total  240 → buffer 256

@group(0) @binding(0) var<uniform> uni : Uni;
