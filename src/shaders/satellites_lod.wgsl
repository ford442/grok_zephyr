/**
 * Satellite LOD Point Renderer Shader
 * 
 * Implements 4-tier LOD system:
 * - Tier 0 (<500km): 4x4 MSAA sub-pixel grid
 * - Tier 1 (<2000km): 2x2 clustered points
 * - Tier 2 (<8000km): Single pixel with TAA
 * - Tier 3 (>=8000km): Impostor billboard clusters
 * 
 * Also implements anisotropic point splatting and motion blur.
 */

// Import the uniform struct (this will be concatenated)
struct Uni {
  view_proj: mat4x4f,
  camera_pos: vec4f,
  camera_right: vec4f,
  camera_up: vec4f,
  time: f32,
  delta_time: f32,
  view_mode: u32,
  is_ground_view: u32,
  frustum: array<vec4f, 6>,
  screen_size: vec2f,
  physics_mode: u32,
  pad1: u32,
};

@group(0) @binding(0) var<uniform> uni: Uni;
@group(0) @binding(1) var<storage, read> sat_pos: array<vec4f>;
@group(0) @binding(2) var<storage, read> sat_color_packed: array<u32>;
@group(0) @binding(3) var<storage, read> sat_velocity: array<vec4f>; // optional velocity buffer

// LOD configuration uniform
struct LODConfig {
  tier_distances: vec3f,  // distances for tier 0->1, 1->2, 2->3 transitions
  impostor_cluster_size: u32, // satellites per cluster in tier 3
  enable_motion_blur: u32,
  msaa_samples: u32,
};

@group(0) @binding(4) var<uniform> lodConfig: LODConfig;

struct VOut {
  @builtin(position) cp: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
  @location(2) bright: f32,
  @location(3) lod_tier: f32, // pass LOD tier to fragment for blending
  @location(4) motion_vector: vec2f, // for motion blur
  @location(5) point_size: f32,
};

// Tier distances (km)
const TIER_0_MAX: f32 = 500.0;
const TIER_1_MAX: f32 = 2000.0;
const TIER_2_MAX: f32 = 8000.0;

// ═══════════════════════════════════════════════════════════════════════════════
// COLOR & UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

fn shell_color(colorIdx: u32) -> vec3f {
  if (colorIdx == 2u) { return vec3f(0.15, 0.55, 1.0); }   // Electric cyan-blue
  if (colorIdx == 6u) { return vec3f(0.85, 0.92, 1.0); }   // Cool white
  if (colorIdx == 3u) { return vec3f(1.0, 0.78, 0.28); }   // Warm gold
  let c = colorIdx % 7u;
  if (c == 0u) { return vec3f(1.0, 0.18, 0.18); }
  if (c == 1u) { return vec3f(0.18, 1.0, 0.18); }
  if (c == 4u) { return vec3f(0.1, 1.0, 1.0); }
  if (c == 5u) { return vec3f(1.0, 0.1, 1.0); }
  return vec3f(1.0, 1.0, 1.0);
}

fn shell_pulse(colorIdx: u32, phase: f32, time: f32) -> f32 {
  if (colorIdx == 2u) { return 0.4 + 0.6 * (0.5 + 0.5 * sin(phase * 0.2 + time * 2.5)); }
  if (colorIdx == 6u) { return 0.7 + 0.3 * (0.5 + 0.5 * sin(phase * 0.1 + time * 0.6)); }
  if (colorIdx == 3u) { return 0.5 + 0.5 * (0.5 + 0.5 * sin(phase * 0.08 + time * 0.35)); }
  return 0.35 + 0.65 * (0.5 + 0.5 * sin(phase * 0.15 + time * 0.8));
}

