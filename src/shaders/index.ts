/**
 * Grok Zephyr - Shader Collection
 * 
 * Central export for all WGSL shaders.
 * In a production build, these would be imported as strings
 * via a custom Vite plugin.
 */

// For now, we use inline strings that match the .wgsl files
// In a full implementation, these would be loaded via:
// import orbitalCompute from './orbital_compute.wgsl?raw';

/** Uniform struct shared across shaders */
export const UNIFORM_STRUCT = /* wgsl */ `
struct Uni {
  view_proj      : mat4x4f,
  camera_pos     : vec4f,
  camera_right   : vec4f,
  camera_up      : vec4f,
  time           : f32,
  delta_time     : f32,
  view_mode      : u32,
  is_ground_view : u32,
  frustum        : array<vec4f,6>,
  screen_size    : vec2f,
  pad1           : vec2f,
};
@group(0) @binding(0) var<uniform> uni : Uni;
`;

/** Orbital mechanics compute shader - multi-shell version */
export const ORBITAL_CS = UNIFORM_STRUCT + /* wgsl */ `
@group(0) @binding(1) var<storage,read>       orb_elem : array<vec4f>;
@group(0) @binding(2) var<storage,read_write> sat_pos  : array<vec4f>;

// Multi-shell orbit radii (km from Earth center)
// Shell 0: 340km alt = 6711km radius
// Shell 1: 550km alt = 6921km radius  
// Shell 2: 1150km alt = 7521km radius
const ORBIT_RADII_KM = array<f32,3>(6711.0, 6921.0, 7521.0);

// Mean motion (rad/s) for each shell - lower orbits = faster
// ω = sqrt(μ/r³) where μ = 3.986e5 km³/s²
const MEAN_MOTIONS = array<f32,3>(0.001153, 0.001097, 0.000946);

@compute @workgroup_size(64,1,1)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  if (i >= 1048576u) { return; }

  let e    = orb_elem[i];
  let raan = e.x;
  let inc  = e.y;
  let m0   = e.z;
  let shellData = e.w;
  
  // Extract shell index (upper 8 bits) and color (lower 8 bits)
  let shellDataU = u32(shellData);
  let shellIndex = shellDataU >> 8u;
  let colorIndex = f32(shellDataU & 255u);
  
  // Select orbit parameters based on shell
  let orbitR = ORBIT_RADII_KM[shellIndex];
  let meanMotion = MEAN_MOTIONS[shellIndex];

  let M  = m0 + meanMotion * uni.time;
  let cM = cos(M); let sM = sin(M);
  let cR = cos(raan); let sR = sin(raan);
  let cI = cos(inc);  let sI = sin(inc);

  let x = orbitR * (cR*cM - sR*sM*cI);
  let y = orbitR * (sR*cM + cR*sM*cI);
  let z = orbitR * sM * sI;

  sat_pos[i] = vec4f(x, y, z, colorIndex);
}
`;

/** Starfield background shader - parallax layers + twinkling */
export const STARS_SHADER = UNIFORM_STRUCT + /* wgsl */ `
struct VSOut { @builtin(position) pos:vec4f, @location(0) uv:vec2f };

@vertex fn vs(@builtin(vertex_index) vi:u32) -> VSOut {
  const pts = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
  var o:VSOut;
  o.pos = vec4f(pts[vi],0,1);
  o.uv  = pts[vi]*0.5 + 0.5;
  return o;
}

fn hash2(p:vec2f)->f32 {
  return fract(sin(dot(p,vec2f(127.1,311.7)))*43758.5453);
}

@fragment fn fs(in:VSOut) -> @location(0) vec4f {
  var total = vec3f(0.0);
  
  // Layer 1: Distant fine stars (small, many)
  let cell1  = floor(in.uv * 512.0);
  let h1     = hash2(cell1);
  let h1b    = hash2(cell1 + vec2f(1.0,0.0));
  let h1c    = hash2(cell1 + vec2f(0.0,1.0));
  let star1  = f32(h1 > 0.994) * pow(h1b,6.0);
  // Magnitude-based twinkling: brighter stars twinkle slower
  let twinkle1 = 0.7 + 0.3*sin(uni.time*(1.5 + h1b*2.0) + h1*20.0);
  let color1 = mix(vec3f(0.6,0.8,1.0), vec3f(1.0,0.9,0.7), h1c);
  total += color1 * star1 * twinkle1 * 1.5;
  
  // Layer 2: Mid-range brighter stars (fewer, larger)
  let cell2  = floor(in.uv * 200.0);
  let h2     = hash2(cell2 + vec2f(43.0,17.0));
  let h2b    = hash2(cell2 + vec2f(71.0,53.0));
  let h2c    = hash2(cell2 + vec2f(97.0,23.0));
  let star2  = f32(h2 > 0.997) * pow(h2b,4.0);
  let twinkle2 = 0.8 + 0.2*sin(uni.time*(0.8 + h2b*1.2) + h2*15.0);
  let color2 = mix(vec3f(0.9,0.95,1.0), vec3f(1.0,0.85,0.6), h2c);
  total += color2 * star2 * twinkle2 * 2.5;
  
  return vec4f(total, 1.0);
}
`;

