/**
 * Grok Zephyr - WebGL2 (GLSL ES 3.00) shader sources for the fallback renderer.
 *
 * These mirror the canonical WGSL in src/shaders/render/ and compute/ (TypeScript
 * template exports) but in a
 * simplified, single-author form suited to visual debugging and CI capture.
 *
 * Propagation note: the satellite vertex shader performs the *simple-mode*
 * Keplerian propagation that SHADERS.compute.orbital does on the GPU compute pass —
 * i.e. the "simplified compute fallback". Orbital elements arrive as a per-
 * instance attribute (raan, inclination, meanAnomaly0, shellData) and positions
 * are derived entirely on the GPU, so the full 1,048,576-satellite set renders
 * without any per-frame CPU work. Keep the math here in lock-step with
 * OrbitalElements.calculatePosition() in src/core/OrbitalElements.ts.
 */

/** Shared GLSL constants (shell tables) — keep in sync with OrbitalElements.ts. */
const SHELL_GLSL = /* glsl */ `
const float SHELL_RADII[3]  = float[3](6711.0, 6921.0, 7521.0);
const float SHELL_MOTION[3] = float[3](0.001153, 0.001097, 0.000946);
// Vivid per-shell colors approximating the WGSL shell palette (340 / 550 / 1150 km).
const vec3  SHELL_COLOR[3]  = vec3[3](
  vec3(1.0, 0.35, 0.30),   // shell 0 - warm red
  vec3(0.45, 0.85, 1.0),   // shell 1 - cyan/white
  vec3(0.45, 1.0, 0.55)    // shell 2 - green
);

int decodeShellIndex(float shellData) {
  // shellData = (shellIndex << 8) | colorIndex
  int idx = int(floor(mod(floor(shellData / 256.0), 256.0) + 0.5));
  return clamp(idx, 0, 2);
}

vec3 keplerPosition(vec4 elem, float simTime) {
  int shell = decodeShellIndex(elem.w);
  float orbitR = SHELL_RADII[shell];
  float n = SHELL_MOTION[shell];
  float M = elem.z + n * simTime;
  float cM = cos(M), sM = sin(M);
  float cR = cos(elem.x), sR = sin(elem.x);
  float cI = cos(elem.y), sI = sin(elem.y);
  return vec3(
    orbitR * (cR * cM - sR * sM * cI),
    orbitR * (sR * cM + cR * sM * cI),
    orbitR * sM * sI
  );
}
`;

/** Distance LOD helpers — shared by satellite vertex (debug) and fragment kernels. */
const SAT_LOD_GLSL = /* glsl */ `
const float LOD_NEAR_KM = 5000.0;
const float LOD_MID_KM = 25000.0;
const float LOD_NEAR_BLEND_KM = 1000.0;
const float LOD_MID_BLEND_KM = 3000.0;
const float FLEET_LOD_NEAR_KM = 50.0;
const float MOON_BILLBOARD_SCALE = 750.0;

vec3 lodTierWeights(float lodDist) {
  float nearToMid = smoothstep(LOD_NEAR_KM - LOD_NEAR_BLEND_KM, LOD_NEAR_KM + LOD_NEAR_BLEND_KM, lodDist);
  float midToFar = smoothstep(LOD_MID_KM - LOD_MID_BLEND_KM, LOD_MID_KM + LOD_MID_BLEND_KM, lodDist);
  float nearW = 1.0 - nearToMid;
  float farW = midToFar;
  float midW = max(0.0, nearToMid - farW);
  return vec3(nearW, midW, farW);
}

void resolveLodKernel(
  float lodDist,
  float baseOuter, float baseInner,
  float haloOuter, float haloInner,
  float haloStrength, float coreBoost,
  out float coreOuter, out float coreInner,
  out float outHaloOuter, out float outHaloInner,
  out float outHaloStrength, out float outCoreBoost
) {
  vec3 w = lodTierWeights(lodDist);
  float mOuter = baseOuter * 0.78;
  float mInner = baseInner * 0.65;
  float mHaloO = haloOuter * 0.88;
  float mHaloI = haloInner * 0.88;
  float mHaloS = haloStrength * 0.5;
  float mBoost = coreBoost * 0.9;
  float fOuter = 0.32;
  float fInner = 0.08;
  float fHaloO = 0.38;
  float fHaloI = 0.20;
  float fHaloS = 0.0;
  float fBoost = coreBoost * 0.55;
  coreOuter = w.x * baseOuter + w.y * mOuter + w.z * fOuter;
  coreInner = w.x * baseInner + w.y * mInner + w.z * fInner;
  outHaloOuter = w.x * haloOuter + w.y * mHaloO + w.z * fHaloO;
  outHaloInner = w.x * haloInner + w.y * mHaloI + w.z * fHaloI;
  outHaloStrength = w.x * haloStrength + w.y * mHaloS + w.z * fHaloS;
  outCoreBoost = w.x * coreBoost + w.y * mBoost + w.z * fBoost;
}
`;

