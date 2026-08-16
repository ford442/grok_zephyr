import { layoutUniformStruct, type UniformSchema } from '../uniformSchema.js';

export const THRESHOLD_UNI_SCHEMA = {
  structName: 'ThresholdUni',
  fields: [
    { name: 'threshold', type: 'f32' },
    { name: 'knee', type: 'f32' },
    { name: 'enforce_floors', type: 'f32' },
    { name: 'pad0', type: 'f32' },
  ],
} as const satisfies UniformSchema;

export const KAWASE_UNI_SCHEMA = {
  structName: 'KawaseUni',
  fields: [
    { name: 'srcTexelSize', type: 'vec2f' },
    { name: 'pad', type: 'vec2f' },
  ],
} as const satisfies UniformSchema;

export const BLOOM_COMPOSITE_UNI_SCHEMA = {
  structName: 'BloomCompositeUni',
  fields: [
    { name: 'bloomIntensity', type: 'f32' },
    { name: 'anamorphicEnabled', type: 'u32' },
    { name: 'anamorphicRatio', type: 'f32' },
    { name: 'pad', type: 'f32' },
  ],
} as const satisfies UniformSchema;

export const THRESHOLD_UNI_LAYOUT = layoutUniformStruct(THRESHOLD_UNI_SCHEMA);
export const KAWASE_UNI_LAYOUT = layoutUniformStruct(KAWASE_UNI_SCHEMA);
export const BLOOM_COMPOSITE_UNI_LAYOUT = layoutUniformStruct(BLOOM_COMPOSITE_UNI_SCHEMA);
