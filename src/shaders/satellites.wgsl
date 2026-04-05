/**
 * Satellite Billboard Shader with Multi-LOD System
 * 
 * Renders 1M+ satellites as instanced billboards with:
 * - Distance-based LOD (4 tiers)
 * - Frustum culling
 * - Color variation
 * - Animated pulsing
 * - Optimized for extreme distances (Moon view)
 */

#import "uniforms.wgsl"

@group(0) @binding(1) var<storage, read> sat_pos : array<vec4f>;

// LOD Constants
const LOD_TIER_0_DIST: f32 = 500.0;     // High-res: <500km
const LOD_TIER_1_DIST: f32 = 2000.0;    // Medium: 500-2000km
const LOD_TIER_2_DIST: f32 = 8000.0;    // Low: 2000-8000km
const LOD_TIER_3_DIST: f32 = 500000.0;  // Impostor: >8000km (up to Moon distance)

const MAX_RENDER_DIST: f32 = 500000.0;  // Extended for Moon view (384,400km)

struct VOut {
  @builtin(position) cp : vec4f,
  @location(0) uv       : vec2f,
  @location(1) color    : vec3f,
  @location(2) bright   : f32,
  @location(3) lod_tier : f32,  // LOD tier for fragment shader
}

fn sat_color(idx: u32) -> vec3f {
  let c = idx % 7u;
  switch c {
    case 0u: { return vec3f(1.0, 0.18, 0.18); }  // Red
    case 1u: { return vec3f(0.18, 1.0, 0.18); }  // Green
    case 2u: { return vec3f(0.25, 0.45, 1.0); }  // Blue
    case 3u: { return vec3f(1.0, 1.0, 0.1); }    // Yellow
    case 4u: { return vec3f(0.1, 1.0, 1.0); }    // Cyan
    case 5u: { return vec3f(1.0, 0.1, 1.0); }    // Magenta
    default: { return vec3f(1.0, 1.0, 1.0); }    // White
  }
}

@vertex
fn vs(
  @builtin(vertex_index)   vi : u32,
  @builtin(instance_index) ii : u32,
) -> VOut {
  let pd = sat_pos[ii];
  let wp = pd.xyz;
  let cdat = pd.w;
  let cam = uni.camera_pos.xyz;
  let dist = length(wp - cam);

  // Distance cull - extended for Moon view
  var visible = dist <= MAX_RENDER_DIST;
  
  // Frustum cull
  if (visible) {
    for (var p = 0u; p < 6u; p++) {
      let pl = uni.frustum[p];
      if (dot(pl.xyz, wp) + pl.w < -200.0) {
        visible = false;
        break;
      }
    }
  }

  var out: VOut;
  if (!visible) {
    // Degenerate vertex for culled satellites
    out.cp = vec4f(10.0, 10.0, 10.0, 1.0);
    out.uv = vec2f(0.0);
    out.color = vec3f(0.0);
    out.bright = 0.0;
    out.lod_tier = -1.0;
    return out;
  }

  // Calculate LOD tier based on distance
  var lod_tier: f32;
  var bsize: f32;
  
  if (dist < LOD_TIER_0_DIST) {
    // LOD 0: High-res, larger billboards
    lod_tier = 0.0;
    bsize = clamp(1200.0 / max(dist, 50.0), 0.8, 80.0);
  } else if (dist < LOD_TIER_1_DIST) {
    // LOD 1: Medium detail
    lod_tier = 1.0;
    bsize = clamp(1200.0 / max(dist, 50.0), 0.5, 40.0);
  } else if (dist < LOD_TIER_2_DIST) {
    // LOD 2: Low detail, smaller billboards
    lod_tier = 2.0;
    bsize = clamp(800.0 / max(dist, 100.0), 0.3, 20.0);
  } else {
    // LOD 3: Impostor/cluster for extreme distances (Moon view)
    lod_tier = 3.0;
    // Fixed small size for distant satellites to maintain visibility
    bsize = max(2.0, 20000.0 / max(dist, 1000.0));
  }

  // Fullscreen quad vertices
  const quad = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0,  1.0), vec2f(1.0, -1.0), vec2f( 1.0, 1.0)
  );

  let qv = quad[vi];
  let right = uni.camera_right.xyz;
  let up = uni.camera_up.xyz;
  let offset = (qv.x * right + qv.y * up) * bsize;
  let fpos = wp + offset;

  // Color and animation
  let cidx = u32(abs(cdat)) % 7u;
  let col = sat_color(cidx);
  let phase = cdat * 0.15 + uni.time * (0.8 + 0.4 * fract(f32(ii) * 0.000613));
  let pattern = 0.35 + 0.65 * (0.5 + 0.5 * sin(phase));

  // Distance attenuation
  let atten = 1.0 / (1.0 + dist * 0.00075);
  let bright = pattern * atten;

  out.cp = uni.view_proj * vec4f(fpos, 1.0);
  out.uv = (qv + 1.0) * 0.5;
  out.color = col;
  out.bright = bright;
  out.lod_tier = lod_tier;
  return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let d = length(in.uv - 0.5) * 2.0;
  if (d > 1.0) { discard; }
  
  // LOD-based rendering
  var hdr: vec3f;
  var alpha: f32;
  
  if (in.lod_tier < 2.0) {
    // LOD 0 & 1: Full detail with ring and core
    let ring = 1.0 - smoothstep(0.55, 1.0, d);
    let core = 1.0 - smoothstep(0.0, 0.22, d);
    alpha = ring * in.bright;
    // HDR output: core > 1 drives bloom
    hdr = in.color * (ring + core * 2.2) * in.bright * 2.8;
  } else if (in.lod_tier < 3.0) {
    // LOD 2: Simplified, softer appearance
    let soft = 1.0 - smoothstep(0.0, 1.0, d);
    alpha = soft * in.bright;
    hdr = in.color * soft * in.bright * 2.0;
  } else {
    // LOD 3: Ultra-simplified for extreme distances (Moon view)
    // Simple soft circle, maintain visibility at distance
    let fade = 1.0 - d * d;
    alpha = fade * in.bright * 1.5;  // Boost alpha for visibility
    hdr = in.color * fade * in.bright * 3.0;  // Boost brightness
  }
  
  return vec4f(hdr, alpha);
}