/* ─────────────────────────── Satellites (instanced points) ─────────────────────────── */

export const SAT_VERT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) in vec4 aElem; // raan, inclination, meanAnomaly0, shellData
${SHELL_GLSL}
const float FLEET_LOD_NEAR_KM = 50.0;
uniform mat4 uViewProj;
uniform vec3 uCameraPos;
uniform float uSimTime;
uniform vec2 uScreen;
uniform float uPointScale; // debug: global point-size multiplier
uniform int uLodDebug;     // debug: 1 = color by shell/LOD bucket
uniform int uViewMode;     // low 16 bits = view mode index (4 = moon)
uniform float uDistanceCullKm;
uniform float uTimeScale;
uniform vec3 uHostVelocity;
out vec3 vColor;
out float vFade;
out float vWorldDist;
void main() {
  vec3 pos = keplerPosition(aElem, uSimTime);
  vec4 clip = uViewProj * vec4(pos, 1.0);
  gl_Position = clip;

  float dist = max(length(pos - uCameraPos), 1.0);
  vWorldDist = dist;
  if (dist > uDistanceCullKm) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vFade = 0.0;
    return;
  }
  // Screen-size attenuation: closer satellites render larger (clamped for GL_POINTS).
  float size = clamp((uScreen.y * 4.0) / dist, 1.0, 32.0) * uPointScale;
  gl_PointSize = size;

  int shell = decodeShellIndex(aElem.w);
  vec3 base = SHELL_COLOR[shell];
  if (uLodDebug == 1) {
    // LOD debug: bucket by distance into discrete bands.
    float band = clamp(floor(dist / 8000.0), 0.0, 3.0);
    base = mix(vec3(1.0, 1.0, 0.2), vec3(1.0, 0.1, 0.6), band / 3.0);
  }
  vColor = base;
  // Fade distant satellites slightly so dense shells don't blow out.
  vFade = clamp(20000.0 / dist, 0.15, 1.0);
  bool isFleetView = (uViewMode & 0xFFFF) == 2;
  if (isFleetView) {
    float nearFleet = 1.0 - smoothstep(FLEET_LOD_NEAR_KM * 0.35, FLEET_LOD_NEAR_KM, dist);
    vFade *= (1.0 + 0.35 * nearFleet);
    if (length(uHostVelocity) > 1e-5) {
      vFade *= clamp(1.0 + 0.08 * sqrt(max(uTimeScale, 1.0)), 1.0, 1.6);
    }
  }
}
`;

export const SAT_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${SAT_LOD_GLSL}
in vec3 vColor;
in float vFade;
in float vWorldDist;
uniform float uCoreOuter;
uniform float uCoreInner;
uniform float uHaloOuter;
uniform float uHaloInner;
uniform float uHaloStrength;
uniform float uCoreBoost;
uniform int uViewMode;
out vec4 fragColor;
void main() {
  vec2 uv = gl_PointCoord;
  float uvDist = distance(uv, vec2(0.5));

  bool isMoonView = (uViewMode & 0xFFFF) == 4;
  float lodDist = vWorldDist / (isMoonView ? MOON_BILLBOARD_SCALE : 1.0);

  float coreOuter;
  float coreInner;
  float haloOuter;
  float haloInner;
  float haloStrength;
  float coreBoost;
  resolveLodKernel(
    lodDist, uCoreOuter, uCoreInner, uHaloOuter, uHaloInner, uHaloStrength, uCoreBoost,
    coreOuter, coreInner, haloOuter, haloInner, haloStrength, coreBoost
  );

  bool isFleetView = (uViewMode & 0xFFFF) == 2;
  if (isFleetView) {
    float nearFleet = 1.0 - smoothstep(FLEET_LOD_NEAR_KM * 0.35, FLEET_LOD_NEAR_KM, lodDist);
    coreOuter = mix(coreOuter, coreOuter * 0.82, nearFleet);
    coreInner = mix(coreInner, coreInner * 0.82, nearFleet);
    coreBoost *= (1.0 + 0.4 * nearFleet);
  }

  float core = smoothstep(coreOuter, coreInner, uvDist);
  float halo = smoothstep(haloOuter, haloInner, uvDist) * haloStrength;
  float alpha = (core + halo) * vFade;
  float alphaCutoff = lodDist > LOD_MID_KM ? 0.03 : 0.02;
  if (alpha < alphaCutoff) discard;
  float intensityBoost = 1.0 + core * coreBoost;
  vec3 col = vColor * intensityBoost * vFade;
  fragColor = vec4(col, alpha);
}
`;

