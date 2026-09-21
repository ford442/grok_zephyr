/**
 * Grok Zephyr - Shader Collection
 *
 * Runtime WGSL is authored as `.wgsl` under compute/, render/, and animations/
 * and loaded by the Vite wgslPlugin (`#import` + generated uniform structs from
 * the TS schemas). The TS modules beside each `.wgsl` are thin re-exports; only
 * schema-generated structs are still emitted from TypeScript, and
 * shaderSources.test.ts fails CI on any new template-string shader.
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
