// Cinematic Starfield Background Shader
//
// Features:
//  - Camera-direction-based sky ray reconstruction so stars and the Milky Way
//    rotate correctly with camera orientation (no more screen-space tiling).
//  - Magnitude-based brightness (Pogson's law) with realistic stellar density.
//  - Full O/B/A/F/G/K/M spectral-type color temperature via blackbody curve.
//  - Procedural Milky Way band keyed on galactic coordinates of the view ray.
//  - Subtle TAA-friendly twinkling driven by uni.time + per-star hash offset.
//  - HDR output values (no clamp to 1) so bright stars drive bloom correctly.
#import "uniforms.wgsl"
#import "starsCommon.wgsl"

struct VSOut { @builtin(position) pos:vec4f, @location(0) uv:vec2f };

@vertex fn vs(@builtin(vertex_index) vi:u32) -> VSOut {
  const pts = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
  var o:VSOut;
  o.pos = vec4f(pts[vi],0,1);
  o.uv  = pts[vi]*0.5 + 0.5;
  return o;
}

// ── Hash / noise ─────────────────────────────────────────────────────────────

fn hash2(p:vec2f)->f32 {
  return fract(sin(dot(p,vec2f(127.1,311.7)))*43758.5453);
}

fn hash3d(p:vec3f)->f32 {
  return fract(sin(dot(p,vec3f(127.1,311.7,74.7)))*43758.5453);
}

fn noise3d(p:vec3f)->f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3d(i+vec3f(0,0,0)), hash3d(i+vec3f(1,0,0)), u.x),
        mix(hash3d(i+vec3f(0,1,0)), hash3d(i+vec3f(1,1,0)), u.x), u.y),
    mix(mix(hash3d(i+vec3f(0,0,1)), hash3d(i+vec3f(1,0,1)), u.x),
        mix(hash3d(i+vec3f(0,1,1)), hash3d(i+vec3f(1,1,1)), u.x), u.y),
    u.z
  );
}

fn fbm(p:vec3f)->f32 {
  var v = 0.0; var amp = 0.5; var freq = 1.0; var mx = 0.0;
  for (var i=0; i<4; i++) {
    v  += amp * noise3d(p * freq);
    mx += amp;
    amp  *= 0.5;
    freq *= 2.0;
  }
  return v / mx;
}

// ── Camera-space sky direction ────────────────────────────────────────────────
//
// Reconstructs the world-space ray for a fullscreen-triangle pixel using the
// camera right/up vectors supplied in the uniform buffer.
//
// Derivation: in mat4lookAt, r = cross(f, up_world) and u = cross(r, f), so
// cross(u, r) = cross(r, cross(r, f)) = r*(r.f) - f*(r.r) = -f, therefore
// f = -cross(u,r) = cross(up, right).  Verified for the right-handed lookAt.
//
// The NDC x/y are left unscaled (no FOV division) which is fine: normalize()
// produces the correct angular direction and stars are anchored in sky space.

fn skyDir(uv:vec2f) -> vec3f {
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let right   = uni.camera_right.xyz;
  let up      = uni.camera_up.xyz;
  let forward = normalize(cross(up, right));
  return normalize(forward + ndc.x * right + ndc.y * up);
}

// ── Milky Way ─────────────────────────────────────────────────────────────────
//
// Takes the world-space view ray (not screen UV) so the band rotates correctly
// with camera orientation.  Galactic pole and center vectors are ICRS J2000.

fn renderMilkyWay(dir:vec3f) -> vec3f {
  let galNorth  = normalize(vec3f(-0.0548,  0.4941, 0.8677));
  let galCenter = normalize(vec3f(-0.0558, -0.8744, 0.4821));

  let galLat = asin(clamp(dot(dir, galNorth), -1.0, 1.0));
  let proj   = normalize(dir - galNorth * dot(dir, galNorth) + vec3f(0.0001));
  let galLon = atan2(dot(proj, cross(galNorth, galCenter)),
                     dot(proj, galCenter));

  // Gaussian vertical profile (σ ≈ 8.6°) + radial intensity toward the centre
  let vertProfile   = exp(-galLat * galLat / (2.0 * 0.15 * 0.15));
  let r             = length(vec2f(cos(galLon) - 0.1, sin(galLon)));
  let radialProfile = 0.3 * exp(-r * 3.0) + 0.7 * exp(-r * 0.8);

  // Procedural dust-lane detail
  let noiseCoord = dir * 8.0 + vec3f(100.0);
  let detail     = fbm(noiseCoord) * 0.4 + 0.6;

  let bandColor = mix(vec3f(0.9, 0.85, 0.7), vec3f(0.75, 0.8, 1.0), clamp(r, 0.0, 1.0));
  let intensity = vertProfile * radialProfile * detail * 0.18;
  return bandColor * intensity;
}

