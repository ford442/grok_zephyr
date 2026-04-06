/**
 * Grok Zephyr - Shader Collection
 * 
 * Central export for all WGSL shaders.
 * 
 * STRUCTURE:
 * - uniforms.ts: Shared uniform struct across all shaders
 * - compute/: Compute shaders (orbital mechanics, beams)
 * - render/: Render shaders (stars, earth, atmosphere, satellites, etc.)
 * - animations/: Animation shaders (smile, sky strips)
 * 
 * USAGE:
 *   import { SHADERS } from '@/shaders/index.js';
 *   const orbitalShader = SHADERS.compute.orbital;
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

/** @deprecated Use SHADERS.compute.orbital instead */
export const ORBITAL_CS = Compute.ORBITAL_CS;

/** @deprecated Use SHADERS.render.stars instead */
export const STARS_SHADER = Render.STARS_SHADER;

/** @deprecated Use SHADERS.render.earth instead */
export const EARTH_SHADER = Render.EARTH_SHADER;

/** @deprecated Use SHADERS.render.atmosphere instead */
export const ATM_SHADER = Render.ATM_SHADER;

/** @deprecated Use SHADERS.render.satellites instead */
export const SATELLITE_SHADER = Render.SATELLITE_SHADER;

/** @deprecated Use SHADERS.render.beam instead */
export const BEAM_SHADER = Render.BEAM_SHADER;

/** @deprecated Use SHADERS.render.ground instead */
export const GROUND_TERRAIN = Render.GROUND_TERRAIN;

/** @deprecated Use SHADERS.compute.beam instead */
export const BEAM_COMPUTE = Compute.BEAM_COMPUTE;

/** @deprecated Use SHADERS.render.postProcess.bloomThreshold instead */
export const BLOOM_THRESHOLD = Render.BLOOM_THRESHOLD;

/** @deprecated Use SHADERS.render.postProcess.bloomBlur instead */
export const BLOOM_BLUR = Render.BLOOM_BLUR;

/** @deprecated Use SHADERS.render.postProcess.composite instead */
export const COMPOSITE = Render.COMPOSITE;

/** @deprecated Use SHADERS.animations.smileV2 instead */
export const SMILE_V2_SHADER = Animations.SMILE_V2_SHADER;

/** @deprecated Use SHADERS.animations.skyStrips instead */
export const SKY_STRIPS_SHADER = Animations.SKY_STRIPS_SHADER;

// Default export for convenience
export default SHADERS;

// Re-export uniform struct for direct access
export { UNIFORM_STRUCT } from './uniforms.js';