fn unpack_sat_rgba(packed: u32) -> vec4f {
  return vec4f(
    f32((packed >> 0u) & 0xFFu) / 255.0,
    f32((packed >> 8u) & 0xFFu) / 255.0,
    f32((packed >> 16u) & 0xFFu) / 255.0,
    f32((packed >> 24u) & 0xFFu) / 255.0,
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOD TIER CALCULATION
// ═══════════════════════════════════════════════════════════════════════════════

fn calculateLODTier(distance: f32) -> vec2f {
  // Returns (tier, blend_factor)
  // tier: 0.0, 1.0, 2.0, 3.0
  // blend_factor: 0.0-1.0 for smooth transitions
  
  if (distance < lodConfig.tier_distances.x) {
    // Tier 0: smooth transition at edge
    let t = smoothstep(lodConfig.tier_distances.x * 0.8, lodConfig.tier_distances.x, distance);
    return vec2f(0.0, t);
  } else if (distance < lodConfig.tier_distances.y) {
    // Tier 1
    let t = smoothstep(lodConfig.tier_distances.y * 0.9, lodConfig.tier_distances.y, distance);
    return vec2f(1.0, t);
  } else if (distance < lodConfig.tier_distances.z) {
    // Tier 2
    let t = smoothstep(lodConfig.tier_distances.z * 0.9, lodConfig.tier_distances.z, distance);
    return vec2f(2.0, t);
  } else {
    // Tier 3 (impostor)
    return vec2f(3.0, 0.0);
  }
}

fn getPointSizeForTier(tier: f32, distance: f32) -> f32 {
  // Base size in screen pixels for each tier
  switch (u32(tier)) {
    case 0u: {
      // Tier 0: 4x4 MSAA grid = 16 sub-samples, each ~0.25 pixels
      return 4.0;
    }
    case 1u: {
      // Tier 1: 2x2 clustered = 4 pixels effective
      return 2.0;
    }
    case 2u: {
      // Tier 2: Single pixel
      return 1.0;
    }
    case 3u: {
      // Tier 3: Cluster billboard - scales with distance
      return clamp(8000.0 / distance * 4.0, 2.0, 8.0);
    }
    default: { return 1.0; }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANISOTROPIC SPLATTING
// ═══════════════════════════════════════════════════════════════════════════════

fn calculateAnisotropicScale(
  viewDir: vec3f,
  satellitePos: vec3f,
  velocity: vec3f
) -> vec2f {
  // Calculate anisotropic scaling based on view angle and motion
  
  // View angle anisotropy (elliptical when viewed at grazing angles)
  let toSatellite = normalize(satellitePos - uni.camera_pos.xyz);
  let viewAngle = abs(dot(toSatellite, uni.camera_up.xyz));
  // Stretch perpendicular to view direction at grazing angles
  let viewAniso = mix(vec2f(1.0, 1.5), vec2f(1.0, 1.0), viewAngle);
  
  // Motion anisotropy (stretch along velocity vector)
  var motionAniso = vec2f(1.0, 1.0);
  if (lodConfig.enable_motion_blur != 0u) {
    let vel = length(velocity);
    if (vel > 0.5) {
      let velDir = normalize(velocity);
      // Project velocity to screen space
      let velScreenX = dot(velDir, uni.camera_right.xyz);
      let velScreenY = dot(velDir, uni.camera_up.xyz);
      let velAngle = atan2(velScreenY, velScreenX);
      // Stretch factor based on speed
      let stretch = 1.0 + min(vel * 0.1, 2.0);
      motionAniso = vec2f(stretch, 1.0 / sqrt(stretch));
    }
  }
  
  return viewAniso * motionAniso;
}

// ═══════════════════════════════════════════════════════════════════════════════
// VELOCITY CALCULATION FOR MOTION BLUR
// ═══════════════════════════════════════════════════════════════════════════════

fn calculateMotionVector(
  currentPos: vec3f,
  velocity: vec3f
) -> vec2f {
  // Project velocity to screen space for motion blur
  let futurePos = currentPos + velocity * uni.delta_time;
  
  let currentClip = uni.view_proj * vec4f(currentPos, 1.0);
  let futureClip = uni.view_proj * vec4f(futurePos, 1.0);
  
  let currentNDC = currentClip.xy / currentClip.w;
  let futureNDC = futureClip.xy / futureClip.w;
  
  // Convert to pixel-space velocity
  let velocityNDC = futureNDC - currentNDC;
  return velocityNDC * uni.screen_size * 0.5;
}

// ═══════════════════════════════════════════════════════════════════════════════
// VERTEX SHADER
// ═══════════════════════════════════════════════════════════════════════════════

@vertex
fn vs(
  @builtin(vertex_index) vi: u32,
  @builtin(instance_index) ii: u32,
) -> VOut {
  let pd = sat_pos[ii];
  let wp = pd.xyz;
  let cdat = pd.w;
  let cam = uni.camera_pos.xyz;
  let dist = length(wp - cam);
  
  const EARTH_RADIUS_KM: f32 = 6371.0;
  
  // Visibility checks
  var visible = true;
  if (dist > 180000.0) { visible = false; }
  if (visible) {
    for (var p: u32 = 0u; p < 6u; p++) {
      let pl = uni.frustum[p];
      if (dot(pl.xyz, wp) + pl.w < -200.0) { visible = false; break; }
    }
  }
  
  // Ground view horizon check
  if (visible && uni.is_ground_view != 0u) {
    let ray_dir = wp - cam;
    let a = dot(ray_dir, ray_dir);
    let b = 2.0 * dot(cam, ray_dir);
    let c_coeff = dot(cam, cam) - EARTH_RADIUS_KM * EARTH_RADIUS_KM;
    let discriminant = b * b - 4.0 * a * c_coeff;
    if (discriminant >= 0.0) {
      let sqrt_disc = sqrt(discriminant);
      let t1 = (-b - sqrt_disc) / (2.0 * a);
      let t2 = (-b + sqrt_disc) / (2.0 * a);
      if ((t1 > 0.0 && t1 < 1.0) || (t2 > 0.0 && t2 < 1.0)) { visible = false; }
    }
  }
  
  var o: VOut;
  if (!visible) {
    o.cp = vec4f(10.0, 10.0, 10.0, 1.0);
    o.uv = vec2f(0.0);
    o.color = vec3f(0.0);
    o.bright = 0.0;
    o.lod_tier = 0.0;
    o.motion_vector = vec2f(0.0);
    o.point_size = 0.0;
    return o;
  }
  
  // Calculate LOD tier
  let lodInfo = calculateLODTier(dist);
  let lodTier = lodInfo.x;
  let lodBlend = lodInfo.y;
  
  // Get velocity (if available, otherwise zero)
  var velocity = vec3f(0.0);
  if (lodConfig.enable_motion_blur != 0u) {
    velocity = sat_velocity[ii].xyz;
  }
  
  // Calculate point size based on tier
  var pointSize = getPointSizeForTier(lodTier, dist);
  
  // Apply anisotropic scaling
  let anisoScale = calculateAnisotropicScale(normalize(cam - wp), wp, velocity);
  
  // Tier-specific quad generation
  var qv: vec2f;
  var instanceMultiplier: f32 = 1.0;
  
  switch (u32(lodTier)) {
    case 0u: {
      // Tier 0: 4x4 MSAA sub-pixel grid
      // vi ranges 0-5 for base quad, we generate 16 sub-samples
      let subSampleIdx = ii % 16u;
      let subX = f32(subSampleIdx % 4u);
      let subY = f32(subSampleIdx / 4u);
      let subOffset = (vec2f(subX, subY) - 1.5) * 0.25; // [-0.375, 0.375]
      
      const baseQuad = array<vec2f, 6>(
        vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1),
        vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1)
      );
      qv = baseQuad[vi] * 0.25 + subOffset; // Scaled to sub-pixel size
      pointSize = pointSize * 0.25;
    }
    case 1u: {
      // Tier 1: 2x2 clustered points
      const clusterQuad = array<vec2f, 6>(
        vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1),
        vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1)
      );
      qv = clusterQuad[vi] * 0.5; // 2x2 cluster
    }
    case 2u: {
      // Tier 2: Single pixel
      const singleQuad = array<vec2f, 6>(
        vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1),
        vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1)
      );
      qv = singleQuad[vi];
    }
    case 3u: {
      // Tier 3: Impostor cluster - simplified billboard
      const impostorQuad = array<vec2f, 6>(
        vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1),
        vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1)
      );
      qv = impostorQuad[vi];
      instanceMultiplier = f32(lodConfig.impostor_cluster_size);
    }
    default: {
      const defaultQuad = array<vec2f, 6>(
        vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1),
        vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1)
      );
      qv = defaultQuad[vi];
    }
  }
  
  // Apply anisotropic scaling
  qv = qv * anisoScale;
  
  // Billboard construction
  let right = uni.camera_right.xyz;
  let up = uni.camera_up.xyz;
  
  // Convert point size from pixels to world units
  let pixelToWorld = dist / uni.screen_size.y; // approximate
  let worldSize = pointSize * pixelToWorld * 100.0;
  
  let fpos = wp + (qv.x * right + qv.y * up) * worldSize;
  
  // Color calculation
  let cidx = u32(abs(cdat)) % 7u;
  var col = shell_color(cidx);
  let sat_rgba = unpack_sat_rgba(sat_color_packed[ii]);
  col = col * sat_rgba.rgb;
  
  // Pattern/pulse
  let pattern = shell_pulse(cidx, cdat * 0.15 + f32(ii) * 0.000613, uni.time);
  
  // Attenuation
  let atten = clamp(40000.0 / (dist * dist + 100.0), 0.0, 1.0);
  var bright = pattern * atten * sat_rgba.a;
  
  // Tier 3 impostor: aggregate brightness from cluster
  if (lodTier >= 2.5) {
    bright = bright * sqrt(instanceMultiplier); // sqrt for perceptual brightness
  }
  
  // Calculate motion vector
  let motionVec = calculateMotionVector(wp, velocity);
  
  o.cp = uni.view_proj * vec4f(fpos, 1.0);
  o.uv = (qv + 1.0) * 0.5;
  o.color = col;
  o.bright = bright;
  o.lod_tier = lodTier + lodBlend * 0.1; // encode tier + blend
  o.motion_vector = motionVec;
  o.point_size = pointSize;
  
  return o;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FRAGMENT SHADER
