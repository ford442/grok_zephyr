// Hipparcos catalog stars (?sky=hip) — instanced camera-facing impostors drawn
// additively over the `fs_catalog` background. One instance per star, six
// vertices per quad. See docs/SKY.md; src/render/SkyCatalog.ts mirrors the
// decode, projection and Earth-occlusion math for tests.
#import "uniforms.wgsl"
#import "starsCommon.wgsl"

// xyz = ICRS unit direction, w = bitcast u32: (V + 2)·1000 in the low 16 bits,
// signed (B−V)·1000 in the high 16 bits.
@group(1) @binding(0) var<storage, read> catalogStars: array<vec4f>;

const EARTH_RADIUS_KM: f32 = 6371.0;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
  @location(1) color: vec3f,
  @location(2) dir: vec3f,
};

// Ballesteros (2012) B−V → effective temperature.
fn bvToTemperature(bv: f32) -> f32 {
  let c = clamp(bv, -0.4, 2.0);
  return 4600.0 * (1.0 / (0.92 * c + 1.7) + 1.0 / (0.92 * c + 0.62));
}

// True when the ray from the camera along `dir` hits the solid Earth.
fn occludedByEarth(dir: vec3f) -> bool {
  let cam = uni.camera_pos.xyz;
  let r = length(cam);
  if (r <= EARTH_RADIUS_KM) { return false; }
  let cosLimb = sqrt(max(0.0, 1.0 - (EARTH_RADIUS_KM * EARTH_RADIUS_KM) / (r * r)));
  return dot(dir, -cam / r) > cosLimb;
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VSOut {
  const corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  var o: VSOut;
  o.pos = vec4f(0.0, 0.0, 2.0, 1.0); // outside the depth range → clipped
  o.local = vec2f(0.0);
  o.color = vec3f(0.0);
  o.dir = vec3f(0.0, 0.0, 1.0);

  if (ii >= skyCatalog.count) { return o; }
  let star = catalogStars[ii];
  let packed = bitcast<u32>(star.w);
  let mag = f32(packed & 0xFFFFu) / 1000.0 - 2.0;
  let bv = f32(bitcast<i32>(packed) >> 16u) / 1000.0;
  if (mag > skyCatalog.frame_x.w) { return o; }

  let dir = normalize(catalogToRender(star.xyz));
  if (occludedByEarth(dir)) { return o; }

  // Point at infinity: w = 0 drops the camera translation.
  var clip = uni.view_proj * vec4f(dir, 0.0);
  if (clip.w <= 0.0) { return o; }

  // Brighter stars get a slightly wider footprint so they read as brighter
  // without every one of them saturating bloom.
  let halfPx = skyCatalog.frame_z.w * mix(1.0, 2.0, smoothstep(3.5, -1.0, mag));
  let corner = corners[vi];
  clip = vec4f(clip.xy + corner * halfPx * 2.0 / uni.screen_size * clip.w, clip.w * 0.5, clip.w);

  o.pos = clip;
  o.local = corner;
  o.color = blackbodyColor(bvToTemperature(bv)) * starHdrLuminance(mag) * skyCatalog.frame_y.w;
  o.dir = dir;
  return o;
}

@fragment fn fs(in: VSOut) -> @location(0) vec4f {
  let falloff = exp(-dot(in.local, in.local) * 3.0);
  var color = in.color * falloff * catalogStarScale(in.dir) * 1.02 * skyModeBoost();
  color *= skyExtinction(in.dir);
  return vec4f(color, 0.0);
}