/** Earth sphere shader */
export const EARTH_SHADER = UNIFORM_STRUCT + /* wgsl */ `
struct VIn  { @location(0) pos:vec3f, @location(1) nrm:vec3f }
struct VOut { @builtin(position) cp:vec4f, @location(0) wp:vec3f, @location(1) n:vec3f }

@vertex fn vs(v:VIn) -> VOut {
  var o:VOut;
  o.cp = uni.view_proj * vec4f(v.pos,1);
  o.wp = v.pos;
  o.n  = v.nrm;
  return o;
}

@fragment fn fs(in:VOut) -> @location(0) vec4f {
  let N       = normalize(in.n);
  let sun_dir = normalize(vec3f(1.0,0.4,0.2));
  let diff    = max(dot(N,sun_dir),0.0);

  let lat = asin(clamp(N.z,-1.0,1.0));
  let lon = atan2(N.y,N.x);
  let f1  = sin(lat*4.0+0.5)*cos(lon*3.0+1.2);
  let f2  = cos(lat*6.0)*sin(lon*5.0+0.8);
  let land = smoothstep(0.15,0.35, f1*0.6+f2*0.4);

  let ocean = vec3f(0.04,0.10,0.30);
  let soil  = vec3f(0.15,0.22,0.06);
  let ice   = vec3f(0.7,0.75,0.8);
  let pole  = smoothstep(1.1,1.4, abs(lat));
  var surf  = mix(mix(ocean,soil,land), ice, pole);

  let ambient   = 0.04;
  let lit       = surf * (diff*0.92 + ambient);

  // Enhanced night side with brighter city lights and ocean specular
  let night = smoothstep(0.08,-0.08,dot(N,sun_dir));
  let cityNoise = 0.5+0.5*sin(lon*18.0+lat*14.0);
  let cityNoise2 = 0.5+0.5*sin(lon*42.0+lat*30.0);
  let cityMask = smoothstep(0.4,0.6,land) * cityNoise * (0.5 + 0.5*cityNoise2);
  let city  = night * 0.045 * vec3f(1.0,0.82,0.35) * cityMask;
  
  // Ocean specular on night side (moonlight/starlight reflection)
  let oceanSpec = night * (1.0 - land) * 0.008 * vec3f(0.15,0.2,0.35);

  return vec4f(lit+city+oceanSpec,1.0);
}
`;

/** Atmosphere limb glow shader */
export const ATM_SHADER = UNIFORM_STRUCT + /* wgsl */ `
struct VIn  { @location(0) pos:vec3f, @location(1) nrm:vec3f }
struct VOut { @builtin(position) cp:vec4f, @location(0) wp:vec3f, @location(1) n:vec3f }

const ATM_SCALE : f32 = 6471.0/6371.0;

@vertex fn vs(v:VIn) -> VOut {
  var o:VOut;
  let p  = v.pos * ATM_SCALE;
  o.cp   = uni.view_proj * vec4f(p,1);
  o.wp   = p;
  o.n    = v.nrm;
  return o;
}

@fragment fn fs(in:VOut) -> @location(0) vec4f {
  let N       = normalize(in.n);
  let V       = normalize(uni.camera_pos.xyz - in.wp);
  let rim     = 1.0 - abs(dot(N,V));
  let limb    = pow(rim,3.5);
  let limb2   = pow(rim,7.0);

  let blue    = vec3f(0.08,0.38,1.0)*limb*2.8;
  let teal    = vec3f(0.0,0.7,0.45)*limb2*0.6;
  let alpha   = limb*0.85;
  return vec4f(blue+teal, alpha);
}
`;

