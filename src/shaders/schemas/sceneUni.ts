import { layoutUniformStruct, type UniformSchema } from '../uniformSchema.js';

/** Shared scene uniform block (256 bytes). */
export const SCENE_UNI_SCHEMA = {
  structName: 'Uni',
  binding: { group: 0, binding: 0, varName: 'uni' },
  fields: [
    { name: 'view_proj', type: 'mat4x4f' },
    { name: 'camera_pos', type: 'vec4f' },
    { name: 'camera_right', type: 'vec4f' },
    { name: 'camera_up', type: 'vec4f' },
    { name: 'time', type: 'f32' },
    { name: 'delta_time', type: 'f32' },
    { name: 'view_mode', type: 'u32' },
    { name: 'sim_time', type: 'f32' },
    { name: 'frustum', type: 'vec4f', arrayCount: 6 },
    { name: 'screen_size', type: 'vec2f' },
    { name: 'time_scale', type: 'f32' },
    { name: 'background_mode', type: 'u32' },
    { name: 'sun_position', type: 'vec4f' },
  ],
} as const satisfies UniformSchema;

export const SCENE_UNI_LAYOUT = layoutUniformStruct(SCENE_UNI_SCHEMA);
export const SCENE_UNI_BYTE_SIZE = SCENE_UNI_LAYOUT.byteSize;
