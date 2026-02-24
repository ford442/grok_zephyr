/**
 * Satellite Render Shader
 * 
 * Renders 1,048,576 satellites as RGB billboards with distance attenuation.
 * Features:
 *   - Frustum culling (degenerate vertices for invisible satellites)
 *   - Distance culling (>14,000km from camera not rendered)
 *   - Billboard sizing based on distance
 *   - Animated RGB patterns per satellite
 *   - HDR output for bloom effect
 *   - GPU-based visibility testing
 */

//==============================================================================
// Bindings
//==============================================================================

#import common

// Satellite positions from compute shader
@group(0) @binding(1) var<storage, read> sat_pos : array<vec4f>;

//==============================================================================
// Vertex Output Structure
//==============================================================================

struct VertexOutput {
  @builtin(position) clip_position : vec4f,
  @location(0)       uv            : vec2f,
  @location(1)       color         : vec3f,
  @location(2)       brightness    : f32,
  @location(3)       world_dist    : f32,
};

//==============================================================================
// Billboard Constants
//==============================================================================

// Maximum distance for rendering
const MAX_RENDER_DIST : f32 = 14000.0;

// Billboard size multipliers
const BILLBOARD_BASE_SIZE   : f32 = 1200.0;
const BILLBOARD_MIN_SIZE    : f32 = 0.4;
const BILLBOARD_MAX_SIZE    : f32 = 60.0;
const BILLBOARD_NEAR_CLAMP  : f32 = 50.0;

// Distance attenuation constants
const ATTEN_COEFFICIENT : f32 = 0.00075;

// Visibility test margin for frustum culling
const FRUSTUM_MARGIN : f32 = 200.0;

// Fullscreen triangle vertices for billboards
const QUAD_VERTS = array<vec2f, 6>(
  vec2f(-1.0, -1.0),  // 0: bottom-left
  vec2f( 1.0, -1.0),  // 1: bottom-right
  vec2f(-1.0,  1.0),  // 2: top-left
  vec2f(-1.0,  1.0),  // 3: top-left
  vec2f( 1.0, -1.0),  // 4: bottom-right
  vec2f( 1.0,  1.0)   // 5: top-right
);

//==============================================================================
// Visibility Testing
//==============================================================================

// Check if satellite is within view frustum
fn is_in_frustum(wp: vec3f) -> bool {
  return frustum_contains_point(wp, FRUSTUM_MARGIN);
}

// Check if satellite is within render distance
fn is_in_distance_range(dist: f32) -> bool {
  return dist <= MAX_RENDER_DIST;
}

// Combined visibility test
fn is_visible(wp: vec3f, dist: f32) -> bool {
  return is_in_distance_range(dist) && is_in_frustum(wp);
}

// Calculate billboard size based on distance to camera
fn calculate_billboard_size(dist: f32) -> f32 {
  // Size inversely proportional to distance, with clamps
  let size = BILLBOARD_BASE_SIZE / max(dist, BILLBOARD_NEAR_CLAMP);
  return clamp(size, BILLBOARD_MIN_SIZE, BILLBOARD_MAX_SIZE);
}

// Calculate distance attenuation for brightness
fn calculate_attenuation(dist: f32) -> f32 {
  return 1.0 / (1.0 + dist * ATTEN_COEFFICIENT);
}

// Calculate animated pattern brightness
fn calculate_pattern_brightness(instance_idx: u32, cdat: f32) -> f32 {
  // Unique phase per satellite based on instance index and color data
  let unique_phase = cdat * 0.15 + uni.time * (0.8 + 0.4 * fract(f32(instance_idx) * 0.000613));
  
  // Sinusoidal pattern with base brightness
  return 0.35 + 0.65 * (0.5 + 0.5 * sin(unique_phase));
}

//==============================================================================
// Vertex Shader
//==============================================================================

@vertex
fn vs_main(
  @builtin(vertex_index)   vi : u32,
  @builtin(instance_index) ii : u32,
) -> VertexOutput {
  // Load satellite data
  let pd = sat_pos[ii];
  let world_pos = pd.xyz;
  let cdat = pd.w;
  
  let cam_pos = uni.camera_pos.xyz;
  let dist = length(world_pos - cam_pos);
  
  var out: VertexOutput;
  
  // Visibility culling
  if (!is_visible(world_pos, dist)) {
    // Degenerate vertex - move off-screen
    out.clip_position = vec4f(10.0, 10.0, 10.0, 1.0);
    out.uv = vec2f(0.0);
    out.color = vec3f(0.0);
    out.brightness = 0.0;
    out.world_dist = 0.0;
    return out;
  }
  
  // Calculate billboard size
  let bsize = calculate_billboard_size(dist);
  
  // Get quad vertex
  let qv = QUAD_VERTS[vi];
  
  // Calculate billboard offset in world space
  let right = uni.camera_right.xyz;
  let up = uni.camera_up.xyz;
  let offset = (qv.x * right + qv.y * up) * bsize;
  
  // Final world position
  let final_world_pos = world_pos + offset;
  
  // Get color based on satellite index
  let cidx = u32(abs(cdat)) % 7u;
  let col = sat_color(cidx);
  
  // Calculate pattern brightness
  let pattern = calculate_pattern_brightness(ii, cdat);
  
  // Distance attenuation
  let atten = calculate_attenuation(dist);
  let bright = pattern * atten;
  
  // Output
  out.clip_position = uni.view_proj * vec4f(final_world_pos, 1.0);
  out.uv = (qv + 1.0) * 0.5;  // Convert from [-1,1] to [0,1]
  out.color = col;
  out.brightness = bright;
  out.world_dist = dist;
  
  return out;
}

// Alias for compatibility
@vertex
fn vs(
  @builtin(vertex_index)   vi : u32,
  @builtin(instance_index) ii : u32,
) -> VertexOutput {
  return vs_main(vi, ii);
}

//==============================================================================
// Fragment Shader
//==============================================================================

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  // Calculate distance from center of billboard
  let d = length(in.uv - 0.5) * 2.0;
  
  // Discard fragments outside the circle
  if (d > 1.0) {
    discard;
  }
  
  // Ring effect (outer glow)
  let ring = 1.0 - smoothstep_f32(0.55, 1.0, d);
  
  // Core effect (bright center)
  let core = 1.0 - smoothstep_f32(0.0, 0.22, d);
  
  // Alpha based on ring
  let alpha = ring * in.brightness;
  
  // HDR color output
  // Core brightness > 1.0 drives bloom effect
  let hdr = in.color * (ring + core * 2.2) * in.brightness * 2.8;
  
  return vec4f(hdr, alpha);
}

// Alias for compatibility
@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  return fs_main(in);
}

//==============================================================================
// LOD Variant Shaders
//==============================================================================

// Simplified fragment shader for distant satellites (fewer effects)
@fragment
fn fs_lod_simple(in: VertexOutput) -> @location(0) vec4f {
  let d = length(in.uv - 0.5) * 2.0;
  
  if (d > 1.0) {
    discard;
  }
  
  // Simplified: just a soft circle
  let alpha = (1.0 - d) * in.brightness;
  let hdr = in.color * in.brightness;
  
  return vec4f(hdr, alpha);
}
