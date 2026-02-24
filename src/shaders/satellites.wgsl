/**
 * Satellite Billboard Shader
 * 
 * Renders 1M+ satellites as instanced billboards with:
 * - Distance-based culling
 * - Frustum culling
 * - Color variation
 * - Animated pulsing
 */

#import "uniforms.wgsl"

@group(0) @binding(1) var<storage, read> sat_pos : array<vec4f>;

struct VOut {
  @builtin(position) cp : vec4f,
  @location(0) uv       : vec2f,
  @location(1) color    : vec3f,
  @location(2) bright   : f32,
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

  // Distance cull
  var visible = dist <= 14000.0;
  
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
    return out;
  }

  // Billboard size: closer → bigger, with caps
  let bsize = clamp(1200.0 / max(dist, 50.0), 0.4, 60.0);

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
  return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let d = length(in.uv - 0.5) * 2.0;
  if (d > 1.0) { discard; }
  
  // Ring and core contributions
  let ring = 1.0 - smoothstep(0.55, 1.0, d);
  let core = 1.0 - smoothstep(0.0, 0.22, d);
  let alpha = ring * in.bright;
  
  // HDR output: core > 1 drives bloom
  let hdr = in.color * (ring + core * 2.2) * in.bright * 2.8;
  
  return vec4f(hdr, alpha);
}
