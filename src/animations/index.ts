/**
 * Grok Zephyr - Animation Controllers
 * 
 * Animation systems for coordinated satellite light shows and effects.
 */

// Smile from the Moon v2
export {
  SmileV2Controller,
  SmilePhase,
  TargetMode,
} from './SmileV2Controller.js';

export type {
  SmileV2Config,
  SmileV2Events,
  SmileV2Uniforms,
  TrailPoint,
  AnimationState,
  PhaseStartCallback,
  PhaseEndCallback,
  CycleCompleteCallback,
  PerformanceWarningCallback,
} from './SmileV2Controller.js';

// Future animation controllers can be added here
// export { AnotherController } from './AnotherController.js';
