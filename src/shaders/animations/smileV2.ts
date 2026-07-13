/**
 * Smile from the Moon v2 Shader
 *
 * Canonical runtime export — WGSL source is split across smileV2*.ts modules.
 */
import { SMILE_V2_COMMON } from './smileV2Common.js';
import { SMILE_V2_GEOMETRY } from './smileV2Geometry.js';
import { SMILE_V2_PHASES } from './smileV2Phases.js';
import { SMILE_V2_COMPUTE } from './smileV2Compute.js';

export const SMILE_V2_SHADER = [
  SMILE_V2_COMMON,
  SMILE_V2_GEOMETRY,
  SMILE_V2_PHASES,
  SMILE_V2_COMPUTE,
].join('\n');
