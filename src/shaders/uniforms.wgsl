/**
 * Shared Uniform Structure
 * 
 * This struct is used across all shaders for frame data.
 * Total size: 256 bytes (aligned)
 * 
 * Memory Layout:
 *   offset   0  size 64  view_proj      - View-projection matrix
 *   offset  64  size 16  camera_pos     - Camera position in ECI frame
 *   offset  80  size 16  camera_right   - Camera right vector
 *   offset  96  size 16  camera_up      - Camera up vector
 *   offset 112  size  4  time           - Real time (seconds since epoch)
 *   offset 116  size  4  delta_time     - Frame delta time (seconds)
 *   offset 120  size  4  view_flags     - Packed: bits 0-15=view_mode, bit 16=is_ground_view, bits 17-19=physics_mode
 *   offset 124  size  4  sim_time       - Scaled simulation time for physics
 *   offset 128  size 96  frustum        - 6 frustum planes (vec4f each)
 *   offset 224  size  8  screen_size    - Screen width/height in pixels
 *   offset 232  size  4  time_scale     - Time multiplier (1x, 100x, 1000x, etc.)
 *   offset 236  size  4  pad0           - Padding for alignment
 *   offset 240  size 16  sun_pos        - Sun position in ECI frame (xyz), w=lod_distance
 */
struct Uni {
  view_proj      : mat4x4f,       // offset   0  size 64
  camera_pos     : vec4f,         // offset  64  size 16
  camera_right   : vec4f,         // offset  80  size 16
  camera_up      : vec4f,         // offset  96  size 16
  time           : f32,           // offset 112  size 4
  delta_time     : f32,           // offset 116  size 4
  view_flags     : u32,           // offset 120  size 4 (packed: mode|ground|physics)
  sim_time       : f32,           // offset 124  size 4
  frustum        : array<vec4f,6>,// offset 128  size 96
  screen_size    : vec2f,         // offset 224  size 8
  time_scale     : f32,           // offset 232  size 4
  pad0           : f32,           // offset 236  size 4
  sun_pos        : vec4f,         // offset 240  size 16 (w component = lod_distance)
};                                // total  256 bytes

@group(0) @binding(0) var<uniform> uni : Uni;

/**
 * Helper functions for unpacking view_flags
 */
fn getViewMode() -> u32 {
  return uni.view_flags & 0xFFFFu;
}

fn isGroundView() -> bool {
  return ((uni.view_flags >> 16u) & 0x1u) != 0u;
}

fn getPhysicsMode() -> u32 {
  return (uni.view_flags >> 17u) & 0x7u;
}

fn getLodDistance() -> f32 {
  return uni.sun_pos.w;
}
