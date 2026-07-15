import type { QualityLevel } from '@/core/QualityPresets.js';
import { SimClock } from '@/app/SimClock.js';

/** Simulation timing, quality, and pattern mode — single source of truth. */
export class SimulationState {
  readonly clock = new SimClock();

  demoAutoEnabled = true;
  lastUserActivityTime = performance.now() * 0.001;

  currentQualityLevel: QualityLevel = 'high';
  qualityAtmosphereHaze = 0.28;
  qualityAtmosphereScatteringEnabled = false;
  taaEnabled = true;

  currentPatternMode = 1;
  currentAnimationPattern = 0;
  currentPhysicsMode = 0;
  realismMode = false;
  /** Skyline view: 0=auto mix, 1=LED, 2=laser, 3=spots, 4=neon, 5=all */
  skylineDisplayMode: 0 | 1 | 2 | 3 | 4 | 5 = 0;
  hasTleCatalog = false;
  patternSeed = 0;
  patternAnimationStart = 0;

  /** Seconds since epoch — prefer `clock.simTime`. */
  get simTime(): number {
    return this.clock.simTime;
  }

  set simTime(value: number) {
    this.clock.setSimTime(value, 'scrub');
  }

  /** Sim seconds per wall second (0 = paused) — prefer `clock.rate`. */
  get timeScale(): number {
    return this.clock.rate;
  }

  set timeScale(value: number) {
    this.clock.setRate(value);
  }
}
