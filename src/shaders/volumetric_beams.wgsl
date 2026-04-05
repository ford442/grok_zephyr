/**
 * Volumetric Light Beams Shader
 * 
 * Ray-marched light cones from satellites with:
 * - Mie scattering integration
 * - Earth shadow occlusion
 * - Sparse ray marching (8 steps max for performance)
 */

// Volumetric parameters
const MAX_RAY_STEPS: u32 = 8u;
const STEP_DENSITY: f32 = 0.5;  // Step size as fraction of beam length

// Mie scattering parameters
const MIE_G: f32 = 0.7;           // Scattering asymmetry (0 = isotropic, 1 = forward)
const MIE_DENSITY: f32 = 0.1;     // Scattering coefficient
const ABSORPTION: f32 = 0.02;     // Absorption coefficient

// Shadow parameters
const EARTH_RADIUS_KM: f32 = 6371.0;
const SHADOW_SOFTNESS: f32 = 50.0; // km for soft shadow edge

struct VolumetricParams {
  // Ray march settings
  maxSteps: u32,
  stepSize: f32,
  density: f32,
  mieG: f32,
  
  // Light settings
  lightIntensity: f32,
  beamIntensity: f32,
  ambientScattering: f32,
  
  // Shadow
  earthShadowEnabled: u32,
  shadowSoftness: f32,
};

// ═══════════════════════════════════════════════════════════════════════════════
// MIE SCATTERING PHASE FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

// Henyey-Greenstein phase function
fn miePhaseHG(cosTheta: f32, g: f32) -> f32 {
  let g2 = g * g;
  let denom = pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5);
  return (1.0 - g2) / (4.0 * 3.14159 * denom);
}

// Cornette-Shanks improved approximation
fn miePhaseCS(cosTheta: f32, g: f32) -> f32 {
  let g2 = g * g;
  let numerator = 3.0 * (1.0 - g2) * (1.0 + cosTheta * cosTheta);
  let denominator = 2.0 * (2.0 + g2) * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5);
  return numerator / denominator;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHADOW CALCULATION
// ═══════════════════════════════════════════════════════════════════════════════

// Check if point is in Earth's shadow from light source
fn calculateEarthShadow(
  point: vec3f,
  lightDir: vec3f
) -> f32 {
  // Ray from point toward light
  let toLight = -lightDir;
  
  // Ray-sphere intersection
  let a = dot(toLight, toLight);
  let b = 2.0 * dot(point, toLight);
  let c = dot(point, point) - EARTH_RADIUS_KM * EARTH_RADIUS_KM;
  
  let discriminant = b * b - 4.0 * a * c;
  
  if (discriminant < 0.0) {
    // No intersection - fully lit
    return 1.0;
  }
  
  let sqrtDisc = sqrt(discriminant);
  let t1 = (-b - sqrtDisc) / (2.0 * a);
  let t2 = (-b + sqrtDisc) / (2.0 * a);
  
  // If both intersections are behind us, we're in light
  if (t1 < 0.0 && t2 < 0.0) {
    return 1.0;
  }
  
  // Calculate soft shadow based on distance from shadow edge
  let closestT = max(t1, 0.0);
  let distFromSurface = length(point + toLight * closestT) - EARTH_RADIUS_KM;
  
  // Soft shadow transition
  return smoothstep(-SHADOW_SOFTNESS, SHADOW_SOFTNESS, distFromSurface);
}

// ═══════════════════════════════════════════════════════════════════════════════
// BEAM DENSITY SAMPLING
// ═══════════════════════════════════════════════════════════════════════════════