/** Satellite billboard shader - shell-specific aesthetics */
export const SAT_SHADER = UNIFORM_STRUCT + /* wgsl */ `
@group(0) @binding(1) var<storage,read> sat_pos : array<vec4f>;

struct VOut {
  @builtin(position) cp : vec4f,
  @location(0) uv       : vec2f,
  @location(1) color    : vec3f,
  @location(2) bright   : f32,
}

// Shell-specific colors matching orbital shells:
// colorIdx 2 = low shell (340km alt, 6711km radius) → Electric cyan-blue
// colorIdx 6 = mid shell (550km alt, 6921km radius) → Cool white
// colorIdx 3 = high shell (1150km alt, 7521km radius) → Warm gold
fn shell_color(colorIdx:u32) -> vec3f {
  // colorIdx from orbital elements: 2=blue, 6=white, 3=gold
  if(colorIdx==2u){return vec3f(0.15,0.55,1.0);}   // Electric cyan-blue (low shell)
  if(colorIdx==6u){return vec3f(0.85,0.92,1.0);}    // Cool white (mid shell)
  if(colorIdx==3u){return vec3f(1.0,0.78,0.28);}    // Warm gold (high shell)
  // Fallback rainbow for variety
  let c = colorIdx % 7u;
  if(c==0u){return vec3f(1.0,0.18,0.18);}
  if(c==1u){return vec3f(0.18,1.0,0.18);}
  if(c==4u){return vec3f(0.1,1.0,1.0);}
  if(c==5u){return vec3f(1.0,0.1,1.0);}
  return vec3f(1.0,1.0,1.0);
}

// Shell-specific pulse speed: low=fast cyan flicker, mid=steady, high=slow warm glow
fn shell_pulse(colorIdx:u32, phase:f32, time:f32) -> f32 {
  if(colorIdx==2u){
    // Low shell: fast pulsing cyan
    return 0.4 + 0.6*(0.5 + 0.5*sin(phase*0.2 + time*2.5));
  }
  if(colorIdx==6u){
    // Mid shell: steady white with subtle variation
    return 0.7 + 0.3*(0.5 + 0.5*sin(phase*0.1 + time*0.6));
  }
  if(colorIdx==3u){
    // High shell: slow warm glow with longer persistence
    return 0.5 + 0.5*(0.5 + 0.5*sin(phase*0.08 + time*0.35));
  }
  // Fallback
  return 0.35 + 0.65*(0.5 + 0.5*sin(phase*0.15 + time*0.8));
}

@vertex fn vs(
  @builtin(vertex_index)   vi : u32,
  @builtin(instance_index) ii : u32,
) -> VOut {
  let pd      = sat_pos[ii];
  let wp      = pd.xyz;
  let cdat    = pd.w;
  let cam     = uni.camera_pos.xyz;
  let dist    = length(wp - cam);

  const EARTH_RADIUS_KM: f32 = 6371.0;

  var visible = true;
  if (dist > 180000.0) { visible = false; }
  if (visible) {
    for (var p=0u; p<6u; p++) {
      let pl = uni.frustum[p];
      if (dot(pl.xyz, wp) + pl.w < -200.0) { visible=false; break; }
    }
  }

  // Ground view: only show satellites above horizon
  if (visible && uni.is_ground_view != 0u) {
    let ray_dir = wp - cam;
    let ray_len_sq = dot(ray_dir, ray_dir);
    let a = ray_len_sq;
    let b = 2.0 * dot(cam, ray_dir);
    let c = dot(cam, cam) - EARTH_RADIUS_KM * EARTH_RADIUS_KM;
    let discriminant = b * b - 4.0 * a * c;
    if (discriminant >= 0.0) {
      let sqrt_disc = sqrt(discriminant);
      let t1 = (-b - sqrt_disc) / (2.0 * a);
      let t2 = (-b + sqrt_disc) / (2.0 * a);
      if ((t1 > 0.0 && t1 < 1.0) || (t2 > 0.0 && t2 < 1.0)) {
        visible = false;
      }
    }
  }

  var o : VOut;
  if (!visible) {
    o.cp     = vec4f(10,10,10,1);
    o.uv     = vec2f(0);
    o.color  = vec3f(0);
    o.bright = 0.0;
    return o;
  }

  // Distance-adaptive billboard sizing with sqrt falloff
  // Tuned for multiple scales: God View (60k km), Horizon (few k), Fleet POV (close)
  var bsize = 900.0 / sqrt(max(dist, 60.0));
  bsize = clamp(bsize, 0.5, 90.0);
  
  // Fleet POV (view_mode 2): enlarge nearby satellites for cinematic feel
  if (uni.view_mode == 2u && dist < 500.0) {
    bsize = bsize * (1.0 + smoothstep(500.0, 50.0, dist) * 1.5);
  }

  const quad = array<vec2f,6>(
    vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),
    vec2f(-1, 1),vec2f(1,-1),vec2f( 1,1));

  let qv     = quad[vi];
  let right  = uni.camera_right.xyz;
  let up     = uni.camera_up.xyz;
  let offset = (qv.x*right + qv.y*up) * bsize;
  let fpos   = wp + offset;

  let cidx    = u32(abs(cdat)) % 7u;
  var col     = shell_color(cidx);
  let pattern = shell_pulse(cidx, cdat*0.15 + f32(ii)*0.000613, uni.time);

  let atten   = 1.0/(1.0 + dist*0.0006);
  var bright  = pattern * atten;

  // RGB blinking test pattern for ground view
  if (uni.is_ground_view != 0u) {
    let test_phase = uni.time * 2.0 + f32(ii) * 0.001;
    let cycle = fract(test_phase);
    if (cycle < 0.33) {
      col = vec3f(1.0, 0.0, 0.0);
    } else if (cycle < 0.66) {
      col = vec3f(0.0, 1.0, 0.0);
    } else {
      col = vec3f(0.0, 0.0, 1.0);
    }
    bright = 2.0;
  }

  o.cp     = uni.view_proj * vec4f(fpos,1);
  o.uv     = (qv + 1.0)*0.5;
  o.color  = col;
  o.bright = bright;
  return o;
}

@fragment fn fs(in:VOut) -> @location(0) vec4f {
  let d     = length(in.uv - 0.5)*2.0;
  if (d > 1.0) { discard; }
  let ring  = 1.0 - smoothstep(0.5,1.0,d);
  let core  = 1.0 - smoothstep(0.0,0.18,d);
  let alpha = ring * in.bright;
  let hdr   = in.color * (ring + core*2.8) * in.bright * 3.0;
  return vec4f(hdr, alpha);
}
`;

