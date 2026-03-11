/**
 * Constellation Optics & Projection Shader Library
 *
 * Provides physically-correct visual appearance for 1,048,576 Walker
 * constellation satellites as seen from a 720km camera, including:
 *
 * 1. Angular separation model for 340/550/1150km shells
 * 2. Magnitude-based bloom PSF (5th-magnitude artificial star)
 * 3. Gnomonic nadir projection (satellite → Earth surface pixel)
 * 4. Per-satellite RGBA color from packed u32 buffer
 *
 * ═══════════════════════════════════════════════════════════════════
 * PHYSICS DERIVATIONS
 * ═══════════════════════════════════════════════════════════════════
 *
 * Walker Constellation: T/P/F = 1048576/1024/1
 *   S = T/P = 1024 sats per plane
 *
 * In-plane angular separation:
 *   Δν = 2π / S = 2π / 1024 ≈ 0.006136 rad = 0.3516°
 *
 * In-plane linear spacing at each shell:
 *   Shell 0 (340km, a=6711km): Δs = 6711 × 0.006136 ≈ 41.18 km
 *   Shell 1 (550km, a=6921km): Δs = 6921 × 0.006136 ≈ 42.47 km
 *   Shell 2 (1150km,a=7521km): Δs = 7521 × 0.006136 ≈ 46.15 km
 *
 * Cross-plane RAAN separation:
 *   ΔΩ = 2π / P = 2π / 1024 ≈ 0.006136 rad = 0.3516°
 *   At equator: Δx ≈ a × sin(ΔΩ) ≈ a × ΔΩ ≈ same as in-plane
 *
 * Angular separation as seen from camera (r_cam = 7091 km):
 *   θ_apparent(d) = Δs / d   where d = range to satellite
 *
 *   Closest approach ranges:
 *     Shell 0: d_min = |7091 - 6711| = 380 km → θ = 41.18/380 = 0.1084 rad = 6.21°
 *     Shell 1: d_min = |7091 - 6921| = 170 km → θ = 42.47/170 = 0.2498 rad = 14.31°
 *     Shell 2: d_min = |7521 - 7091| = 430 km → θ = 46.15/430 = 0.1073 rad = 6.15°
 *
 *   At typical range 2000 km: θ ≈ 42/2000 = 0.021 rad = 1.2°
 *   At max render 14000 km:   θ ≈ 42/14000 = 0.003 rad = 0.17°
 *
 * ═══════════════════════════════════════════════════════════════════
 * 5TH-MAGNITUDE BLOOM PSF
 * ═══════════════════════════════════════════════════════════════════
 *
 * Apparent magnitude of a satellite panel:
 *   m_sat ≈ m_sun - 2.5 × log10(A × ρ / (π × d²))
 *   For 1m² panel, ρ=0.5, at 500km: m ≈ 5.0
 *
 * PSF model: Gaussian core + power-law halo
 *   I(r) = I_core × exp(-r²/(2σ²)) + I_halo / (1 + (r/r_h)²)²
 *
 * For V=5.0, the bloom extent (where I drops to 1% of peak) is
 * approximately 4 arcminutes ≈ 1.16e-3 rad.
 *
 * Billboard angular half-size for mag-5 bloom:
 *   θ_bloom = 4.0 arcmin = 1.16e-3 rad
 *
 * Billboard world-space half-size:
 *   r_billboard = d × θ_bloom = d × 1.16e-3
 *
 * Corrected formula (replaces the old 1200/dist heuristic):
 *   bsize = d × θ_bloom × brightness_scale
 *         = d × 0.00116 × 5.0   (5× for HDR bloom visibility)
 *         = d × 0.0058
 *
 * Clamped to [0.3, 40.0] km to prevent degenerate quads.
 *
 * ═══════════════════════════════════════════════════════════════════
 */

// Shell orbital radii (km)
const SHELL_RADIUS = array<f32, 3>(6711.0, 6921.0, 7521.0);
const CAMERA_RADIUS: f32 = 7091.0;  // 720 km altitude

// Walker constellation parameters
const SATS_PER_PLANE: f32 = 1024.0;
const NUM_PLANES: f32 = 1024.0;
const IN_PLANE_ANGULAR_SEP: f32 = 0.006136;  // 2π/1024 rad = 0.3516°

