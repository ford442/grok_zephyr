/**
 * Bloom Downsample Shader (Kawase Dual-Filter)
 *
 * WGSL source: ./bloomDownsample.wgsl
 */
import source from './bloomDownsample.wgsl';

/** The accumulator alias the f16 variant rewrites. Must match the `.wgsl`. */
const ACC_ALIAS_F32 = 'alias Acc = vec3f;';
const ACC_ALIAS_F16 = 'alias Acc = vec3<f16>;';

/** Kawase downsample. `useF16` requires the `shader-f16` device feature. */
export function buildBloomDownsample(useF16 = false): string {
  if (!useF16) return source;
  if (!source.includes(ACC_ALIAS_F32)) {
    throw new Error('bloomDownsample.wgsl no longer declares the Acc alias');
  }
  return `enable f16;\n${source.replace(ACC_ALIAS_F32, ACC_ALIAS_F16)}`;
}

export const BLOOM_DOWNSAMPLE = buildBloomDownsample(false);