/** Bloom threshold shader */
export const BLOOM_THRESHOLD_SHADER = /* wgsl */ `
@group(0) @binding(0) var tex : texture_2d<f32>;
@group(0) @binding(1) var smp : sampler;

struct VSOut { @builtin(position) pos:vec4f, @location(0) uv:vec2f }

@vertex fn vs(@builtin(vertex_index) vi:u32) -> VSOut {
  const pts = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
  var o:VSOut; o.pos=vec4f(pts[vi],0,1); o.uv=pts[vi]*0.5+0.5; return o;
}

@fragment fn fs(in:VSOut) -> @location(0) vec4f {
  var uv = in.uv; uv.y = 1.0-uv.y;
  let c   = textureSample(tex,smp,uv).rgb;
  let lum = dot(c,vec3f(0.2126,0.7152,0.0722));
  let t   = smoothstep(0.75,1.4,lum);
  return vec4f(c*t,1.0);
}
`;

/** Beam compute shader - generates beam positions from satellites with logo patterns */
export const BEAM_COMPUTE_SHADER = UNIFORM_STRUCT + /* wgsl */ `
struct Beam {
  start : vec4f,  // xyz = sat pos, w = intensity (0-1)
  end   : vec4f,  // xyz = target pos, w = hue (0-360)
};

struct BeamParams {
  time : f32,
  patternMode : u32,
  density : u32,
  pad : u32,
};

@group(0) @binding(1) var<storage, read> sat_pos : array<vec4f>;
@group(0) @binding(2) var<storage, read_write> beams : array<Beam>;
@group(0) @binding(3) var<uniform> beamParams : BeamParams;

const EARTH_RADIUS_KM : f32 = 6371.0;
const MAX_BEAMS : u32 = 65536u;
const SATELLITE_STRIDE : u32 = 16u;  // Every 16th satellite

// "GROK" text pattern using SDF (simplified - just dots forming letters)
// This is a procedural approximation - coordinates in UV space (0-1)
fn getLetterOffset(letterIdx: u32, t: f32) -> vec2f {
  // Simple letter shapes as point clouds
  // G = 0, R = 1, O = 2, K = 3
  let phase = fract(t * 0.5 + f32(letterIdx) * 0.25);
  
  // Return offset within letter (0-1 range)
  return vec2f(
    fract(phase * 7.0),  // x varies within letter
    fract(phase * 3.0)   // y varies within letter
  );
}

// Procedural "GROK" pattern - returns 0-1 mask value
fn logoPattern(uv: vec2f, t: f32) -> f32 {
  // GROK positioned across the night side
  // UV coordinates on Earth's surface (lat/lon mapping)
  
  let x = uv.x;
  let y = uv.y;
  
  // Letter positions (left to right)
  // G: 0.1-0.25, R: 0.3-0.45, O: 0.5-0.65, K: 0.7-0.85
  
  var intensity = 0.0;
  
  // G shape
  if (x > 0.1 && x < 0.25) {
    let gx = (x - 0.1) / 0.15;
    let gy = y;
    // G is a C with a crossbar
    let inG = (abs(gx - 0.5) < 0.4 && abs(gy - 0.5) < 0.4) && 
              !(gx > 0.3 && gy > 0.2 && gy < 0.5 && gx < 0.7);
    if (inG) { intensity = 1.0; }
  }
  
  // R shape  
  if (x > 0.3 && x < 0.45) {
    let rx = (x - 0.3) / 0.15;
    let ry = y;
    // Vertical + curve + leg
    let inR = (rx < 0.3) || // vertical
              (abs(rx - 0.5) < 0.25 && abs(ry - 0.65) < 0.25) || // loop
              (rx > 0.4 && ry < 0.5); // leg
    if (inR) { intensity = 1.0; }
  }
  
  // O shape
  if (x > 0.5 && x < 0.65) {
    let ox = (x - 0.5) / 0.15;
    let oy = y;
    let d = length(vec2f(ox - 0.5, oy - 0.5));
    if (d > 0.25 && d < 0.45) { intensity = 1.0; }
  }
  
  // K shape
  if (x > 0.7 && x < 0.85) {
    let kx = (x - 0.7) / 0.15;
    let ky = y;
    // Vertical + two diagonals
    let inK = (kx < 0.3) || // vertical
              (abs(ky - (1.0 - kx * 0.8)) < 0.15) || // upper diag
              (abs(ky - (0.2 + kx * 0.6)) < 0.15);    // lower diag
    if (inK) { intensity = 1.0; }
  }
  
  return intensity;
}

// X logo pattern
fn xLogoPattern(uv: vec2f) -> f32 {
  let x = uv.x;
  let y = uv.y;
  
  // Two crossing diagonals
  let diag1 = abs((y - 0.5) - (x - 0.5));
  let diag2 = abs((y - 0.5) + (x - 0.5));
  
  if (diag1 < 0.1 || diag2 < 0.1) {
    return 1.0;
  }
  return 0.0;
}

// Convert direction to UV coordinates on Earth surface
fn dirToUV(dir: vec3f) -> vec2f {
  // dir is normalized position on sphere
  // lat = asin(dir.z), lon = atan2(dir.y, dir.x)
  let lat = asin(clamp(dir.z, -1.0, 1.0));
  let lon = atan2(dir.y, dir.x);
  
  // Map to 0-1 UV
  return vec2f(
    fract(lon / (3.14159 * 2.0) + 0.5),
    lat / 3.14159 + 0.5
  );
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  if (i >= MAX_BEAMS) { return; }
  
  let satIdx = i * SATELLITE_STRIDE;
  if (satIdx >= 1048576u) { 
    beams[i].start.w = 0.0;
    return; 
  }
  
  let sat = sat_pos[satIdx];
  let pos = sat.xyz;
  let dir = normalize(pos);
  
  // Base target: Earth surface along radial line
  let earthTarget = dir * EARTH_RADIUS_KM;
  
  var finalTarget = earthTarget;
  var hue = 0.0;
  var intensity = 0.9;
  
  let t = beamParams.time;
  let patternMode = beamParams.patternMode;
  
  // Pattern logic
  if (patternMode == 0u) {
    // Chaos mode - random motion
    let chaos = vec3f(
      sin(t + f32(i) * 0.1) * 50.0,
      cos(t * 0.7 + f32(i) * 0.13) * 50.0,
      sin(t * 0.3 + f32(i) * 0.07) * 30.0
    );
    finalTarget = earthTarget + chaos;
    hue = fract(t * 0.03 + f32(i) * 0.0001) * 360.0;
  }
  else if (patternMode == 1u) {
    // GROK logo mode
    let uv = dirToUV(dir);
    let mask = logoPattern(uv, t);
    
    if (mask > 0.5) {
      // Beam is part of logo - bright white/cyan
      hue = 180.0 + sin(t + f32(i) * 0.01) * 30.0; // Cyan range
      intensity = 1.0;
    } else {
      // Dim background beams
      hue = fract(t * 0.01 + f32(i) * 0.001) * 360.0;
      intensity = 0.3;
    }
    
    // Add subtle wave motion to logo
    let wave = sin(t * 2.0 + uv.x * 10.0) * 20.0;
    finalTarget = earthTarget + dir * wave;
  }
  else if (patternMode == 2u) {
    // X logo mode
    let uv = dirToUV(dir);
    let mask = xLogoPattern(uv);
    
    if (mask > 0.5) {
      hue = 0.0; // Red
      intensity = 1.0;
    } else {
      intensity = 0.0; // Hide non-X beams
    }
  }
  
  beams[i].start = vec4f(pos, intensity);
  beams[i].end = vec4f(finalTarget, hue);
}
`;