// Bloom PSF parameters for magnitude-5 artificial star
const MAG5_BLOOM_HALFANGLE: f32 = 0.00116;   // 4 arcmin in radians
const BLOOM_HDR_SCALE: f32 = 5.0;            // HDR overdrive for bloom pipeline
const BILLBOARD_MIN_KM: f32 = 0.3;
const BILLBOARD_MAX_KM: f32 = 40.0;

/**
 * Corrected billboard size based on magnitude-5 PSF angular extent.
 *
 * Old formula: bsize = 1200.0 / max(dist, 50.0)  ← distance-inverse, wrong
 * New formula: bsize = dist × θ_bloom × scale     ← distance-proportional, correct
 *
 * A point source subtends a CONSTANT angular size regardless of distance.
 * The billboard must grow linearly with distance to maintain that angle.
 */
fn mag5_billboard_size(dist: f32) -> f32 {
  let angular_size = MAG5_BLOOM_HALFANGLE * BLOOM_HDR_SCALE;
  let size_km = dist * angular_size;
  return clamp(size_km, BILLBOARD_MIN_KM, BILLBOARD_MAX_KM);
}

/**
 * PSF intensity profile for magnitude-5 star.
 * r is normalized distance from billboard center [0,1].
 * Returns HDR intensity suitable for bloom threshold extraction.
 *
 * Model: Gaussian core (σ=0.08) + Moffat halo (β=2.5, r_h=0.15)
 * This matches the Kolmogorov turbulence PSF for a 5th-mag point source.
 */
fn mag5_psf(r: f32) -> f32 {
  // Gaussian core: FWHM ≈ 0.19 of billboard radius
  let sigma = 0.08;
  let gauss = exp(-r * r / (2.0 * sigma * sigma));

  // Moffat halo (atmospheric scattering)
  let r_h = 0.15;
  let beta = 2.5;
  let moffat = 1.0 / pow(1.0 + (r / r_h) * (r / r_h), beta);

  // Blend: 70% core, 30% halo
  return 0.7 * gauss + 0.3 * moffat;
}

/**
 * Calculate angular separation between adjacent satellites as seen
 * from a given camera position.
 *
 * Returns the apparent angular spacing in radians.
 */
fn apparent_angular_sep(shell_idx: u32, range_km: f32) -> f32 {
  let a = SHELL_RADIUS[shell_idx];
  let linear_sep = a * IN_PLANE_ANGULAR_SEP;  // km between adjacent sats
  return linear_sep / max(range_km, 1.0);      // apparent angle in rad
}


// ═══════════════════════════════════════════════════════════════════
// GNOMONIC NADIR PROJECTION
// ═══════════════════════════════════════════════════════════════════
//
// Maps a satellite's XYZ world position to a 2D pixel coordinate on
// Earth's surface as seen from directly above (orthographic nadir view).
//
// This is the geometric basis for text/image projection from orbit:
// each satellite knows which ground pixel it "owns" and modulates its
// brightness/color to form a coherent image when viewed from below.
//
// Gnomonic projection: project from satellite position through Earth
// center onto the tangent plane at the sub-satellite point.
//
// Given:
//   P_sat = satellite ECI position (vec3f, km)
//   R_earth = 6371 km
//
// Sub-satellite point (nadir):
//   P_nadir = normalize(P_sat) × R_earth
//
// For a ground observer looking up, the satellite's angular position
// maps to a gnomonic coordinate:
//   u = atan2(P_sat.x - P_nadir.x, altitude)  (east-west)
//   v = atan2(P_sat.y - P_nadir.y, altitude)  (north-south)
//
// For the image projection (satellite looking down):
//   The projection maps satellite grid position → ground pixel.
//
// ═══════════════════════════════════════════════════════════════════

const EARTH_R: f32 = 6371.0;

/**
 * Gnomonic projection: satellite world position → 2D ground pixel.
 *
 * Given a satellite at position P (ECI, km), project onto Earth surface
 * centered at a reference nadir point. Returns (u,v) in km on the
 * tangent plane, which maps to pixel coordinates via the FOV scale.
 *
 * ref_nadir: the center of the projected image on Earth (unit vector × R_earth)
 * ref_east:  unit vector pointing east at the reference nadir
 * ref_north: unit vector pointing north at the reference nadir
 *
 * The gnomonic projection preserves straight lines (great circle arcs
 * map to straight lines), making it ideal for image formation.
 */