// Sample beam density at a point
fn sampleBeamDensity(
  point: vec3f,
  beamStart: vec3f,
  beamEnd: vec3f,
  beamRadius: f32
) -> f32 {
  let beamDir = beamEnd - beamStart;
  let beamLen = length(beamDir);
  let beamDirN = beamDir / beamLen;
  
  // Project point onto beam line
  let toPoint = point - beamStart;
  let t = clamp(dot(toPoint, beamDirN) / beamLen, 0.0, 1.0);
  let closestPoint = beamStart + beamDirN * t * beamLen;
  
  // Distance from beam center
  let dist = length(point - closestPoint);
  
  // Gaussian falloff from beam center
  let normalizedDist = dist / beamRadius;
  return exp(-normalizedDist * normalizedDist * 2.0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// RAY MARCHING
// ═══════════════════════════════════════════════════════════════════════════════

struct Ray {
  origin: vec3f,
  dir: vec3f,
};

// Sparse ray marching through volume
fn raymarchBeam(
  ray: Ray,
  beamStart: vec3f,
  beamEnd: vec3f,
  beamRadius: f32,
  params: VolumetricParams,
  viewDir: vec3f
) -> vec4f {
  // Find intersection with beam bounding volume
  let beamDir = beamEnd - beamStart;
  let beamLen = length(beamDir);
  let beamDirN = beamDir / beamLen;
  
  // Quick bounding sphere check
  let beamCenter = (beamStart + beamEnd) * 0.5;
  let boundingRadius = beamLen * 0.5 + beamRadius * 2.0;
  
  // Ray-sphere intersection for early out
  let toCenter = beamCenter - ray.origin;
  let proj = dot(toCenter, ray.dir);
  let distSq = dot(toCenter, toCenter) - proj * proj;
  
  if (distSq > boundingRadius * boundingRadius) {
    return vec4f(0.0); // Miss bounding sphere
  }
  
  // Calculate entry and exit points
  let entryDist = proj - sqrt(max(0.0, boundingRadius * boundingRadius - distSq));
  let exitDist = proj + sqrt(max(0.0, boundingRadius * boundingRadius - distSq));
  
  let startDist = max(0.0, entryDist);
  let endDist = exitDist;
  
  // Sparse step sampling
  let stepSize = (endDist - startDist) / f32(params.maxSteps);
  var totalTransmittance = 1.0;
  var scatteredLight = vec3f(0.0);
  
  // Light direction (sun)
  let lightDir = normalize(vec3f(1.0, 0.4, 0.2));
  
  // Phase function for Mie scattering
  let cosTheta = dot(ray.dir, lightDir);
  let phase = miePhaseCS(cosTheta, params.mieG);
  
  for (var i: u32 = 0u; i < params.maxSteps; i++) {
    let t = startDist + stepSize * (f32(i) + 0.5);
    let pos = ray.origin + ray.dir * t;
    
    // Sample beam density
    let density = sampleBeamDensity(pos, beamStart, beamEnd, beamRadius) * params.density;
    
    if (density < 0.001) {
      continue; // Skip empty steps
    }
    
    // Calculate shadow
    var shadow = 1.0;
    if (params.earthShadowEnabled != 0u) {
      shadow = calculateEarthShadow(pos, lightDir);
    }
    
    // Scattering
    let scattering = density * params.lightIntensity * shadow * phase;
    let absorption = density * params.density + ABSORPTION;
    
    // Beer-Lambert law
    let transmittance = exp(-absorption * stepSize);
    
    // Integrate scattered light
    scatteredLight += scattering * totalTransmittance * (1.0 - transmittance) / absorption;
    totalTransmittance *= transmittance;
    
    // Early termination
    if (totalTransmittance < 0.01) {
      break;
    }
  }
  
  return vec4f(scatteredLight, 1.0 - totalTransmittance);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MULTI-BEAM RAY MARCHING
// ═══════════════════════════════════════════════════════════════════════════════

struct Beam {
  start: vec3f,
  end: vec3f,
  color: vec3f,
  intensity: f32,
  radius: f32,
};

// Ray march through multiple beams
fn raymarchMultipleBeams(
  ray: Ray,
  beams: ptr<function, array<Beam, 64>>,
  numBeams: u32,
  params: VolumetricParams,
  viewDir: vec3f
) -> vec4f {
  var totalColor = vec3f(0.0);
  var totalAlpha = 0.0;
  
  for (var i: u32 = 0u; i < numBeams && i < 64u; i++) {
    let beam = (*beams)[i];
    
    let result = raymarchBeam(ray, beam.start, beam.end, beam.radius, params, viewDir);
    
    // Blend beams additively
    totalColor += result.rgb * beam.color * beam.intensity;
    totalAlpha = max(totalAlpha, result.a);
  }
  
  return vec4f(totalColor, totalAlpha);
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPUTE SHADER FOR VOLUMETRIC RENDERING
// ═══════════════════════════════════════════════════════════════════════════════

struct ComputeParams {
  cameraPos: vec3f,
  cameraDir: vec3f,
  fov: f32,
  aspect: f32,
  screenSize: vec2f,
};

@group(0) @binding(0) var<uniform> computeParams: ComputeParams;
@group(0) @binding(1) var<uniform> volParams: VolumetricParams;
@group(0) @binding(2) var<storage, read> beams: array<Beam>;
@group(0) @binding(3) var<storage, read_write> outputTexture: array<vec4f>;

@compute @workgroup_size(8, 8, 1)
fn volumetricBeamCompute(@builtin(global_invocation_id) gid: vec3u) {
  let screenX = gid.x;
  let screenY = gid.y;
  
  if (f32(screenX) >= computeParams.screenSize.x || f32(screenY) >= computeParams.screenSize.y) {
    return;
  }
  
  // Calculate ray direction from screen coordinates
  let uv = (vec2f(f32(screenX), f32(screenY)) / computeParams.screenSize) * 2.0 - 1.0;
  uv.y = -uv.y; // Flip Y
  
  // Calculate view direction
  let tanFov = tan(computeParams.fov * 0.5);
  let rayDir = normalize(vec3f(
    uv.x * tanFov * computeParams.aspect,
    uv.y * tanFov,
    -1.0
  ));
  
  // Transform to world space (simplified - assumes camera looks at origin)
  // In real implementation, use camera rotation matrix
  
  let ray = Ray(computeParams.cameraPos, rayDir);
  
  // Load beams into local array
  var localBeams: array<Beam, 64>;
  let numBeams = min(arrayLength(&beams), 64u);
  for (var i: u32 = 0u; i < numBeams; i++) {
    localBeams[i] = beams[i];
  }
  
  // Ray march
  let result = raymarchMultipleBeams(ray, &localBeams, numBeams, volParams, -rayDir);
  
  // Write output
  let idx = screenY * u32(computeParams.screenSize.x) + screenX;
  outputTexture[idx] = result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FRAGMENT SHADER VARIANT (FOR FULLSCREEN QUAD)
// ═══════════════════════════════════════════════════════════════════════════════

@group(0) @binding(0) var volumetricTexture: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
  const pts = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  var out: VSOut;
  out.pos = vec4f(pts[vi], 0, 1);
  out.uv = pts[vi] * 0.5 + 0.5;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4f {
  var uv = in.uv;
  uv.y = 1.0 - uv.y;
  return textureSample(volumetricTexture, linearSampler, uv);
}
