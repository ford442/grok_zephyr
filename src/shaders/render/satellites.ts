/**
 * Satellite Billboard Shader
 * Lens flare glow, shell differentiation, solar panel glint
 */

import { UNIFORM_STRUCT } from '../uniforms.js';

export const SATELLITE_SHADER = UNIFORM_STRUCT + /* wgsl */ `
@group(0) @binding(1) var<storage, read> sat_pos : array<vec4f>;

struct VOut {
  @builtin(position) cp : vec4f,
  @location(0) uv       : vec2f,
  @location(1) color    : vec3f,
  @location(2) bright   : f32,
  @location(3) shell    : f32,
};

const PI: f32 = 3.14159265;

fn sat_color(idx: u32) -> vec3f {
  let c = idx % 7u;
  switch c {
    case 0u: { return vec3f(1.0, 0.18, 0.18); }
    case 1u: { return vec3f(0.18, 1.0, 0.18); }
    case 2u: { return vec3f(0.25, 0.45, 1.0); }
    case 3u: { return vec3f(1.0, 1.0, 0.1); }
    case 4u: { return vec3f(0.1, 1.0, 1.0); }
    case 5u: { return vec3f(1.0, 0.1, 1.0); }
    default: { return vec3f(1.0, 1.0, 1.0); }
  }
}

// Shell color temperature shifts
fn shellColorShift(shell: u32) -> vec3f {
  switch shell {
    case 0u: { return vec3f(1.0, 0.85, 0.6); }   // LEO: warm amber
    case 1u: { return vec3f(1.0, 1.0, 1.0); }     // Mid: neutral white
    case 2u: { return vec3f(0.7, 0.85, 1.0); }    // High: cool cyan
    default: { return vec3f(1.0, 1.0, 1.0); }
  }
}

fn shellSizeScale(shell: u32) -> f32 {
  switch shell {
    case 0u: { return 0.8; }    // LEO: smaller, tighter
    case 1u: { return 1.0; }    // Mid: reference
    case 2u: { return 1.3; }    // High: larger, diffuse
    default: { return 1.0; }
  }
}

// Simple hash for glint calculation
fn hash_u32(n: u32) -> f32 {
  var x = n;
  x = x ^ (x >> 16u);
  x = x * 0x45d9f3bu;
  x = x ^ (x >> 16u);
  return f32(x & 0xFFFFu) / 65535.0;
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

  const quad = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0,  1.0), vec2f(1.0, -1.0), vec2f( 1.0, 1.0)
  );

  let qv = quad[vi];
  let right = uni.camera_right.xyz;
  let up = uni.camera_up.xyz;

  // Shell detection from instance index (~1M satellites / 3 shells = 349525 per shell)
  let shellIdx = ii / 349525u;
  let shellSize = shellSizeScale(shellIdx);

  // Increased max distance from 14000 to 150000 to support ground/Moon views
  let bsize = clamp(1200.0 / max(dist, 50.0), 0.4, 60.0) *
              select(0.0, 1.0, dist < 150000.0) * shellSize;
  let offset = (qv.x * right + qv.y * up) * bsize;
  let fpos = wp + offset;

  let baseColor = sat_color(u32(abs(cdat)) % 7u);
  let shellTint = shellColorShift(shellIdx);
  let col = baseColor * shellTint;

  let phase = cdat * 0.15 + uni.time * 0.8;
  let pattern = 0.35 + 0.65 * (0.5 + 0.5 * sin(phase));
  let atten = 1.0 / (1.0 + dist * 0.00075);

  // Solar panel glint simulation
  let glintHash = hash_u32(ii);
  let glintPhase = fract(uni.time * 0.1 + glintHash * 10.0);
  let glintAlignment = 1.0 - abs(glintPhase - 0.5) * 2.0;
  let glint = pow(glintAlignment, 8.0) * 0.8;

  var out: VOut;
  out.cp = uni.view_proj * vec4f(fpos, 1.0);
  out.uv = (qv + 1.0) * 0.5;
  out.color = col;
  out.bright = pattern * atten + glint * atten;
  out.shell = f32(shellIdx);
  return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let centered = in.uv - 0.5;
  let d = length(centered) * 2.0;
  if (d > 1.0) { discard; }

  let angle = atan2(centered.y, centered.x);

  // Core glow (Gaussian)
  let core = exp(-d * d * 8.0);

  // Multi-octave halos (lens flare rings)
  var halos = 0.0;
  halos += exp(-pow((d - 0.25) / 0.08, 2.0)) * 0.4;
  halos += exp(-pow((d - 0.50) / 0.06, 2.0)) * 0.2;
  halos += exp(-pow((d - 0.75) / 0.05, 2.0)) * 0.1;

  // 4-point diffraction spikes
  let spike = pow(abs(cos(angle * 2.0)), 16.0) * exp(-d * 3.0) * 0.4;

  // Outer glow falloff
  let outerGlow = exp(-d * 2.5) * 0.3;

  // Shell-dependent glow width (shells clamped to [0,2] range)
  let shellGlowMod = mix(1.2, 0.7, clamp(in.shell, 0.0, 2.0) / 2.0);
  let total = (core * 2.0 + halos * shellGlowMod + spike + outerGlow) * in.bright;

  // Color: core white-hot, edges colored
  let coreWhite = vec3f(1.0, 1.0, 1.0);
  let finalColor = mix(in.color, coreWhite, core * 0.6);

  let hdr = finalColor * total * 2.8;
  let alpha = clamp(total, 0.0, 1.0);

  return vec4f(hdr, alpha);
}
`;