/* ─────────────────────────────────── Earth ─────────────────────────────────── */

export const EARTH_VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
uniform mat4 uViewProj;
out vec3 vWorld;
out vec3 vNormal;
void main() {
  vWorld = aPos;
  vNormal = aNormal;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
`;

// Simplified port of earth.wgsl: diffuse day/night terrain, ocean tint, city
// lights on the night side, and an atmospheric rim. Emissive output feeds bloom.
export const EARTH_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
in vec3 vWorld;
in vec3 vNormal;
uniform vec3 uCameraPos;
uniform vec3 uSunDir;   // normalized direction to the sun (ECI)
uniform int uWireframe; // debug flag (handled by draw mode; kept for parity)
uniform int uViewMode;  // low 16 bits = view mode index (4 = moon)
out vec4 fragColor;

// Cheap hash-based value noise for continent/city variation.
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCameraPos - vWorld);
  float ndotl = dot(N, normalize(uSunDir));
  float day = clamp(ndotl * 0.5 + 0.5, 0.0, 1.0);

  // Continents vs ocean from layered noise on the unit sphere.
  vec3 sp = N * 3.0;
  float land = noise(sp) * 0.6 + noise(sp * 2.3) * 0.3 + noise(sp * 5.1) * 0.1;
  float isLand = smoothstep(0.52, 0.58, land);

  vec3 ocean = vec3(0.02, 0.10, 0.28);
  vec3 landCol = mix(vec3(0.10, 0.30, 0.10), vec3(0.45, 0.38, 0.24), smoothstep(0.55, 0.75, land));
  vec3 albedo = mix(ocean, landCol, isLand);

  // Lit day side.
  vec3 color = albedo * (0.12 + 1.05 * day);

  // City lights on the night side (land only).
  float night = clamp(-ndotl, 0.0, 1.0);
  float cities = smoothstep(0.6, 0.62, noise(sp * 9.0)) * isLand;
  color += vec3(1.0, 0.85, 0.5) * cities * night * 1.6;

  // Atmospheric rim (Fresnel-ish), brightest at the limb.
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  color += vec3(0.25, 0.5, 1.0) * rim * (0.4 + 0.6 * day);

  bool isMoonView = (uViewMode & 0xFFFF) == 4;
  if (isMoonView) {
    float nightSide = 1.0 - day;
    color += vec3(0.06, 0.10, 0.22) * nightSide * smoothstep(0.05, -0.30, ndotl) * 0.85;
    // Blue-marble disk floor + limb halo (WebGL has no separate atmosphere pass).
    color = max(color, vec3(0.05, 0.11, 0.24) * (0.32 + 0.68 * day));
    color *= 2.1;
    color += vec3(0.20, 0.42, 0.78) * rim * 0.72;
    color += vec3(0.10, 0.20, 0.38) * (1.0 - rim) * 0.32;
  }

  fragColor = vec4(color, 1.0);
}
`;

/* ───────────────────────────────── Starfield ───────────────────────────────── */

// Fullscreen background: reconstruct a view ray from the inverse view-proj and
// hash it into a sparse starfield. Runs before the scene with depth disabled.
export const STAR_VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vNdc;
void main() {
  vNdc = aPos;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const STAR_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
in vec2 vNdc;
uniform mat4 uInvViewProj;
uniform float uTime;
uniform int uBackgroundMode;
uniform vec3 uCameraPos;
uniform vec3 uSunDir;
uniform int uViewMode;
out vec4 fragColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Small 2-octave value noise for the ground-view horizon terrain fill.
float vnoise21(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = mix(hash21(i), hash21(i + vec2(1, 0)), u.x);
  float b = mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), u.x);
  return mix(a, b, u.y);
}

