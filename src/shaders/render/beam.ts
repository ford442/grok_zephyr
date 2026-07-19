/**
 * Laser Beam Shader — pattern-distinct ribbon beams with per-view intensity.
 *
 * Pattern personality (0=CHAOS, 1=GROK, 2=𝕏 LOGO):
 * - CHAOS: desaturated cyan-white, crackle travel, dropout flicker, wide thickness
 * - GROK: green-teal gradient, synchronized radial sweep band
 * - 𝕏 LOGO: magenta-white segmented strokes, sharp geometric gate
 *
 * Per-view scale via viewBeamScale() — keep in sync with BeamPatternProfile.ts.
 */

import { UNIFORM_STRUCT } from '../uniforms.js';

export const BEAM_SHADER =
  UNIFORM_STRUCT +
  /* wgsl */ `
@group(0) @binding(1) var<storage, read> beams : array<vec4f>;

struct VOut {
  @builtin(position) cp: vec4f,
  @location(0) uv: vec2f,
  @location(1) intensity: f32,
  @location(2) mode: f32,
  @location(3) atmScatter: f32,
};

fn viewBeamScale(viewFlags: u32) -> f32 {
  let vm = viewFlags & 0xFFFFu;
  switch vm {
    case 2u: { return 0.4; }   // Fleet POV
    case 3u: { return 0.6; }   // Ground
    case 4u: { return 1.3; }   // Moon
    case 5u: { return 0.75; }  // Skyline
    case 1u: { return 1.0; }   // God
    default: { return 0.95; } // Horizon
  }
}

fn beamPalette(mode: u32, uvX: f32) -> vec3f {
  switch mode {
    case 0u: {
      // CHAOS — desaturated cyan-white lightning with occasional dropout.
      let flick = 0.88 + 0.12 * sin(uvX * 38.0 + uni.time * 23.0);
      let gray = vec3f(0.62, 0.80, 0.90);
      return mix(gray, vec3f(0.78, 0.90, 0.96), flick * 0.35);
    }
    case 1u: {
      // GROK — green-teal brand gradient along the beam.
      return mix(vec3f(0.06, 0.94, 0.58), vec3f(0.10, 0.74, 0.90), uvX);
    }
    case 2u: {
      // 𝕏 LOGO — magenta core, white hot edges.
      let edge = pow(max(0.0, 1.0 - abs(uvX - 0.5) * 2.0), 0.55);
      return mix(vec3f(1.0, 0.22, 0.68), vec3f(1.0, 0.96, 1.0), edge);
    }
    default: { return vec3f(0.6, 0.9, 1.0); }
  }
}

fn ribbonEdge(mode: u32, uvY: f32) -> f32 {
  let dist = abs(uvY - 0.5) * 2.0;
  let power = select(select(3.0, 4.8, mode == 2u), 2.2, mode == 0u);
  return pow(max(0.0, 1.0 - dist), power);
}

fn patternTravel(mode: u32, uvX: f32, t: f32) -> f32 {
  switch mode {
    case 0u: {
      let a = fract(t * 5.8 + uvX * 4.2 + sin(t * 17.3) * 0.3);
      let b = fract(t * 9.1 - uvX * 2.7);
      let crackle = step(0.78, fract(sin(uvX * 127.0 + t * 41.0) * 43758.5453));
      let dropout = step(0.88, fract(sin(t * 19.0 + uvX * 71.0) * 9123.17));
      return max(
        max(smoothstep(0.42, 0.0, abs(a - 0.5)), smoothstep(0.38, 0.0, abs(b - 0.5))),
        crackle * 0.65,
      ) * (1.0 - dropout * 0.45);
    }
    case 1u: {
      let sweep = fract(t * 1.25 - uvX * 0.92);
      let ring = 0.5 + 0.5 * sin(uvX * 22.0 - t * 3.6);
      let band = smoothstep(0.28, 0.0, abs(sweep - 0.5));
      return band * (0.55 + 0.45 * ring);
    }
    case 2u: {
      let seg = fract(uvX * 10.0);
      let stroke = smoothstep(0.18, 0.0, abs(seg - 0.5));
      let gate = step(0.42, sin(t * 8.4 + floor(uvX * 10.0) * 1.9));
      let edge = pow(max(0.0, 1.0 - abs(seg - 0.5) * 2.0), 0.42);
      return gate * stroke * (0.65 + 0.35 * edge);
    }
    default: {
      return smoothstep(0.0, 0.08, 0.08 - abs(fract(t * 3.4 - uvX * 2.6) - 0.5));
    }
  }
}

fn patternPulse(mode: u32, uvX: f32, t: f32) -> f32 {
  switch mode {
    case 0u: {
      let flicker = sin(t * 21.0 + uvX * 53.0) * sin(t * 33.0 - uvX * 19.0);
      return 0.42 + 0.58 * (0.5 + 0.5 * flicker);
    }
    case 1u: {
      return 0.58 + 0.42 * (0.5 + 0.5 * sin(t * 2.8 - uvX * 1.1));
    }
    case 2u: {
      let gate = sin(t * 7.2 - uvX * 3.8);
      return 0.38 + 0.62 * smoothstep(0.1, 0.92, 0.5 + 0.5 * gate);
    }
    default: {
      return 0.6 + 0.4 * sin(t * 8.0 - uvX * 10.0);
    }
  }
}

fn groundProjectionTint(color: vec3f, viewFlags: u32, atmScatter: f32) -> vec3f {
  let isSurface = ((viewFlags >> 16u) & 1u) == 1u || (viewFlags & 0xFFFFu) == 5u;
  if (!isSurface) { return color; }

  // Beams grazing the night atmosphere pick up warm Mie forward-scatter — sky
  // projections, not tight laser pointers.
  let mieAmt = smoothstep(0.02, 0.55, atmScatter) * 0.72;
  let mieWarm = vec3f(1.0, 0.68, 0.32);
  let skyCool = vec3f(0.48, 0.68, 1.0);
  let scatterCol = mix(mieWarm, skyCool, smoothstep(0.2, 0.8, atmScatter));
  var outCol = mix(color, color * scatterCol, mieAmt) + scatterCol * mieAmt * 0.28;
  // Horizon haze — soften beam cores into the night sky dome.
  let haze = smoothstep(0.35, 0.92, atmScatter) * 0.22;
  outCol = mix(outCol, scatterCol * 0.55, haze);
  return outCol;
}

@vertex
fn beam_vs(beamIdx: u32, vi: u32) -> VOut {
  var out: VOut;
  let quad = vi & 3u;
  let step = quad >> 1u;
  let sideSign = select(-1.0, 1.0, (quad & 1u) == 1u);
  let t = f32(step);

  let start = beams[beamIdx * 2u];
  let end = beams[beamIdx * 2u + 1u];
  let p0 = start.xyz;
  let p1 = end.xyz;
  let beamMode = u32(end.w);
  let beamDir = normalize(p1 - p0 + vec3f(0.0001, 0.0, 0.0));
  var offsetDir = normalize(cross(beamDir, uni.camera_up.xyz));
  if (length(offsetDir) < 0.0001) {
    offsetDir = normalize(cross(beamDir, uni.camera_right.xyz));
  }

  let center = mix(p0, p1, t);
  let distance = max(length(uni.camera_pos.xyz - center), 1.0);
  var thickness = (0.0008 + 0.0014 * start.w) * distance;
  if (beamMode == 0u) {
    thickness *= 1.0 + 0.7 * fract(sin(f32(beamIdx) * 12.9898) * 43758.5453);
  } else if (beamMode == 2u) {
    thickness *= 0.82;
  }
  let worldPos = center + offsetDir * sideSign * thickness;

  out.cp = uni.view_proj * vec4f(worldPos, 1.0);
  out.uv = vec2f(t, select(0.0, 1.0, sideSign > 0.0));
  out.intensity = start.w;
  out.mode = end.w;
  let surfaceUp = normalize(uni.camera_pos.xyz);
  out.atmScatter = abs(dot(beamDir, surfaceUp));
  return out;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) instance: u32) -> VOut {
  return beam_vs(instance, vi);
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let mode = u32(in.mode);
  let viewScale = viewBeamScale(uni.view_mode);
  let base = beamPalette(mode, in.uv.x);
  let edge = ribbonEdge(mode, in.uv.y);
  let pulse = patternPulse(mode, in.uv.x, uni.time);
  let travel = patternTravel(mode, in.uv.x, uni.time);
  let glow = max(select(0.28, 0.35, mode == 2u), travel);

  var hdrBoost = select(select(1.35, 1.55, mode == 1u), 1.25, mode == 2u);
  let alpha = clamp(edge * in.intensity * pulse * glow * viewScale, 0.0, 1.0);
  var color = mix(base * 0.75, base * hdrBoost, travel + 0.35);
  color = groundProjectionTint(color, uni.view_mode, in.atmScatter);

  let isSurface = ((uni.view_mode >> 16u) & 1u) == 1u || (uni.view_mode & 0xFFFFu) == 5u;
  var alphaScale = select(0.85, 0.68, isSurface);
  if (isSurface) {
    // Softer sky-projection falloff — wider ribbons, less pin-point alpha.
    alphaScale *= select(select(0.92, 0.88, mode == 1u), 0.84, mode == 2u);
  }
  return vec4f(color * alpha, alpha * alphaScale);
}
`;

export const BEAM_CULLED_SHADER = BEAM_SHADER.replace(
  '@group(0) @binding(1) var<storage, read> beams : array<vec4f>;',
  `@group(0) @binding(1) var<storage, read> beams : array<vec4f>;
@group(0) @binding(2) var<storage, read> visible_beam_indices : array<u32>;`,
).replace(
  `@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) instance: u32) -> VOut {
  return beam_vs(instance, vi);
}`,
  `@vertex
fn vs_culled(@builtin(vertex_index) vi: u32, @builtin(instance_index) instance: u32) -> VOut {
  return beam_vs(visible_beam_indices[instance], vi);
}`,
);