/** Beam render shader - instanced camera-aligned ribbons */
export const BEAM_RENDER_SHADER = UNIFORM_STRUCT + /* wgsl */ `
struct Beam {
  start : vec4f,
  end   : vec4f,
};

@group(0) @binding(1) var<storage, read> beams : array<Beam>;

struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) lineCoord : vec2f,
  @location(1) intensity : f32,
  @location(2) hue : f32,
};

fn hsl_to_rgb(h: f32, s: f32, l: f32) -> vec3f {
  let hf = h / 360.0;
  let c = (1.0 - abs(2.0 * l - 1.0)) * s;
  let x = c * (1.0 - abs(fract(hf * 6.0) * 2.0 - 1.0));
  let m = l - c * 0.5;
  
  var rgb : vec3f;
  let hp = hf * 6.0;
  if (hp < 1.0) { rgb = vec3f(c, x, 0.0); }
  else if (hp < 2.0) { rgb = vec3f(x, c, 0.0); }
  else if (hp < 3.0) { rgb = vec3f(0.0, c, x); }
  else if (hp < 4.0) { rgb = vec3f(0.0, x, c); }
  else if (hp < 5.0) { rgb = vec3f(x, 0.0, c); }
  else { rgb = vec3f(c, 0.0, x); }
  
  return rgb + m;
}

@vertex
fn vs_main(
  @builtin(instance_index) inst : u32,
  @builtin(vertex_index) vtx : u32
) -> VSOut {
  let beam = beams[inst];
  
  if (beam.start.w <= 0.0) {
    var dummy : VSOut;
    dummy.pos = vec4f(0.0);
    return dummy;
  }
  
  let start = beam.start.xyz;
  let end = beam.end.xyz;
  let hue = beam.end.w;
  
  let dir = end - start;
  let len = length(dir);
  let dirN = dir / len;
  
  // Camera-facing basis
  let toCam = normalize(uni.camera_pos.xyz - start);
  let right = normalize(cross(dirN, toCam));
  
  // vtx: 0=BL, 1=BR, 2=TL, 3=TR
  let along = f32(vtx / 2u);
  let across = f32(vtx % 2u) * 2.0 - 1.0;
  
  let width = 9.5;  // km - tuned for optimal bloom
  let worldPos = start + dir * along + right * (across * width * 0.5);
  
  var out : VSOut;
  out.pos = uni.view_proj * vec4f(worldPos, 1.0);
  out.lineCoord = vec2f(along, across);
  out.intensity = beam.start.w;
  out.hue = hue;
  return out;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4f {
  let dist = abs(in.lineCoord.y);
  // Softer edge falloff for more realistic energy beam look
  let edgeAlpha = 1.0 - smoothstep(0.0, 0.85, dist);
  // Add a bright core
  let core = 1.0 - smoothstep(0.0, 0.25, dist);
  
  let col = hsl_to_rgb(in.hue, 0.85, 0.55);
  var hdrCol = col * in.intensity * 6.0;
  // Bright core adds white-hot center
  hdrCol += vec3f(1.0, 0.95, 0.9) * core * in.intensity * 3.0;
  
  // Logo beams get extra intensity
  if (in.intensity > 0.9) {
    hdrCol *= 1.4;
  }
  
  let alpha = edgeAlpha * edgeAlpha * 0.95 * in.intensity;
  return vec4f(hdrCol, alpha);
}
`;