// ── Horizon atmospheric glow ──────────────────────────────────────────────────

fn horizonFog(uv:vec2f, mode:u32) -> vec3f {
  let glow         = pow(max(0.0, 0.38 - uv.y), 2.8);
  let horizonColor = vec3f(0.26, 0.16, 0.08);
  let warm         = vec3f(0.20, 0.12, 0.06);
  let cold         = vec3f(0.07, 0.09, 0.16);
  let horizonScale = select(0.0, 0.42, mode == 1u) + select(0.0, 0.88, mode == 2u);
  let glowLayer    = horizonColor * glow * horizonScale;
  let scatter      = mix(cold, warm, smoothstep(0.55, 0.90, uv.y));
  let scatterStr   = pow(clamp(1.0 - uv.y * 1.2, 0.0, 1.0), 2.6)
                     * select(0.18, 0.32, mode == 1u)
                     + select(0.0, 0.22, mode == 2u);
  return scatter * scatterStr + glowLayer;
}

// ── Star layer (sky-space tiling) ─────────────────────────────────────────────
//
// Stars are keyed on spherical (elevation, azimuth) coordinates of the view
// ray, so they remain fixed on the celestial sphere regardless of camera yaw/
// pitch/roll.  cellsPerRad controls angular density.
//
// Brightness follows Pogson's law: E = 2.512^(-mag).
// Twinkling amplitude is kept ≤ 8 % per layer so it stays TAA-friendly.

fn starLayer(dir:vec3f, cellsPerRad:f32, density:f32, twinklePower:f32) -> vec3f {
  let phi   = asin(clamp(dir.y, -1.0, 1.0));         // elevation  [-PI/2, PI/2]
  let theta = atan2(dir.z, dir.x);                    // azimuth    [-PI,   PI  ]
  let cell  = floor(vec2f(theta, phi) * cellsPerRad);

  let a = hash2(cell);
  let b = hash2(cell + vec2f(1.0, 0.0));
  let c = hash2(cell + vec2f(0.0, 1.0));

  // Magnitude 0.5–7.0 distribution weighted toward faint end (more dim stars)
  let mag  = mix(0.5, 7.0, pow(a, 0.55));
  let prob = pow(2.512, -mag) * density;
  let starMask = f32(b < prob);

  // HDR luminance: cap so only the brightest stars pierce bloom threshold 1.5;
  // satellite cores (boosted ~3.5+) remain the dominant bloom drivers.
  let hdrLum = starHdrLuminance(mag);

  // Spectral type temperature: O (30 000 K) through M (3 000 K)
  // Weight distribution realistically toward cooler K/M types
  let temperature = mix(3000.0, 30000.0, pow(a, 3.0));
  let color       = blackbodyColor(temperature);

  // TAA-friendly twinkling: slow frequencies, small amplitude (≤ 8 %)
  let twinkle = 1.0
    + twinklePower * 0.08 * sin(uni.time * (0.4 + b * 1.2) + a * 19.0)
    + twinklePower * 0.04 * sin(uni.time * (1.1 + c * 1.8) + b * 23.0);

  return color * hdrLum * starMask * twinkle;
}

// ── Fragment entry point ──────────────────────────────────────────────────────

