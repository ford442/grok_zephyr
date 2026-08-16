/**
 * Shared Uniform Struct for all shaders.
 * Generated from SCENE_UNI_SCHEMA. CPU packers live in uniformLayouts.ts.
 */

import { emitWgslStruct } from './uniformSchema.js';
import { SCENE_UNI_SCHEMA } from './schemas/sceneUni.js';

export const UNIFORM_STRUCT = emitWgslStruct(SCENE_UNI_SCHEMA);

export * from './uniformLayouts.js';
