/**
 * Bloom Downsample Shader (Kawase Dual-Filter)
 *
 * Implements the Kawase dual-filter downsample for the bloom pyramid.
 * Each level samples 5 bilinear taps (1 centre + 4 half-offset corners)
 * which gives a good approximation of a 4-tap box filter with no
 * under-sampling artefacts.
 *
 * Bindings:
 *   0 === KawaseUni (srcTexelSize)
 *   1 === srcTex    (source texture from previous pyramid level)
 *   2 === srcSamp   (linear clamp sampler)
 */

import { emitWgslStruct } from '../../uniformSchema.js';
import { KAWASE_UNI_SCHEMA } from '../../schemas/bloom.js';

/** Kawase downsample. `useF16` requires the `shader-f16` device feature. */
export function buildBloomDownsample(useF16 = false): string {
  const enable = useF16 ? 'enable f16;\n' : '';
  const acc = useF16 ? 'vec3<f16>' : 'vec3f';
  const k4 = useF16 ? '4.0h' : '4.0';
  const k8 = useF16 ? '8.0h' : '8.0';
  const toAcc = useF16 ? (expr: string) => `vec3<f16>(${expr})` : (expr: string) => expr;
  return (
    enable +
    emitWgslStruct(KAWASE_UNI_SCHEMA) +
    /* wgsl */ `
struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0)       uv  : vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VSOut {
  const pts = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0)
  );
  var out: VSOut;
  out.pos = vec4f(pts[vid], 0.0, 1.0);
  out.uv  = pts[vid] * 0.5 + 0.5;
  return out;
}

@group(0) @binding(0) var<uniform> uni    : KawaseUni;
@group(0) @binding(1) var          srcTex : texture_2d<f32>;
@group(0) @binding(2) var          srcSamp: sampler;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  const HALF_TEXEL_OFFSET : f32 = 0.5;
  let d = uni.srcTexelSize * HALF_TEXEL_OFFSET;

  var c : ${acc} = ${toAcc('textureSample(srcTex, srcSamp, uv).rgb')} * ${k4};
  c += ${toAcc('textureSample(srcTex, srcSamp, uv + vec2f( d.x,  d.y)).rgb')};
  c += ${toAcc('textureSample(srcTex, srcSamp, uv + vec2f(-d.x,  d.y)).rgb')};
  c += ${toAcc('textureSample(srcTex, srcSamp, uv + vec2f( d.x, -d.y)).rgb')};
  c += ${toAcc('textureSample(srcTex, srcSamp, uv + vec2f(-d.x, -d.y)).rgb')};

  return vec4f(vec3f(c / ${k8}), 1.0);
}
`
  );
}

export const BLOOM_DOWNSAMPLE = buildBloomDownsample(false);
