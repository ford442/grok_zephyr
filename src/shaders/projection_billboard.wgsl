/**
 * Projection Billboard Shader
 *
 * Renders satellites with physically-correct magnitude-5 bloom PSF
 * and per-satellite RGBA color from a packed u32 buffer.
 *
 * This shader replaces the arbitrary 1200/dist billboard sizing with
 * a correct angular-size model: a point source at ANY distance subtends
 * the same angular bloom extent, so the billboard scales LINEARLY with
 * distance (not inversely).
 */

#import "uniforms.wgsl"

// Satellite positions from compute shader (xyz + shell data in w)
@group(0) @binding(1) var<storage, read> sat_pos : array<vec4f>;

// Per-satellite RGBA color (packed u32, rgba8unorm)
// 1,048,576 × 4 bytes = 4 MB
@group(0) @binding(2) var<storage, read> sat_color_packed : array<u32>;

struct VOut {
  @builtin(position) clip_pos : vec4f,
  @location(0)       uv       : vec2f,
  @location(1)       color    : vec4f,   // RGBA from packed buffer
  @location(2)       bright   : f32,
  @location(3)       dist     : f32,
}

// ═══════════════════════════════════════════════════════════════════
// BLOOM PSF CONSTANTS
// ═══════════════════════════════════════════════════════════════════
//
// For a 5th-magnitude artificial star:
//   Visual magnitude V = 5.0
//   Apparent bloom FWHM ≈ 3-4 arcminutes (atmospheric seeing + optics)
//   Bloom half-extent (to 1% intensity) ≈ 4 arcmin = 1.16e-3 rad
//
// Billboard angular half-size = θ_bloom × HDR_scale
//   = 1.16e-3 × 5.0 = 5.8e-3 rad
//
// Billboard world size = distance × angular_size
//   At 1000km: 5.8 km
//   At 170km (closest 550km shell): 0.99 km
//   At 14000km (max render): 81.2 km → clamped to 40 km
// ═══════════════════════════════════════════════════════════════════

const MAG5_BLOOM_ANGLE: f32 = 0.00116;    // 4 arcmin in radians
const BLOOM_HDR_SCALE: f32 = 5.0;         // overdrive for HDR bloom pass
const BILLBOARD_ANGULAR_SIZE: f32 = 0.0058; // MAG5_BLOOM_ANGLE × BLOOM_HDR_SCALE
const BILLBOARD_MIN: f32 = 0.3;           // km, prevents sub-pixel quads
const BILLBOARD_MAX: f32 = 40.0;          // km, prevents overdraw at distance

// Maximum render distance (km)
const MAX_RENDER_DIST: f32 = 14000.0;
// Frustum culling margin (km)
const FRUSTUM_MARGIN: f32 = 200.0;

// Fullscreen quad (2 triangles = 6 vertices)
const QUAD = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
  vec2f(-1.0,  1.0), vec2f(1.0, -1.0), vec2f( 1.0, 1.0)
);

// ═══════════════════════════════════════════════════════════════════
// RGBA UNPACKING
// ═══════════════════════════════════════════════════════════════════

fn unpack_rgba8(packed: u32) -> vec4f {
  return vec4f(
    f32((packed >>  0u) & 0xFFu) / 255.0,
    f32((packed >>  8u) & 0xFFu) / 255.0,
    f32((packed >> 16u) & 0xFFu) / 255.0,
    f32((packed >> 24u) & 0xFFu) / 255.0
  );
}

// ═══════════════════════════════════════════════════════════════════
// CORRECTED BILLBOARD FORMULA
// ═══════════════════════════════════════════════════════════════════
//
// WHY the old formula was wrong:
//   old: bsize = 1200.0 / max(dist, 50.0)
//   This makes nearby satellites HUGE (1200/170 = 7.06 km at closest)
//   and distant ones tiny (1200/14000 = 0.086 km at max range).
//   A point source should subtend constant angular size.
//
// CORRECTED formula:
//   bsize = dist × BILLBOARD_ANGULAR_SIZE
//   = dist × 0.0058
//
// This means the billboard GROWS with distance to maintain constant
// angular extent on screen — exactly how a real PSF behaves.
//
// At 170 km:   0.99 km billboard → 0.0058 rad on screen ✓
// At 1000 km:  5.8 km billboard  → 0.0058 rad on screen ✓
// At 14000 km: 81.2 km → clamped to 40 km = 0.0029 rad (fades anyway)
// ═══════════════════════════════════════════════════════════════════

