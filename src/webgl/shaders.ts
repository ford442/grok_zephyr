/**
 * Grok Zephyr - WebGL2 (GLSL ES 3.00) shader sources for the fallback renderer.
 *
 * These mirror the WGSL pipeline semantically (see src/shaders/*.wgsl) but in a
 * simplified, single-author form suited to visual debugging and CI capture.
 *
 * Propagation note: the satellite vertex shader performs the *simple-mode*
 * Keplerian propagation that orbital_compute.wgsl does on the GPU compute pass —
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

/* ─────────────────────────── Satellites (instanced points) ─────────────────────────── */

export const SAT_VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec4 aElem; // raan, inclination, meanAnomaly0, shellData
${SHELL_GLSL}
uniform mat4 uViewProj;
uniform vec3 uCameraPos;
uniform float uSimTime;
uniform vec2 uScreen;
uniform float uPointScale; // debug: global point-size multiplier
uniform int uLodDebug;     // debug: 1 = color by shell/LOD bucket
out vec3 vColor;
out float vFade;
void main() {
  vec3 pos = keplerPosition(aElem, uSimTime);
  vec4 clip = uViewProj * vec4(pos, 1.0);
  gl_Position = clip;

  float dist = max(length(pos - uCameraPos), 1.0);
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
}
`;

export const SAT_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec3 vColor;
in float vFade;
out vec4 fragColor;
void main() {
  vec2 uv = gl_PointCoord;
  float dist = distance(uv, vec2(0.5));
  float core = smoothstep(0.40, 0.10, dist);
  float halo = smoothstep(0.50, 0.35, dist) * 0.2;
  float alpha = (core + halo) * vFade;
  if (alpha < 0.02) discard;
  float intensityBoost = 1.0 + core * 2.5;
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
in vec3 vWorld;
in vec3 vNormal;
uniform vec3 uCameraPos;
uniform vec3 uSunDir;   // normalized direction to the sun (ECI)
uniform int uWireframe; // debug flag (handled by draw mode; kept for parity)
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
in vec2 vNdc;
uniform mat4 uInvViewProj;
uniform float uTime;
uniform int uBackgroundMode;
out vec4 fragColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
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
  // Subtle deep-space gradient.
  vec3 bg = mix(vec3(0.004, 0.006, 0.015), vec3(0.0, 0.0, 0.004), uv.y * 0.5 + 0.5);
  fragColor = vec4(bg + vec3(bright), 1.0);
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
out vec4 fragColor;
void main() {
  vec3 c = texture(uScene, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float t = max(uThreshold, 1.5);
  float k = max(uKnee, 0.05);
  float soft = clamp(l - t + k, 0.0, 2.0 * k);
  soft = soft * soft / (4.0 * k + 1e-4);
  float bloomLum = max(soft, l - t);
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

void main() {
  vec3 scene = texture(uScene, vUv).rgb;
  vec3 bloom = texture(uBloom, vUv).rgb;
  vec3 hdr = (scene + bloom * uBloomIntensity) * uExposure;

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