// ═══════════════════════════════════════════════════════════════════════════════

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let r = length(in.uv - 0.5) * 2.0;
  if (r > 1.0) { discard; }
  
  let lodTier = floor(in.lod_tier);
  let lodBlend = fract(in.lod_tier) * 10.0; // decode blend factor
  
  // Base PSF (Point Spread Function) based on tier
  var core: f32;
  var halo: f32;
  
  switch (u32(lodTier)) {
    case 0u: {
      // Tier 0: Sharp Gaussian for sub-pixel precision
      core = exp(-r * r * 100.0);
      halo = 0.0; // No halo at this distance
    }
    case 1u: {
      // Tier 1: Medium Gaussian
      core = exp(-r * r * 50.0);
      halo = exp(-r * r * 8.0) * 0.3;
    }
    case 2u: {
      // Tier 2: Standard PSF
      core = exp(-r * r * 78.125);
      let rh = 0.38;
      halo = 1.0 / pow(1.0 + (r / rh) * (r / rh), 2.5);
    }
    case 3u: {
      // Tier 3: Simplified for impostor
      core = exp(-r * r * 20.0);
      halo = 0.0;
    }
    default: {
      core = exp(-r * r * 78.125);
      halo = 0.0;
    }
  }
  
  // Blend PSF based on LOD transition
  let psf = mix(core + halo * 0.2, core, lodBlend);
  let alpha = psf * in.bright;
  
  // Color output
  let whiteCore = vec3f(1.0, 0.97, 0.92) * core * in.bright * 10.0;
  let colorHalo = in.color * halo * in.bright * 3.5;
  
  return vec4f(whiteCore + colorHalo, alpha);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOTION BLUR COMPUTE SHADER (optional separate pass)