@fragment fn fs(in:VSOut) -> @location(0) vec4f {
  // World-space sky direction for this pixel
  let dir = skyDir(in.uv);

  // Deep-space background gradient (very dark blue-black)
  var sky = mix(vec3f(0.0, 0.005, 0.015), vec3f(0.01, 0.02, 0.05),
                pow(clamp(in.uv.y, 0.0, 1.0), 1.7));

  // ── Stars: four layers spanning magnitudes 0–7 ──────────────────────────
  // cellsPerRad values: 1 rad ≈ 57° → scale sets angular star density
  //   ~480 cells/rad ≈ 0.12° per cell  (bright/sparse)
  //   ~960 cells/rad ≈ 0.06° per cell  (medium)
  //   ~1920 cells/rad ≈ 0.03° per cell (faint/dense)
  var stars = vec3f(0.0);
  stars += starLayer(dir,  240.0, 0.06, 1.0);   // sparse, bright  (high HDR lum)
  stars += starLayer(dir,  480.0, 0.20, 0.9);   // medium density
  stars += starLayer(dir,  960.0, 0.40, 0.6);   // dense, dimmer
  stars += starLayer(dir, 1920.0, 0.55, 0.3);   // very dense faint background

  // Milky Way — visible but capped so it does not flood the bloom buffer
  let milkyWay = renderMilkyWay(dir) * 1.45;
  let mwLum = dot(milkyWay, vec3f(0.2126, 0.7152, 0.0722));
  stars += milkyWay * min(1.0, 1.25 / max(mwLum, 0.01));

  // ── Atmospheric horizon glow ─────────────────────────────────────────────
  let atmosphere = horizonFog(in.uv, uni.background_mode);

  // Ground view: attenuate star HDR so Earth overlay is not washed out
  let isGroundView = ((uni.view_mode >> 16u) & 1u) == 1u;
  let isGroundBg = uni.background_mode == 2u;
  let groundStarScale = select(1.0, 0.62, isGroundView || isGroundBg);
  stars *= groundStarScale;

  // Moon View: soft blue-marble disk glow + star dimming near Earth for dynamic range.
  let isMoonView = (uni.view_mode & 0xFFFFu) == 4u;
  if (isMoonView) {
    let toEarth = normalize(-uni.camera_pos.xyz);
    let cosEarth = dot(dir, toEarth);
    let earthDiskGlow = smoothstep(cos(EARTH_ANG_RAD * 1.6), cos(EARTH_ANG_RAD * 0.75), cosEarth);
    sky += vec3f(0.10, 0.20, 0.40) * earthDiskGlow * 1.55;
    let earthDiskCos = cos(EARTH_ANG_RAD * 1.12);
    let earthMask = smoothstep(earthDiskCos, 0.99998, cosEarth);
    stars *= mix(1.0, 0.22, earthMask);
  }

  // ── Compose – HDR output; bright stars bloom, bulk stays sub-threshold ─────
  let modeBoost = select(0.88, select(1.02, 1.05, uni.background_mode == 1u),
                         uni.background_mode == 2u);
  var color = sky + stars * 1.02 + atmosphere;
  color *= modeBoost;

  if (atmosphereSettings.scatteringEnabled != 0u) {
    let upDir = normalize(uni.camera_pos.xyz);
    let cosViewZenith = clamp(dot(dir, upDir), -1.0, 1.0);
    let cosSunZenith = clamp(dot(normalize(uni.sun_position.xyz), upDir), -1.0, 1.0);
    let lutUV = vec2f(cosViewZenith * 0.5 + 0.5, cosSunZenith * 0.5 + 0.5);
    let od = textureSample(atmosphereLUT, atmosphereSampler, lutUV).rg;
    let transmittance = exp(-(RAYLEIGH_COEFF * od.r + MIE_COEFF * od.g));
    let sunOD = textureSample(atmosphereLUT, atmosphereSampler, vec2f(1.0, cosSunZenith * 0.5 + 0.5)).rg;
    let sunTint = exp(-(RAYLEIGH_COEFF * sunOD.r + MIE_COEFF * sunOD.g));
    let horizon = smoothstep(0.35, -0.15, cosViewZenith);
    let extinction = mix(vec3f(1.0), transmittance, clamp(atmosphereSettings.hazeStrength * horizon, 0.0, 1.0));
    let redden = mix(vec3f(1.0), sunTint, clamp(horizon * 0.8, 0.0, 0.8));
    color *= extinction * redden;
  }

  // Soft gamma lift (keeps very dark regions slightly luminous)
  color = pow(max(color, vec3f(0.0)), vec3f(0.96, 0.97, 0.99));

  // Return HDR (values > 1 are intentional; brightest stars only)
  return vec4f(color, 1.0);
}

// ── Catalog background (?sky=hip) ─────────────────────────────────────────────
//
// Same art as `fs`, minus the stars the Hipparcos points now draw. Differences:
//  - The view ray comes from the real projection (frag coord + view_proj), not
//    the FOV-less `skyDir`, so the Milky Way registers with catalog stars.
//  - The Milky Way is evaluated on the ICRS ray, re-oriented to the real
//    galactic plane (ICRS_TO_LEGACY_GALACTIC).
//  - Hash stars brighter than the catalog limit are dropped.
// `fs` is left untouched so `?sky=proc` (the default) renders the same pixels.