// Ground View (backgroundMode 2): simplified horizon matching the WebGPU
// ray-traced horizon pass — terrain fill below the geometric horizon,
// haze band + night city-light glow above it.
vec3 groundViewHorizon(vec3 color, vec3 dir) {
  float r = max(length(uCameraPos), 6371.0 + 1.0);
  vec3 up = uCameraPos / r;
  float cosH = -sqrt(max(1.0 - (6371.0 * 6371.0) / (r * r), 0.0));
  float cosVZ = dot(dir, up);
  float sunElev = dot(up, normalize(uSunDir));
  float day = smoothstep(-0.08, 0.25, sunElev);
  float night = smoothstep(0.02, -0.10, sunElev);
  float twilight = smoothstep(-0.28, -0.05, sunElev) * (1.0 - smoothstep(-0.02, 0.14, sunElev));

  if (cosVZ < cosH) {
    // Below the horizon: procedural terrain fill with night city speckle.
    vec2 gp = vec2(atan(dir.y, dir.x), asin(clamp(dir.z, -1.0, 1.0))) * 40.0;
    float n = vnoise21(gp) * 0.65 + vnoise21(gp * 2.7) * 0.35;
    vec3 land = mix(vec3(0.020, 0.030, 0.028), vec3(0.10, 0.12, 0.09), n);
    vec3 ground = land * (0.10 + 0.90 * day);
    float city = step(0.985, hash21(floor(gp * 5.0))) * night * step(0.45, n);
    ground += vec3(1.0, 0.70, 0.30) * city * 0.55;
    // Haze just below the horizon line.
    float hb = exp(-(cosH - cosVZ) * 30.0);
    ground = mix(ground, mix(vec3(0.04, 0.06, 0.11), vec3(0.40, 0.52, 0.72), day), hb * 0.75);
    ground += vec3(0.9, 0.35, 0.10) * twilight * hb * 0.4;
    return ground;
  }

  // Above the horizon: Mie haze band + night city glow hugging the line.
  float band = exp(-(cosVZ - cosH) * 16.0);
  vec3 haze = mix(vec3(0.03, 0.05, 0.10), vec3(0.35, 0.50, 0.80), day);
  haze += vec3(1.0, 0.42, 0.14) * twilight * 0.8;
  float clump = vnoise21(vec2(atan(dir.y, dir.x) * 10.0, 1.7));
  vec3 cityGlow = vec3(1.0, 0.60, 0.28) * band * band * night * (0.20 + 0.35 * clump);
  return mix(color, haze, band * 0.7) + cityGlow;
}

