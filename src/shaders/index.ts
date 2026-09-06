/**
 * Grok Zephyr - Shader Collection
 *
 * Runtime WGSL is authored under compute/, render/, and animations/.
 * Orbital, satellite, and composite shaders load from `.wgsl` files via the
 * Vite wgslPlugin (`#import` + generated uniform structs from SCENE_UNI_SCHEMA).
 */

import { UNIFORM_STRUCT } from './uniforms.js';
import * as Compute from './compute/index.js';
import * as Render from './render/index.js';
import * as Animations from './animations/index.js';

/** All shader collection */
export const SHADERS = {
  uniformStruct: UNIFORM_STRUCT,
  compute: Compute,
  render: Render,
  animations: Animations,
};

export { UNIFORM_STRUCT } from './uniforms.js';