// `renderMilkyWay`'s pole/centre constants are not the ICRS galactic pole and
// centre (the art band is free-floating). This rotation takes a true ICRS ray
// into the frame those constants assume, so under ?sky=hip the band runs
// through Cygnus, Crux and Sagittarius. Column-major; mirrored and tested as
// ICRS_TO_LEGACY_GALACTIC in src/render/SkyCatalog.ts.
const ICRS_TO_LEGACY_GALACTIC = mat3x3f(
  vec3f(0.543221, -0.391880, -0.742523),
  vec3f(-0.383350, 0.671051, -0.634613),
  vec3f(0.746963, 0.629381, 0.214301),
);

// Magnitude `starLayer` assigns to the cell containing `dir` (same hash).
fn starLayerMag(dir:vec3f, cellsPerRad:f32) -> f32 {
  let phi   = asin(clamp(dir.y, -1.0, 1.0));
  let theta = atan2(dir.z, dir.x);
  let cell  = floor(vec2f(theta, phi) * cellsPerRad);
  return mix(0.5, 7.0, pow(hash2(cell), 0.55));
}

fn faintStarLayer(dir:vec3f, cellsPerRad:f32, density:f32, twinklePower:f32, minMag:f32) -> vec3f {
  return starLayer(dir, cellsPerRad, density, twinklePower) * f32(starLayerMag(dir, cellsPerRad) > minMag);
}

// World ray through a framebuffer pixel. `view_proj` rows 0/1/3 are P·V rows;
// for d = f + a·r + b·u, clip.w = f·d = 1, so NDC is linear in (a, b). This
// also covers off-axis (XR) projections, unlike a single tan(fov/2).
fn projectedSkyDir(fragCoord:vec2f) -> vec3f {
  let ndc = vec2f(fragCoord.x / uni.screen_size.x * 2.0 - 1.0,
                  1.0 - fragCoord.y / uni.screen_size.y * 2.0);
  let vp = uni.view_proj;
  let row0 = vec3f(vp[0][0], vp[1][0], vp[2][0]);
  let row1 = vec3f(vp[0][1], vp[1][1], vp[2][1]);
  let right   = uni.camera_right.xyz;
  let up      = uni.camera_up.xyz;
  let forward = normalize(cross(up, right));
  let a = (ndc.x - dot(row0, forward)) / dot(row0, right);
  let b = (ndc.y - dot(row1, forward)) / dot(row1, up);
  return normalize(forward + a * right + b * up);
}

@fragment fn fs_catalog(in:VSOut) -> @location(0) vec4f {
  let dir = projectedSkyDir(in.pos.xy);
  let magLimit = skyCatalog.frame_x.w;

  var sky = mix(vec3f(0.0, 0.005, 0.015), vec3f(0.01, 0.02, 0.05),
                pow(clamp(in.uv.y, 0.0, 1.0), 1.7));

  // Only the two dense layers reach past V 6.5 often enough to matter.
  var stars = vec3f(0.0);
  stars += faintStarLayer(dir,  960.0, 0.40, 0.6, magLimit);
  stars += faintStarLayer(dir, 1920.0, 0.55, 0.3, magLimit);

  let milkyWay = renderMilkyWay(ICRS_TO_LEGACY_GALACTIC * renderToCatalog(dir)) * 1.45;
  let mwLum = dot(milkyWay, vec3f(0.2126, 0.7152, 0.0722));
  stars += milkyWay * min(1.0, 1.25 / max(mwLum, 0.01));

  let atmosphere = horizonFog(in.uv, uni.background_mode);
  stars *= catalogStarScale(dir);

  if ((uni.view_mode & 0xFFFFu) == 4u) {
    let cosEarth = dot(dir, normalize(-uni.camera_pos.xyz));
    let earthDiskGlow = smoothstep(cos(EARTH_ANG_RAD * 1.6), cos(EARTH_ANG_RAD * 0.75), cosEarth);
    sky += vec3f(0.10, 0.20, 0.40) * earthDiskGlow * 1.55;
  }

  var color = (sky + stars * 1.02 + atmosphere) * skyModeBoost();
  color *= skyExtinction(dir);
  color = pow(max(color, vec3f(0.0)), vec3f(0.96, 0.97, 0.99));
  return vec4f(color, 1.0);
}