fn corrected_billboard_size(dist: f32) -> f32 {
  return clamp(dist * BILLBOARD_ANGULAR_SIZE, BILLBOARD_MIN, BILLBOARD_MAX);
}

// ═══════════════════════════════════════════════════════════════════
// VERTEX SHADER
// ═══════════════════════════════════════════════════════════════════

@vertex
fn vs(
  @builtin(vertex_index)   vi : u32,
  @builtin(instance_index) ii : u32,
) -> VOut {
  let pd = sat_pos[ii];
  let wp = pd.xyz;
  let cam = uni.camera_pos.xyz;
  let d = length(wp - cam);

  // Visibility culling
  var visible = d <= MAX_RENDER_DIST;
  if (visible) {
    for (var p = 0u; p < 6u; p++) {
      let pl = uni.frustum[p];
      if (dot(pl.xyz, wp) + pl.w < -FRUSTUM_MARGIN) {
        visible = false;
        break;
      }
    }
  }

  var out: VOut;
  if (!visible) {
    out.clip_pos = vec4f(10.0, 10.0, 10.0, 1.0);
    out.uv = vec2f(0.0);
    out.color = vec4f(0.0);
    out.bright = 0.0;
    out.dist = 0.0;
    return out;
  }

  // Read per-satellite RGBA from packed buffer
  let rgba = unpack_rgba8(sat_color_packed[ii]);

  // Corrected billboard sizing (constant angular extent)
  let bsize = corrected_billboard_size(d);

  let qv = QUAD[vi];
  let right = uni.camera_right.xyz;
  let up = uni.camera_up.xyz;
  let offset = (qv.x * right + qv.y * up) * bsize;
  let fpos = wp + offset;

  // Distance attenuation (inverse square, physically correct)
  // Normalize to reference distance of 1000 km
  let atten = 1000.0 * 1000.0 / (d * d + 1000.0);

  // Alpha channel controls on/off state for blink patterns
  let bright = rgba.a * clamp(atten, 0.0, 1.0);

  out.clip_pos = uni.view_proj * vec4f(fpos, 1.0);
  out.uv = (qv + 1.0) * 0.5;
  out.color = rgba;
  out.bright = bright;
  out.dist = d;
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// FRAGMENT SHADER — Magnitude-5 PSF Profile
// ═══════════════════════════════════════════════════════════════════
//
// PSF model: Gaussian core + Moffat halo
//   I(r) = 0.7 × exp(-r²/(2×0.08²)) + 0.3 / (1 + (r/0.15)²)^2.5
//
// This matches the Kolmogorov atmospheric turbulence PSF for a
// diffraction-limited point source at V=5.0.
// ═══════════════════════════════════════════════════════════════════

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let r = length(in.uv - 0.5) * 2.0;
  if (r > 1.0) { discard; }

  // Gaussian core (σ = 0.08 of billboard radius)
  let sigma = 0.08;
  let gauss = exp(-r * r / (2.0 * sigma * sigma));

  // Moffat halo (atmospheric scattering wings)
  let r_h = 0.15;
  let moffat = 1.0 / pow(1.0 + (r / r_h) * (r / r_h), 2.5);

  // Combined PSF intensity
  let psf = 0.7 * gauss + 0.3 * moffat;

  // Apply per-satellite color and brightness
  let hdr = in.color.rgb * psf * in.bright * 3.5;
  let alpha = psf * in.bright;

  return vec4f(hdr, alpha);
}

// ═══════════════════════════════════════════════════════════════════
// LOD VARIANT — Simplified PSF for distant satellites
// ═══════════════════════════════════════════════════════════════════

@fragment
fn fs_lod(in: VOut) -> @location(0) vec4f {
  let r = length(in.uv - 0.5) * 2.0;
  if (r > 1.0) { discard; }

  // Simple Gaussian only (skip Moffat for perf)
  let psf = exp(-r * r / 0.0128);  // σ=0.08, 2σ²=0.0128
  let hdr = in.color.rgb * psf * in.bright * 2.0;
  return vec4f(hdr, psf * in.bright);
}
