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
  pad0           : u32,
  frustum        : array<vec4f,6>,
  screen_size    : vec2f,
  pad1           : vec2f,
};
@group(0) @binding(0) var<uniform> uni : Uni;
`;

/** Orbital mechanics compute shader */
export const ORBITAL_CS = UNIFORM_STRUCT + /* wgsl */ `
@group(0) @binding(1) var<storage,read>       orb_elem : array<vec4f>;
@group(0) @binding(2) var<storage,read_write> sat_pos  : array<vec4f>;

const ORBIT_KM    : f32 = 6921.0;
const MEAN_MOTION : f32 = 0.001097;

@compute @workgroup_size(64,1,1)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  if (i >= 1048576u) { return; }

  let e    = orb_elem[i];
  let raan = e.x;
  let inc  = e.y;
  let m0   = e.z;
  let cdat = e.w;

  let M  = m0 + MEAN_MOTION * uni.time;
  let cM = cos(M); let sM = sin(M);
  let cR = cos(raan); let sR = sin(raan);
  let cI = cos(inc);  let sI = sin(inc);

  let x = ORBIT_KM * (cR*cM - sR*sM*cI);
  let y = ORBIT_KM * (sR*cM + cR*sM*cI);
  let z = ORBIT_KM * sM * sI;

  sat_pos[i] = vec4f(x, y, z, cdat);
}
`;

/** Starfield background shader */
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
  let cell  = floor(in.uv * 512.0);
  let h     = hash2(cell);
  let h2    = hash2(cell + vec2f(1.0,0.0));
  let h3    = hash2(cell + vec2f(0.0,1.0));
  let star  = f32(h > 0.994) * pow(h2,6.0);
  let color = mix(vec3f(0.6,0.8,1.0), vec3f(1.0,0.9,0.7), h3);
  return vec4f(color * star * 1.5, 1.0);
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

  let night = smoothstep(0.08,-0.08,dot(N,sun_dir));
  let city  = night * 0.025 * vec3f(1.0,0.85,0.4)
              * smoothstep(0.4,0.6,land)
              * (0.5+0.5*sin(lon*18.0+lat*14.0));

  return vec4f(lit+city,1.0);
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

/** Satellite billboard shader */
export const SAT_SHADER = UNIFORM_STRUCT + /* wgsl */ `
@group(0) @binding(1) var<storage,read> sat_pos : array<vec4f>;

struct VOut {
  @builtin(position) cp : vec4f,
  @location(0) uv       : vec2f,
  @location(1) color    : vec3f,
  @location(2) bright   : f32,
}

