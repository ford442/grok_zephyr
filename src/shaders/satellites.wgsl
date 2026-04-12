/**
 * Satellite Billboard Shader with Multi-LOD System
 * 
 * Renders 1M+ satellites as instanced billboards with:
 * - Distance-based LOD (4 tiers)
 * - Frustum culling
 * - Color variation
 * - Animated pulsing
 * - Optimized for extreme distances (Moon view)
 * - Eclipse shadow calculation for realistic lighting
 */

#import "uniforms.wgsl"

@group(0) @binding(1) var<storage, read> sat_pos : array<vec4f>;

// LOD Constants
const LOD_TIER_0_DIST: f32 = 500.0;     // High-res: <500km
const LOD_TIER_1_DIST: f32 = 2000.0;    // Medium: 500-2000km
const LOD_TIER_2_DIST: f32 = 8000.0;    // Low: 2000-8000km
const LOD_TIER_3_DIST: f32 = 500000.0;  // Impostor: >8000km (up to Moon distance)

const MAX_RENDER_DIST: f32 = 500000.0;  // Extended for Moon view (384,400km)

// Earth and Shadow Constants
const EARTH_RADIUS: f32 = 6371.0;       // Earth radius in km
const SUN_DISTANCE: f32 = 149597870.0;  // 1 AU in km (approximate)
const PENUMBRA_WIDTH_KM: f32 = 200.0;   // Soft shadow transition width (km)

// Sun direction from uniform buffer
// uni.sun_pos is updated each frame based on simulation time

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

/**
 * Calculate eclipse shadow factor for a satellite position.
 * 
 * Uses ray-sphere intersection to determine if the satellite is in Earth's shadow.
 * Returns 0.0 for full shadow (umbra), 1.0 for full sunlight, and smooth transition
 * for penumbra regions.
 * 
 * Algorithm:
 * 1. Ray from satellite toward sun: P(t) = satPos + t * sunDir
 * 2. Find closest approach to Earth center
 * 3. If closest approach < Earth radius, satellite is in shadow
 * 4. Smooth transition for penumbra
 */
fn calculateShadowFactor(satPos: vec3f, sunDir: vec3f) -> f32 {
  // Normalize sun direction (light comes FROM sun, so we go TOWARD sun)
  let L = normalize(sunDir);
  
  // Vector from Earth center to satellite
  let S = satPos;
  
  // Ray-sphere intersection: find closest approach to Earth center
  // Ray: P(t) = S + t * L (t >= 0 goes toward sun)
  // Closest approach at t = -dot(S, L)
  let tClosest = -dot(S, L);
  
  // If tClosest < 0, satellite is on the sun-facing side of Earth
  // But we still need to check if it's in the shadow cone
  
  // Closest point on ray to Earth center
  let closestPoint = S + L * tClosest;
  let closestDist = length(closestPoint);
  
  // Earth angular radius as seen from satellite
  // sin(alpha) = Earth_radius / |satPos|
  let satDist = length(satPos);
  let sinEarthAng = EARTH_RADIUS / satDist;
  
  // Sun angular radius as seen from satellite (very small, ~0.0046 rad)
  // This creates the penumbra region
  let sinSunAng = 696340.0 / SUN_DISTANCE; // Sun radius / distance
  
  // Shadow cone geometry:
  // Umbra: satellite is completely behind Earth (no direct sunlight)
  // Penumbra: partial shadow region
  
  // Distance from shadow axis (line from Earth center away from sun)
  let shadowAxisDist = length(S - L * dot(S, L));
  
  // Distance along shadow axis (positive = away from sun)
  let shadowAxisPos = dot(S, L);
  
  // If satellite is on sun-facing side, it's fully lit
  if (shadowAxisPos < 0.0) {
    // On sun side, check if Earth blocks any sun
    // This is the rare case of satellite being between Earth and Sun
    if (closestDist < EARTH_RADIUS) {
      // Satellite is between Earth and Sun but Earth is behind it
      // Actually, this means satellite is on Earth's day side
      return 1.0;
    }
  }
  
  // Calculate shadow cone radius at satellite distance
  // The shadow cone expands linearly from Earth's night side
  // At distance d from Earth's center along shadow axis, shadow radius is:
  // r_shadow = Earth_radius + d * tan(umbra_angle)
  // where tan(umbra_angle) ≈ (Sun_radius - Earth_radius) / Sun_distance
  
  // Simplified: use the closest approach distance to determine shadow
  
  // Distance from Earth's center to the ray
  let distToRay = closestDist;
  
  // Full shadow (umbra): ray passes through Earth
  // Partial shadow (penumbra): ray passes near Earth
  
  // Umbra radius at this distance from Earth along sun direction
  // The umbra is a cone starting at Earth's night side
  // For simplicity, we use the angular size approach
  
  // Angular separation between sun direction and Earth-satellite vector
  let earthDir = normalize(-satPos);
  let cosSep = dot(L, earthDir);
  
  // Angular radius of Earth as seen from satellite
  let earthAngRad = asin(clamp(EARTH_RADIUS / satDist, 0.0, 1.0));
  
  // Angular radius of Sun as seen from satellite
  let sunAngRad = asin(clamp(696340.0 / SUN_DISTANCE, 0.0, 1.0));
  
  // Angular separation between sun center and Earth center
  let angSep = acos(clamp(cosSep, -1.0, 1.0));
  
  // Full shadow when Earth completely covers Sun
  // angSep + sunAngRad < earthAngRad
  
  // No shadow when Earth doesn't intersect Sun disk at all
  // angSep > earthAngRad + sunAngRad
  
  let umbraEnd = earthAngRad - sunAngRad;  // Full shadow
  let penumbraEnd = earthAngRad + sunAngRad; // Shadow starts
  
  if (angSep > penumbraEnd) {
    // Outside shadow region - full sunlight
    return 1.0;
  } else if (angSep < umbraEnd) {
    // Inside umbra - full shadow
    return 0.0;
  } else {
    // In penumbra - smooth transition
    // Map [umbraEnd, penumbraEnd] to [0, 1]
    let t = (angSep - umbraEnd) / (penumbraEnd - umbraEnd);
    return smoothstep(0.0, 1.0, t);
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
  
  // Calculate eclipse shadow factor
  // When uni.sun_pos is available, use: uni.sun_pos.xyz
  // For now, use placeholder sun direction
  let sunDir = SUN_DIR_PLACEHOLDER;
  let shadowFactor = calculateShadowFactor(wp, sunDir);
  
  // Apply shadow to brightness - satellites in full shadow are invisible
  let bright = pattern * atten * shadowFactor;

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