void main() {
  // World-space ray direction through this pixel.
  vec4 far = uInvViewProj * vec4(vNdc, 1.0, 1.0);
  vec4 near = uInvViewProj * vec4(vNdc, -1.0, 1.0);
  vec3 dir = normalize(far.xyz / far.w - near.xyz / near.w);

  // Map the direction to a stable 2D cell grid for star placement.
  vec2 uv = vec2(atan(dir.y, dir.x), asin(clamp(dir.z, -1.0, 1.0)));
  vec2 grid = uv * 220.0;
  vec2 cell = floor(grid);
  float star = hash21(cell);
  float bright = 0.0;
  if (star > 0.985) {
    vec2 f = fract(grid) - 0.5;
    float tw = 0.7 + 0.3 * sin(uTime * 2.0 + star * 40.0);
    bright = smoothstep(0.25, 0.0, length(f)) * (star - 0.985) / 0.015 * tw;
  }
  // Cap star HDR so ground view is not washed out; brightest stars still bloom.
  float starCap = uBackgroundMode == 2 ? 0.55 : 0.92;
  bright = min(bright, starCap);
  // Subtle deep-space gradient.
  vec3 bg = mix(vec3(0.004, 0.006, 0.015), vec3(0.0, 0.0, 0.004), uv.y * 0.5 + 0.5);
  vec3 color = bg + vec3(bright);
  if (uBackgroundMode == 2) {
    color = groundViewHorizon(color, dir);
  }
  bool isMoonView = (uViewMode & 0xFFFF) == 4;
  if (isMoonView) {
    vec3 toEarth = normalize(-uCameraPos);
    float cosEarth = dot(dir, toEarth);
    float earthDiskGlow = smoothstep(cos(0.026), cos(0.012), cosEarth);
    color += vec3(0.08, 0.16, 0.32) * earthDiskGlow * 1.35;
    float earthMask = smoothstep(cos(0.0185), 0.99998, cosEarth);
    color *= mix(1.0, 0.22, earthMask);
  }
  fragColor = vec4(color, 1.0);
}
`;

/* ───────────────────────────── Bloom (threshold / blur / composite) ───────────────────────────── */

export const FS_VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const THRESHOLD_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform float uThreshold;
uniform float uKnee;
uniform float uEnforceFloors;
out vec4 fragColor;
void main() {
  vec3 c = texture(uScene, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float t = uEnforceFloors > 0.5 ? max(uThreshold, 1.5) : uThreshold;
  float k = uEnforceFloors > 0.5 ? max(uKnee, 0.05) : uKnee;
  float soft = clamp(l - t + k, 0.0, 2.0 * k);
  soft = soft * soft / (4.0 * k + 1e-4);
  float bloomLum = max(soft, l - t);
  float sourceWeight = mix(0.36, 1.0, smoothstep(2.0, 4.0, l));
  bloomLum *= sourceWeight;
  fragColor = vec4(c * (bloomLum / max(l, 1e-5)), 1.0);
}
`;