fn sat_color(idx:u32) -> vec3f {
  let c = idx % 7u;
  if(c==0u){return vec3f(1.0,0.18,0.18);}
  if(c==1u){return vec3f(0.18,1.0,0.18);}
  if(c==2u){return vec3f(0.25,0.45,1.0);}
  if(c==3u){return vec3f(1.0,1.0,0.1);}
  if(c==4u){return vec3f(0.1,1.0,1.0);}
  if(c==5u){return vec3f(1.0,0.1,1.0);}
  return vec3f(1.0,1.0,1.0);
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

  var visible = true;
  if (dist > 14000.0) { visible = false; }
  if (visible) {
    for (var p=0u; p<6u; p++) {
      let pl = uni.frustum[p];
      if (dot(pl.xyz, wp) + pl.w < -200.0) { visible=false; break; }
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

  let bsize = clamp(1200.0/max(dist,50.0), 0.4, 60.0);

  const quad = array<vec2f,6>(
    vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),
    vec2f(-1, 1),vec2f(1,-1),vec2f( 1,1));

  let qv     = quad[vi];
  let right  = uni.camera_right.xyz;
  let up     = uni.camera_up.xyz;
  let offset = (qv.x*right + qv.y*up) * bsize;
  let fpos   = wp + offset;

  let cidx    = u32(abs(cdat)) % 7u;
  let col     = sat_color(cidx);
  let phase   = cdat*0.15 + uni.time*(0.8+0.4*fract(f32(ii)*0.000613));
  let pattern = 0.35 + 0.65*(0.5 + 0.5*sin(phase));

  let atten   = 1.0/(1.0 + dist*0.00075);
  let bright  = pattern * atten;

  o.cp     = uni.view_proj * vec4f(fpos,1);
  o.uv     = (qv + 1.0)*0.5;
  o.color  = col;
  o.bright = bright;
  return o;
}

@fragment fn fs(in:VOut) -> @location(0) vec4f {
  let d     = length(in.uv - 0.5)*2.0;
  if (d > 1.0) { discard; }
  let ring  = 1.0 - smoothstep(0.55,1.0,d);
  let core  = 1.0 - smoothstep(0.0,0.22,d);
  let alpha = ring * in.bright;
  let hdr   = in.color * (ring + core*2.2) * in.bright * 2.8;
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
  
  // Sky gradient (top portion)
  let skyColor = mix(vec3f(0.0,0.02,0.08), vec3f(0.01,0.05,0.15), uv.y);
  
  // Horizon line (around y=0.35)
  let horizonY = 0.35;
  let horizonDist = abs(uv.y - horizonY);
  
  // Mountains - multiple layers with fbm
  var mountainHeight = 0.0;
  var mountainColor = vec3f(0.0);
  
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
    let mountainY = horizonY - mountainHeight;
    
    if(uv.y > mountainY) {
      // Sky area above mountains
      mountainColor = skyColor;
    } else {
      // Mountain terrain
      let height = (mountainY - uv.y) * 3.0;
      
      // Base mountain colors
      let darkRock = vec3f(0.08, 0.07, 0.1);
      let midRock = vec3f(0.15, 0.13, 0.18);
      let lightRock = vec3f(0.25, 0.22, 0.28);
      
      // Snow caps on peaks
      let snow = vec3f(0.9, 0.92, 0.95);
      let snowLine = 0.12 - fbm(vec2f(mx*0.5, 100.0))*0.08;
      
      if(mountainHeight > snowLine) {
        mountainColor = mix(midRock, snow, smoothstep(snowLine, snowLine+0.05, mountainHeight));
      } else {
        mountainColor = mix(darkRock, midRock, clamp(height*2.0, 0.0, 1.0));
      }
      
      // Add some detail noise
      let detail = noise(uv*vec2f(80.0, 40.0)) * 0.1;
      mountainColor += detail;
    }
  }
  
  // Lake in foreground (bottom portion)
  var lakeColor = vec3f(0.0);
  var showLake = false;
  
  let lakeStart = 0.05;
  let lakeEnd = 0.25;
  
  if(uv.y >= lakeStart && uv.y <= lakeEnd) {
    showLake = true;
    
    // Lake depth gradient
    let lakeDepth = (uv.y - lakeStart) / (lakeEnd - lakeStart);
    
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
    lakeColor = mix(waterColor, reflectColor * 0.6, reflectivity);
    
    // Add ripples
    var ripple = sin(uv.x * 80.0 + uni.time * 2.0) * sin(uv.y * 60.0 + uni.time * 1.5);
    ripple = ripple * 0.5 + 0.5;
    lakeColor += vec3f(ripple * 0.02);
    
    // Shore fade at top of lake
    let shoreFade = smoothstep(lakeEnd, lakeEnd - 0.03, uv.y);
    lakeColor *= shoreFade;
  }
  
  // Combine elements
  var finalColor = skyColor;
  
  if(uv.y < horizonY) {
    finalColor = mountainColor;
  }
  
  if(showLake) {
    // Blend lake with mountains at horizon
    let lakeBlend = smoothstep(lakeEnd, lakeStart, uv.y);
    finalColor = mix(finalColor, lakeColor, lakeBlend);
  }
  
  // Horizon glow
  let horizonGlow = smoothstep(0.02, 0.0, horizonDist) * 0.3;
  finalColor += vec3f(0.1, 0.15, 0.25) * horizonGlow;
  
  // Atmospheric perspective - fade distant mountains
  if(uv.y < horizonY && !showLake) {
    let atmoFade = smoothstep(horizonY, 0.0, uv.y) * 0.3;
    finalColor = mix(finalColor, vec3f(0.3, 0.4, 0.6), atmoFade);
  }
  
  return vec4f(finalColor, 1.0);
}
`;

/** Composite + tonemapping shader */
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
  let hdr   = scene + bloom*1.8;
  return vec4f(aces(hdr),1.0);
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
  bloomThreshold: BLOOM_THRESHOLD_SHADER,
  bloomBlur: BLOOM_BLUR_SHADER,
  composite: COMPOSITE_SHADER,
} as const;

export default SHADERS;
