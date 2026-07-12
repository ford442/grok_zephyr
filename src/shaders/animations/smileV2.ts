/**
 * Smile from the Moon v2 Shader
 *
 * Canonical runtime export — WGSL source is split across smile_v2_*.wgsl modules.
 */
import common from './smile_v2_common.wgsl';
import geometry from './smile_v2_geometry.wgsl';
import phases from './smile_v2_phases.wgsl';
import compute from './smile_v2_compute.wgsl';

export const SMILE_V2_SHADER = [common, geometry, phases, compute].join('\n');