// ═══════════════════════════════════════════════════════════════════════════════

#ifdef MOTION_BLUR_PASS

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var velocityTexture: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;
@group(0) @binding(3) var<uniform> motionBlurStrength: f32;

struct MotionBlurOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn motionBlurVs(@builtin(vertex_index) vi: u32) -> MotionBlurOut {
  const pts = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  var o: MotionBlurOut;
  o.pos = vec4f(pts[vi], 0, 1);
  o.uv = pts[vi] * 0.5 + 0.5;
  return o;
}

@fragment
fn motionBlurFs(in: MotionBlurOut) -> @location(0) vec4f {
  let uv = in.uv;
  
  let velocity = textureSample(velocityTexture, linearSampler, uv).rg * motionBlurStrength;
  
  // Sample along motion vector
  let samples = 8;
  var color = textureSample(sourceTexture, linearSampler, uv).rgb;
  var weight = 1.0;
  
  for (var i: i32 = 1; i <= samples; i++) {
    let t = f32(i) / f32(samples);
    let offset = velocity * t;
    
    // Bilateral sampling (weight by distance from center)
    let w = 1.0 - t;
    color += textureSample(sourceTexture, linearSampler, uv + offset).rgb * w;
    color += textureSample(sourceTexture, linearSampler, uv - offset).rgb * w;
    weight += w * 2.0;
  }
  
  color = color / weight;
  return vec4f(color, 1.0);
}

#endif // MOTION_BLUR_PASS
