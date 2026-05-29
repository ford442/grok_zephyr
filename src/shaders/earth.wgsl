/**
 * Earth Rendering Shader
 *
 * Renders Earth with FBM terrain, PBR ocean (Schlick Fresnel + sun glint),
 * and night-side city lights with coastal/latitude density weighting.
 */

#import "uniforms.wgsl"

const PI: f32 = 3.14159265;

struct VIn {
  @location(0) pos: vec3f,
  @location(1) nrm: vec3f,
};

struct VOut {
  @builtin(position) cp: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
};

@vertex
fn vs(v: VIn) -> VOut {
  var out: VOut;
  out.cp = uni.view_proj * vec4f(v.pos, 1.0);
  out.wp = v.pos;
  out.n  = v.nrm;
  return out;
}

// ── Noise helpers ────────────────────────────────────────────────────────────
// Constants 127.1, 311.7, 74.7, 43758.5453 are standard hash primes for PRNG.

fn hash3e(p: vec3f) -> f32 {
  return fract(sin(dot(p, vec3f(127.1, 311.7, 74.7))) * 43758.5453);
}

fn noise3e(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3e(i + vec3f(0,0,0)), hash3e(i + vec3f(1,0,0)), u.x),
        mix(hash3e(i + vec3f(0,1,0)), hash3e(i + vec3f(1,1,0)), u.x), u.y),
    mix(mix(hash3e(i + vec3f(0,0,1)), hash3e(i + vec3f(1,0,1)), u.x),
        mix(hash3e(i + vec3f(0,1,1)), hash3e(i + vec3f(1,1,1)), u.x), u.y),
    u.z
  );
}

fn fbmTerrain(pos: vec3f) -> f32 {
  var v = 0.0; var a = 0.5; var freq = 1.0; var mx = 0.0;
  for (var i = 0; i < 4; i++) {
    v  += a * noise3e(pos * freq);
    mx += a;
    a  *= 0.5; freq *= 2.0;
  }
  return v / mx;
}

fn hash2e(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

fn noise2e(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash2e(i + vec2f(0,0)), hash2e(i + vec2f(1,0)), u.x),
    mix(hash2e(i + vec2f(0,1)), hash2e(i + vec2f(1,1)), u.x),
    u.y
  );
}

fn fbmCity(p: vec2f) -> f32 {
  var v = 0.0; var a = 0.5; var x = p;
  for (var i = 0; i < 4; i++) { v += a * noise2e(x); x *= 2.0; a *= 0.5; }
  return v;
}

// ── PBR helpers ──────────────────────────────────────────────────────────────

fn schlickFresnel(cosTheta: f32, F0: f32) -> f32 {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let N       = normalize(in.n);
  let sun_dir = normalize(uni.sun_pos.xyz);
  let V       = normalize(uni.camera_pos.xyz - in.wp);
  let diff    = max(dot(N, sun_dir), 0.0);

  let lat = asin(clamp(N.z, -1.0, 1.0));
  let lon = atan2(N.y, N.x);

  // FBM terrain height
  let height = fbmTerrain(normalize(in.wp) * 3.0);
  let isLand = height > 0.45;

  // Polar ice caps
  let pole = smoothstep(1.1, 1.4, abs(lat));

  var surf: vec3f;
  if (isLand) {
    // Height-based biome colours
    let SEA_LEVEL = 0.45; let COASTAL = 0.48; let PLAINS = 0.55;
    let HILLS = 0.70; let MOUNTAIN = 0.85;
    let beach  = vec3f(0.76, 0.70, 0.50);
    let grass  = vec3f(0.22, 0.42, 0.13);
    let forest = vec3f(0.10, 0.26, 0.07);
    let rock   = vec3f(0.35, 0.32, 0.28);
    let snow   = vec3f(0.90, 0.92, 0.95);
    var c: vec3f;
    if      (height < COASTAL)  { c = mix(grass, beach,  (height - SEA_LEVEL) / (COASTAL  - SEA_LEVEL)); }
    else if (height < PLAINS)   { c = mix(beach, grass,  (height - COASTAL)   / (PLAINS   - COASTAL));   }
    else if (height < HILLS)    { c = mix(grass, forest, (height - PLAINS)    / (HILLS    - PLAINS));    }
    else if (height < MOUNTAIN) { c = mix(forest, rock,  (height - HILLS)     / (MOUNTAIN - HILLS));     }
    else                        { c = mix(rock, snow,    (height - MOUNTAIN)  / (1.0      - MOUNTAIN));  }
    surf = mix(c, snow, max(pole, smoothstep(0.82, 0.88, height) * (1.0 - abs(lat) / (PI / 2.0))));
    surf = surf * (diff * 0.92 + 0.04);
  } else {
    // PBR ocean: Schlick Fresnel + Blinn-Phong sun glint
    let VdotN   = max(dot(V, N), 0.0);
    let fresnel = schlickFresnel(VdotN, 0.02);
    let NdotL   = max(dot(N, sun_dir), 0.0);
    let deepCol = vec3f(0.02, 0.08, 0.18);
    let shalCol = vec3f(0.05, 0.25, 0.40);
    let baseCol = mix(deepCol, shalCol, 0.3);
    let diffuse = baseCol * NdotL * (1.0 - fresnel);
    let H       = normalize(V + sun_dir);
    let NdotH   = max(dot(N, H), 0.0);
    let specPow = mix(200.0, 20.0, 0.1 + 0.2 * (1.0 - VdotN));
    let specular = pow(NdotH, specPow) * fresnel * 2.0;
    let skyRef   = vec3f(0.4, 0.7, 1.0) * fresnel * 0.5;
    surf = mix(diffuse + vec3f(specular) + skyRef, vec3f(0.90, 0.92, 0.95), pole);
  }

  // Atmosphere limb glow
  let rim = clamp(1.0 - abs(dot(N, V)), 0.0, 1.0);
  surf += vec3f(0.20, 0.50, 1.0) * pow(rim, 1.8) * 0.36 * (1.0 - diff) * 0.7;

  // City lights: FBM-based coastal/latitude density
  let night      = smoothstep(0.06, -0.04, dot(N, sun_dir));
  let cityCoarse = fbmCity(vec2f(lat * 6.0, lon * 8.0));
  let cityFine   = fbmCity(vec2f(lat * 25.0 + 1.7, lon * 19.0 + 2.3));
  let coastBias  = smoothstep(0.44, 0.52, height) * (1.0 - smoothstep(0.52, 0.76, height));
  let absLat     = abs(lat) / (PI / 2.0);
  let latWeight  = smoothstep(0.07, 0.22, absLat) * (1.0 - smoothstep(0.60, 0.80, absLat));
  let cityDens   = f32(isLand) * coastBias * latWeight * smoothstep(0.38, 0.58, cityCoarse);
  let cityMask   = cityDens * (0.55 + 0.45 * cityFine);
  let cityLight  = (vec3f(1.0, 0.78, 0.28) * cityMask
                  + vec3f(0.9, 0.95, 1.0) * pow(cityMask, 2.5) * 0.45)
                  * night * 0.18;

  return vec4f(surf + cityLight, 1.0);
}
