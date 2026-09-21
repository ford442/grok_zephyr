// Shared by orbital.wgsl (ring write) and trailExpand.wgsl (ribbon build).
// Binding numbers differ per shader, so only the struct is shared here.
struct TrailUni {
  enabled: u32,
  stride: u32,
  history_frames: u32,
  write_index: u32,
  tracked_count: u32,
  max_vertices: u32,
  max_indices: u32,
  pad0: u32,
  max_distance_km: f32,
  ribbon_width: f32,
  pad1: f32,
  pad2: f32,
}
