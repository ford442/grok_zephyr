import type { QualityLevel } from '@/core/QualityPresets.js';

/** Simulation timing, quality, and pattern mode — single source of truth. */
export class SimulationState {
  timeScale = 1.0;
  simTime = 0.0;
  demoAutoEnabled = true;
  lastUserActivityTime = performance.now() * 0.001;

  currentQualityLevel: QualityLevel = 'high';
  qualityAtmosphereHaze = 0.28;
  qualityAtmosphereScatteringEnabled = false;
  taaEnabled = true;

  currentPatternMode = 1;
  currentAnimationPattern = 0;
  currentPhysicsMode = 0;
  patternSeed = 0;
  patternAnimationStart = 0;
}