/** Bloom blur shader */
export const BLOOM_BLUR_SHADER = /* wgsl */ `
struct BlurUni { texel:vec2f, horizontal:u32, pad:u32 }
@group(0) @binding(0) var<uniform> buni : BlurUni;
@group(0) @binding(1) var tex : texture_2d<f32>;
@group(0) @binding(2) var smp : sampler;

struct VSOut { @builtin(position) pos:vec4f, @location(0) uv:vec2f }

@vertex fn vs(@builtin(vertex_index) vi:u32) -> VSOut {
  const pts = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
  var o:VSOut; o.pos=vec4f(pts[vi],0,1); o.uv=pts[vi]*0.5+0.5; return o;
}

@fragment fn fs(in:VSOut) -> @location(0) vec4f {
  var uv = in.uv; uv.y = 1.0-uv.y;
  let d  = select(vec2f(0,buni.texel.y), vec2f(buni.texel.x,0), buni.horizontal != 0u);
  const W = array<f32,5>(0.2270,0.1945,0.1216,0.0540,0.0162);
  var c   = textureSample(tex,smp,uv).rgb * W[0];
  for (var i=1; i<5; i++) {
    let off = f32(i)*d;
    c += textureSample(tex,smp,uv+off).rgb * W[i];
    c += textureSample(tex,smp,uv-off).rgb * W[i];
  }
  return vec4f(c,1.0);
}
`;