export const BLUR_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSource;
uniform vec2 uDirection; // texel-sized step along one axis
out vec4 fragColor;
void main() {
  // 9-tap Gaussian.
  float w[5] = float[5](0.227027, 0.194594, 0.121621, 0.054054, 0.016216);
  vec3 result = texture(uSource, vUv).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    vec2 off = uDirection * float(i);
    result += texture(uSource, vUv + off).rgb * w[i];
    result += texture(uSource, vUv - off).rgb * w[i];
  }
  fragColor = vec4(result, 1.0);
}
`;

// Final composite: scene + bloom, ACES tonemap, gamma, light grade + grain.
export const COMPOSITE_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomIntensity;
uniform float uExposure;
uniform float uTime;
uniform int uTonemap; // 0 ACES, 1 Reinhard, 2 none
out vec4 fragColor;

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 compositeBloom(vec3 bloom, vec3 scene, float intensity) {
  float sceneLum = dot(scene, vec3(0.2126, 0.7152, 0.0722));
  float satMix = smoothstep(2.4, 4.2, sceneLum);
  float starMix = (1.0 - smoothstep(2.8, 4.5, sceneLum)) * smoothstep(0.12, 1.0, sceneLum);
  vec3 layered = bloom * mix(0.72, 1.18, satMix);
  layered += bloom * starMix * 0.48;
  float lum = dot(layered, vec3(0.2126, 0.7152, 0.0722));
  float haloLift = mix(1.42, 1.0, smoothstep(0.03, 0.38, lum));
  vec3 soft = layered / max(vec3(1.0), layered * 0.14 + vec3(0.10));
  return soft * intensity * haloLift;
}

void main() {
  vec3 scene = texture(uScene, vUv).rgb;
  vec3 bloom = texture(uBloom, vUv).rgb;
  vec3 hdr = (scene + compositeBloom(bloom, scene, uBloomIntensity)) * uExposure;

  vec3 mapped;
  if (uTonemap == 0) mapped = aces(hdr);
  else if (uTonemap == 1) mapped = hdr / (1.0 + hdr);
  else mapped = clamp(hdr, 0.0, 1.0);

  // Gamma.
  mapped = pow(mapped, vec3(1.0 / 2.2));

  // Subtle film grain so flat regions aren't banded.
  float grain = fract(sin(dot(vUv * uTime, vec2(12.9898, 78.233))) * 43758.5453);
  mapped += (grain - 0.5) * 0.015;

  fragColor = vec4(mapped, 1.0);
}
`;

/* ───────────────────────────── Moon View foreground ───────────────────────────── */

export const MOON_FOREGROUND_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
uniform float uTime;
uniform int uViewMode;
uniform vec3 uCameraPos;
uniform mat4 uInvViewProj;
out vec4 fragColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise21(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

vec3 skyDir(vec2 uv) {
  vec4 far = uInvViewProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec4 near = uInvViewProj * vec4(uv * 2.0 - 1.0, -1.0, 1.0);
  return normalize(far.xyz / far.w - near.xyz / near.w);
}

void main() {
  if ((uViewMode & 0xFFFF) != 4) {
    fragColor = vec4(0.0);
    return;
  }

  float arc = 0.04 * (1.0 - vUv.x * vUv.x) * 4.0;
  float horizonY = 0.15 + arc;
  float regolithMask = 1.0 - smoothstep(horizonY - 0.02, horizonY + 0.01, vUv.y);
  if (regolithMask < 0.001) {
    fragColor = vec4(0.0);
    return;
  }

  float crater = noise21(vUv * vec2(48.0, 18.0));
  float grain = noise21(vUv * 180.0 + vec2(3.7, 11.2));
  vec3 regolith = vec3(0.10, 0.09, 0.08);
  regolith += vec3(0.16, 0.14, 0.12) * crater * 0.35;
  regolith += vec3(0.04, 0.035, 0.03) * (1.0 - crater) * 0.25;
  regolith += vec3(grain * 0.04);

  vec3 toEarth = normalize(-uCameraPos);
  float cosEarth = dot(skyDir(vUv), toEarth);
  float earthGlow = smoothstep(cos(0.023), cos(0.009), cosEarth);
  regolith += vec3(0.04, 0.06, 0.12) * earthGlow * 0.18 * regolithMask;

  float edgeFade = smoothstep(horizonY - 0.02, horizonY + 0.008, vUv.y);
  float alpha = regolithMask * mix(0.92, 0.0, edgeFade);
  fragColor = vec4(regolith * 0.48, alpha * 0.88);
}
`;