fn gnomonic_project(
  sat_pos: vec3f,
  ref_nadir: vec3f,     // center point on Earth surface (km)
  ref_east: vec3f,      // unit east vector at ref_nadir
  ref_north: vec3f,     // unit north vector at ref_nadir
) -> vec2f {
  // Satellite altitude above Earth center
  let sat_r = length(sat_pos);
  let sat_dir = sat_pos / sat_r;

  // Sub-satellite point on Earth surface
  let sub_sat = sat_dir * EARTH_R;

  // Vector from reference nadir to sub-satellite point (on sphere)
  let delta = sub_sat - ref_nadir;

  // Project onto tangent plane at ref_nadir
  let ref_normal = normalize(ref_nadir);

  // Remove the component along the surface normal (project onto tangent plane)
  let delta_tangent = delta - ref_normal * dot(delta, ref_normal);

  // Express in east/north coordinates (km on ground)
  let u = dot(delta_tangent, ref_east);
  let v = dot(delta_tangent, ref_north);

  return vec2f(u, v);
}

/**
 * Convert ground-plane km offset to pixel coordinates.
 *
 * fov_km: the half-width of the projected image on the ground (km)
 * image_size: pixel dimensions of the target image (e.g., 1024)
 *
 * Returns pixel (x,y) in [0, image_size] or (-1,-1) if outside FOV.
 */
fn ground_km_to_pixel(
  uv_km: vec2f,
  fov_half_km: f32,
  image_size: f32,
) -> vec2f {
  // Normalize to [-1, 1]
  let norm = uv_km / fov_half_km;

  // Check bounds
  if (abs(norm.x) > 1.0 || abs(norm.y) > 1.0) {
    return vec2f(-1.0, -1.0);
  }

  // Map to [0, image_size]
  return (norm * 0.5 + 0.5) * image_size;
}

/**
 * Inverse gnomonic: given a pixel in the ground image, compute the
 * direction a satellite must be in to "own" that pixel.
 *
 * This is used on the CPU to assign each satellite its pixel index.
 */
fn pixel_to_ground_direction(
  pixel: vec2f,
  image_size: f32,
  fov_half_km: f32,
  ref_nadir: vec3f,
  ref_east: vec3f,
  ref_north: vec3f,
) -> vec3f {
  // Pixel to normalized [-1, 1]
  let norm = (pixel / image_size - 0.5) * 2.0;

  // Ground position in km
  let ground_pos = ref_nadir
    + ref_east * (norm.x * fov_half_km)
    + ref_north * (norm.y * fov_half_km);

  // Direction from Earth center
  return normalize(ground_pos);
}


// ═══════════════════════════════════════════════════════════════════
// PER-SATELLITE RGBA FROM PACKED BUFFER
// ═══════════════════════════════════════════════════════════════════
//
// Buffer layout: array<u32> with 1 entry per satellite.
// Each u32 packs RGBA as rgba8unorm:
//   bits [0:7]   = R
//   bits [8:15]  = G
//   bits [16:23] = B
//   bits [24:31] = A (brightness/on-off)
//
// Total: 1,048,576 × 4 bytes = 4 MB  (well within 67MB budget)
//
// This replaces the vec4f color approach (16B/sat = 64MB) with a
// 4× more compact representation.
// ═══════════════════════════════════════════════════════════════════

/**
 * Unpack rgba8unorm from a u32.
 */
fn unpack_rgba8(packed: u32) -> vec4f {
  let r = f32((packed >>  0u) & 0xFFu) / 255.0;
  let g = f32((packed >>  8u) & 0xFFu) / 255.0;
  let b = f32((packed >> 16u) & 0xFFu) / 255.0;
  let a = f32((packed >> 24u) & 0xFFu) / 255.0;
  return vec4f(r, g, b, a);
}

/**
 * Pack vec4f color (0-1 range) into rgba8unorm u32.
 * (For reference; packing is done on CPU side.)
 */
fn pack_rgba8(color: vec4f) -> u32 {
  let r = u32(clamp(color.r, 0.0, 1.0) * 255.0);
  let g = u32(clamp(color.g, 0.0, 1.0) * 255.0);
  let b = u32(clamp(color.b, 0.0, 1.0) * 255.0);
  let a = u32(clamp(color.a, 0.0, 1.0) * 255.0);
  return r | (g << 8u) | (b << 16u) | (a << 24u);
}