/** Ground terrain shader - mountains and lake for ground view */
export const GROUND_TERRAIN_SHADER = UNIFORM_STRUCT + /* wgsl */ `
struct VSOut { @builtin(position) pos:vec4f, @location(0) uv:vec2f }

@vertex fn vs(@builtin(vertex_index) vi:u32) -> VSOut {
  const pts = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
  var o:VSOut;
  o.pos = vec4f(pts[vi], 0.9999, 1); // Near plane depth
  o.uv = pts[vi]*0.5 + 0.5;
  return o;
}

// Simplex noise functions
fn hash3(p:vec2f)->vec3f {
  let q = vec3f(dot(p,vec2f(127.1,311.7)), dot(p,vec2f(269.5,183.3)), dot(p,vec2f(419.2,371.9)));
  return fract(sin(q)*43758.5453);
}

fn noise(p:vec2f)->f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f*f*(3.0-2.0*f);
  
  let n = mix(
    mix(dot(hash3(i+vec2f(0,0))-0.5, vec3f(f.x,f.y,0)), dot(hash3(i+vec2f(1,0))-0.5, vec3f(f.x-1.0,f.y,0)), u.x),
    mix(dot(hash3(i+vec2f(0,1))-0.5, vec3f(f.x,f.y-1.0,0)), dot(hash3(i+vec2f(1,1))-0.5, vec3f(f.x-1.0,f.y-1.0,0)), u.x),
    u.y
  );
  return n*0.5 + 0.5;
}

fn fbm(p:vec2f)->f32 {
  var v = 0.0;
  var a = 0.5;
  var x = p;
  for(var i=0; i<5; i++) {
    v += a * noise(x);
    x *= 2.0;
    a *= 0.5;
  }
  return v;
}

@fragment fn fs(in:VSOut) -> @location(0) vec4f {
  let uv = in.uv;
  
  // Horizon line (around y=0.35)
  let horizonY = 0.35;
  let horizonDist = abs(uv.y - horizonY);
  
  // ===== BLUE SKY GRADIENT =====
  // Calculate view direction from UV (assuming fullscreen quad at near plane)
  let viewDir = normalize(vec3f(
    (uv.x - 0.5) * 2.0,  // horizontal spread
    (uv.y - 0.5) * -2.0, // vertical (flipped, -1 is up)
    -1.0                  // forward into screen
  ));
  
  // Sky gradient based on elevation angle (dot with up vector)
  let up = vec3f(0.0, 1.0, 0.0);
  let elevation = dot(viewDir, up);
  
  // Rayleigh scattering approximation
  let skyZenith = vec3f(0.2, 0.5, 0.95);      // Deep blue at top
  let skyHorizon = vec3f(0.7, 0.85, 1.0);     // Light blue/white at horizon
  let skyLow = vec3f(1.0, 0.6, 0.3);          // Orange/pink near horizon (sunset effect)
  
  // Blend based on elevation
  var skyColor : vec3f;
  if (elevation > 0.0) {
    // Above horizon: zenith to horizon
    skyColor = mix(skyHorizon, skyZenith, pow(elevation, 0.5));
  } else {
    // Below horizon: horizon to low
    skyColor = mix(skyLow, skyHorizon, smoothstep(-0.3, 0.0, elevation));
  }
  
  // Sun glow (simplified - assume sun at some angle)
  let sunDir = normalize(vec3f(0.3, 0.6, -0.7));
  let sunDot = dot(viewDir, sunDir);
  let sunGlow = pow(max(0.0, sunDot), 256.0) * 2.0;
  let sunScatter = pow(max(0.0, sunDot), 8.0) * 0.3;
  skyColor += vec3f(1.0, 0.95, 0.8) * (sunGlow + sunScatter);
  
  // Start with sky as background
  var finalColor = skyColor;
  var finalAlpha = 1.0;
  
  // Calculate mountain silhouette
  var mountainHeight = 0.0;
  var mountainY = horizonY;  // Default to horizon (no mountain)
  var terrainColor = skyColor;  // Start with sky
  
  if(uv.y < horizonY) {
    // Mountain silhouette using fbm noise
    let mx = uv.x * 4.0; // Scale horizontally
    let m1 = fbm(vec2f(mx, 0.0)) * 0.15;
    let m2 = fbm(vec2f(mx * 2.3, 10.0)) * 0.08;
    let m3 = fbm(vec2f(mx * 4.7, 20.0)) * 0.04;
    
    mountainHeight = m1 + m2 + m3;
    
    // Distance-based fade
    let dist = (horizonY - uv.y) / horizonY;
    mountainHeight *= smoothstep(0.0, 0.5, dist);
    
    // Mountain silhouette shape
    mountainY = horizonY - mountainHeight;
    
    if(uv.y <= mountainY) {
      // We're in the mountain terrain
      let height = (mountainY - uv.y) * 3.0;
      
      // Base mountain colors
      let darkRock = vec3f(0.08, 0.07, 0.1);
      let midRock = vec3f(0.15, 0.13, 0.18);
      let lightRock = vec3f(0.25, 0.22, 0.28);
      
      // Snow caps on peaks
      let snow = vec3f(0.9, 0.92, 0.95);
      let snowLine = 0.12 - fbm(vec2f(mx*0.5, 100.0))*0.08;
      
      if(mountainHeight > snowLine) {
        terrainColor = mix(midRock, snow, smoothstep(snowLine, snowLine+0.05, mountainHeight));
      } else {
        terrainColor = mix(darkRock, midRock, clamp(height*2.0, 0.0, 1.0));
      }
      
      // Add some detail noise
      let detail = noise(uv*vec2f(80.0, 40.0)) * 0.1;
      terrainColor += detail;
      
      // Atmospheric perspective - fade distant mountains
      let atmoFade = smoothstep(horizonY, 0.0, uv.y) * 0.3;
      terrainColor = mix(terrainColor, vec3f(0.3, 0.4, 0.6), atmoFade);
    }
  }
  
  // Lake in foreground (bottom portion)
  let lakeStart = 0.05;
  let lakeEnd = 0.25;
  
  if(uv.y >= lakeStart && uv.y <= lakeEnd) {
    // Lake depth gradient
    let lakeDepth = (uv.y - lakeStart) / (lakeEnd - lakeStart);
    
    // Shore fade at top of lake
    let shoreFade = smoothstep(lakeEnd, lakeEnd - 0.03, uv.y);
    
    if(shoreFade > 0.0) {
      
      // Base water color
      let deepWater = vec3f(0.02, 0.05, 0.12);
      let shallowWater = vec3f(0.05, 0.12, 0.22);
      let waterColor = mix(deepWater, shallowWater, lakeDepth);
      
      // Reflection of mountains
      let reflectY = horizonY - (uv.y - lakeStart) * 0.8;
      let mx = uv.x * 4.0;
      let m1 = fbm(vec2f(mx, 0.0)) * 0.15;
      let m2 = fbm(vec2f(mx * 2.3, 10.0)) * 0.08;
      var reflectHeight = m1 + m2;
      reflectHeight *= smoothstep(0.0, 0.5, (horizonY - reflectY) / horizonY);
      let reflectMountainY = horizonY - reflectHeight;
      
      // Reflection color
      var reflectColor = vec3f(0.12, 0.1, 0.14);
      if(reflectY < reflectMountainY) {
        reflectColor = vec3f(0.15, 0.13, 0.18);
      }
      
      // Mix water with reflection
      let reflectivity = 0.4 * (1.0 - lakeDepth * 0.5);
      terrainColor = mix(waterColor, reflectColor * 0.6, reflectivity);
      
      // Add ripples
      var ripple = sin(uv.x * 80.0 + uni.time * 2.0) * sin(uv.y * 60.0 + uni.time * 1.5);
      ripple = ripple * 0.5 + 0.5;
      terrainColor += vec3f(ripple * 0.02);
      
      // Apply shore fade
      terrainColor *= shoreFade;
    }
  }
  
  // Horizon glow (subtle atmospheric effect)
  let horizonGlow = smoothstep(0.02, 0.0, horizonDist) * 0.2;
  terrainColor += vec3f(0.1, 0.15, 0.25) * horizonGlow;
  
  // Blend terrain with sky based on whether we drew terrain
  var resultColor = skyColor;
  if (uv.y < horizonY && uv.y <= mountainY) {
    // Solid terrain area
    resultColor = terrainColor;
  } else if (uv.y >= lakeStart && uv.y <= lakeEnd && uv.y <= (horizonY - 0.02)) {
    // Lake area
    let shoreFade = smoothstep(lakeEnd, lakeEnd - 0.03, uv.y);
    resultColor = mix(skyColor, terrainColor, shoreFade);
  }
  
  return vec4f(resultColor, 1.0);
}
`;

/** Composite + tonemapping shader with cinematic teal-orange grading */
export const COMPOSITE_SHADER = /* wgsl */ `
@group(0) @binding(0) var scene_tex : texture_2d<f32>;
@group(0) @binding(1) var bloom_tex : texture_2d<f32>;
@group(0) @binding(2) var smp       : sampler;

struct VSOut { @builtin(position) pos:vec4f, @location(0) uv:vec2f }

@vertex fn vs(@builtin(vertex_index) vi:u32) -> VSOut {
  const pts = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
  var o:VSOut; o.pos=vec4f(pts[vi],0,1); o.uv=pts[vi]*0.5+0.5; return o;
}

fn aces(x:vec3f)->vec3f {
  let a=2.51; let b=0.03; let c=2.43; let d=0.59; let e=0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e),vec3f(0),vec3f(1));
}

@fragment fn fs(in:VSOut) -> @location(0) vec4f {
  var uv = in.uv; uv.y = 1.0-uv.y;
  let scene = textureSample(scene_tex,smp,uv).rgb;
  let bloom = textureSample(bloom_tex,smp,uv).rgb;
  let hdr   = scene + bloom*2.0;
  var col   = aces(hdr);
  
  // Cinematic teal-orange color grading (xAI / SpaceX palette)
  // Push shadows toward teal, highlights toward warm gold
  let lum = dot(col, vec3f(0.2126, 0.7152, 0.0722));
  let shadowTint = vec3f(0.05, 0.12, 0.15);  // Deep teal shadows
  let highlightTint = vec3f(0.12, 0.08, 0.02); // Warm gold highlights
  col += shadowTint * (1.0 - lum) * 0.15;
  col += highlightTint * lum * 0.1;
  
  // Subtle vignette for cinematic feel
  let vigUV = uv * 2.0 - 1.0;
  let vignette = 1.0 - dot(vigUV, vigUV) * 0.15;
  col *= vignette;
  
  return vec4f(col,1.0);
}
`;

/** Export all shaders as a collection */
export const SHADERS = {
  orbital: ORBITAL_CS,
  stars: STARS_SHADER,
  earth: EARTH_SHADER,
  atmosphere: ATM_SHADER,
  satellites: SAT_SHADER,
  groundTerrain: GROUND_TERRAIN_SHADER,
  beamCompute: BEAM_COMPUTE_SHADER,
  beamRender: BEAM_RENDER_SHADER,
  bloomThreshold: BLOOM_THRESHOLD_SHADER,
  bloomBlur: BLOOM_BLUR_SHADER,
  composite: COMPOSITE_SHADER,
} as const;

export default SHADERS;
