/**
 * Grok Zephyr - Smile V2 Controller
 * 
 * High-level controller for "Smile from the Moon v2" animation system.
 * Provides a simple API for starting, stopping, and monitoring the animation.
 * 
 * Usage:
 *   const controller = new SmileV2Controller(renderPipeline);
 *   controller.startAnimation(); // Starts full 48-second cycle
 *   controller.stopAnimation();  // Stops and resets
 */

import type { RenderPipeline } from './RenderPipeline.js';
import type { SmileV2Pipeline, SmileV2Phase, SmileV2Uniforms } from './SmileV2Pipeline.js';

/** Animation cycle configuration */
export interface SmileV2CycleConfig {
  /** Duration of EMERGE phase (seconds) */
  emergeDuration: number;
  /** Duration of GLOW phase (seconds) */
  glowDuration: number;
  /** Duration of TWINKLE phase (seconds) */
  twinkleDuration: number;
  /** Duration of FADE phase (seconds) */
  fadeDuration: number;
  /** Duration of MORPH phase (seconds) */
  morphDuration: number;
  /** Duration of TRAILS phase (seconds) */
  trailsDuration: number;
}

/** Default 48-second cycle configuration */
export const DEFAULT_CYCLE_CONFIG: SmileV2CycleConfig = {
  emergeDuration: 3.0,
  glowDuration: 8.0,
  twinkleDuration: 8.0,
  fadeDuration: 2.0,
  morphDuration: 8.0,
  trailsDuration: 21.0, // Total: 48 seconds
};

/** Animation state */
export interface SmileV2State {
  isPlaying: boolean;
  currentPhase: SmileV2Phase;
  phaseElapsedTime: number;
  totalElapsedTime: number;
  cycleCount: number;
  frameTime: number;
}

/** Performance metrics */
export interface SmileV2Metrics {
  avgFrameTime: number;
  maxFrameTime: number;
  framesOverBudget: number;
  totalFrames: number;
}

/**
 * Smile V2 Controller
 * 
 * Manages the full animation lifecycle and provides performance monitoring.
 */
export class SmileV2Controller {
  private pipeline: SmileV2Pipeline | null = null;
  private config: SmileV2CycleConfig;
  private state: SmileV2State;
  private metrics: SmileV2Metrics;
  private animationStartTime: number = 0;
  private lastUpdateTime: number = 0;
  private frameTimes: number[] = [];

  constructor(
    renderPipeline: RenderPipeline,
    config: Partial<SmileV2CycleConfig> = {}
  ) {
    this.pipeline = renderPipeline.getSmileV2Pipeline();
    this.config = { ...DEFAULT_CYCLE_CONFIG, ...config };
    
    this.state = {
      isPlaying: false,
      currentPhase: 0 as SmileV2Phase, // IDLE
      phaseElapsedTime: 0,
      totalElapsedTime: 0,
      cycleCount: 0,
      frameTime: 0,
    };

    this.metrics = {
      avgFrameTime: 0,
      maxFrameTime: 0,
      framesOverBudget: 0,
      totalFrames: 0,
    };
  }

  /**
   * Start the full animation cycle
   */
  startAnimation(): void {
    if (!this.pipeline) {
      console.warn('[SmileV2Controller] Pipeline not available');
      return;
    }

    this.state.isPlaying = true;
    this.animationStartTime = performance.now();
    this.lastUpdateTime = this.animationStartTime;
    this.state.cycleCount = 0;
    
    // Reset metrics
    this.frameTimes = [];
    this.metrics = {
      avgFrameTime: 0,
      maxFrameTime: 0,
      framesOverBudget: 0,
      totalFrames: 0,
    };

    // Start with EMERGE phase
    this.pipeline.startPhase(1 as SmileV2Phase); // EMERGE
    
    console.log('[SmileV2Controller] Animation started');
  }

  /**
   * Stop the animation and reset to idle
   */
  stopAnimation(): void {
    if (!this.pipeline) return;

    this.state.isPlaying = false;
    this.pipeline.startPhase(0 as SmileV2Phase); // IDLE
    this.pipeline.disable();
    
    console.log('[SmileV2Controller] Animation stopped');
  }

  /**
   * Pause the animation (maintains current state)
   */
  pauseAnimation(): void {
    this.state.isPlaying = false;
    console.log('[SmileV2Controller] Animation paused');
  }

  /**
   * Resume the animation
   */
  resumeAnimation(): void {
    if (!this.pipeline) return;

    this.state.isPlaying = true;
    this.lastUpdateTime = performance.now();
    this.pipeline.enable();
    
    console.log('[SmileV2Controller] Animation resumed');
  }

  /**
   * Skip to a specific phase
   */
  skipToPhase(phase: SmileV2Phase): void {
    if (!this.pipeline) return;

    this.pipeline.startPhase(phase);
    this.state.currentPhase = phase;
    this.state.phaseElapsedTime = 0;
    
    console.log(`[SmileV2Controller] Skipped to phase ${phase}`);
  }

  /**
   * Update animation state - call every frame
   */
  update(): void {
    if (!this.state.isPlaying || !this.pipeline) {
      return;
    }

    const now = performance.now();
    const deltaTime = (now - this.lastUpdateTime) / 1000;
    this.lastUpdateTime = now;

    // Update state
    this.state.totalElapsedTime = (now - this.animationStartTime) / 1000;
    this.state.phaseElapsedTime = this.pipeline.getPhaseElapsedTime();
    this.state.currentPhase = this.pipeline.getCurrentPhase();

    // Update uniforms
    const uniforms: SmileV2Uniforms = {
      global_time: this.state.totalElapsedTime,
      transition_alpha: this.calculateTransitionAlpha(),
      target_mode: this.state.currentPhase,
      morph_progress: this.calculateMorphProgress(),
    };

    this.pipeline.updateUniforms(uniforms);

    // Update metrics
    this.updateMetrics();

    // Check for phase transitions
    this.handlePhaseTransitions();

    // Avoid unused variable warning while keeping for future use
    void deltaTime;
  }

  /**
   * Calculate transition alpha based on current phase
   */
  private calculateTransitionAlpha(): number {
    const phase = this.state.currentPhase;
    const elapsed = this.state.phaseElapsedTime;

    switch (phase) {
      case 1: // EMERGE
        return Math.min(elapsed / this.config.emergeDuration, 1.0);
      case 4: // FADE
        return 1.0 - Math.min(elapsed / this.config.fadeDuration, 1.0);
      default:
        return 1.0;
    }
  }

  /**
   * Calculate morph progress for phase transitions
   */
  private calculateMorphProgress(): number {
    if (this.state.currentPhase !== 5) { // MORPH
      return 0;
    }
    return Math.min(this.state.phaseElapsedTime / this.config.morphDuration, 1.0);
  }

  /**
   * Handle automatic phase transitions
   */
  private handlePhaseTransitions(): void {
    if (!this.pipeline) return;

    const phase = this.state.currentPhase;
    const elapsed = this.state.phaseElapsedTime;

    let shouldTransition = false;
    let nextPhase: SmileV2Phase = phase;

    switch (phase) {
      case 1: // EMERGE
        if (elapsed >= this.config.emergeDuration) {
          shouldTransition = true;
          nextPhase = 2 as SmileV2Phase; // GLOW
        }
        break;
      case 2: // GLOW
        if (elapsed >= this.config.glowDuration) {
          shouldTransition = true;
          nextPhase = 3 as SmileV2Phase; // TWINKLE
        }
        break;
      case 3: // TWINKLE
        if (elapsed >= this.config.twinkleDuration) {
          shouldTransition = true;
          nextPhase = 4 as SmileV2Phase; // FADE
        }
        break;
      case 4: // FADE
        if (elapsed >= this.config.fadeDuration) {
          shouldTransition = true;
          nextPhase = 5 as SmileV2Phase; // MORPH
        }
        break;
      case 5: // MORPH
        if (elapsed >= this.config.morphDuration) {
          shouldTransition = true;
          nextPhase = 6 as SmileV2Phase; // TRAILS
        }
        break;
      case 6: // TRAILS
        if (elapsed >= this.config.trailsDuration) {
          shouldTransition = true;
          nextPhase = 1 as SmileV2Phase; // EMERGE (loop)
          this.state.cycleCount++;
        }
        break;
    }

    if (shouldTransition) {
      this.pipeline.startPhase(nextPhase);
      this.state.currentPhase = nextPhase;
      console.log(`[SmileV2Controller] Phase transition: ${phase} -> ${nextPhase}`);
    }
  }

  /**
   * Update performance metrics
   */
  private updateMetrics(): void {
    if (!this.pipeline) return;

    const timing = this.pipeline.getTiming();
    this.state.frameTime = timing.frameTime;

    this.frameTimes.push(timing.frameTime);
    if (this.frameTimes.length > 60) {
      this.frameTimes.shift();
    }

    this.metrics.totalFrames++;
    this.metrics.avgFrameTime = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.metrics.maxFrameTime = Math.max(this.metrics.maxFrameTime, timing.frameTime);
    
    if (timing.frameTime > 16) {
      this.metrics.framesOverBudget++;
    }
  }

  /**
   * Check if animation is active
   */
  isActive(): boolean {
    return this.state.isPlaying;
  }

  /**
   * Get current animation state
   */
  getState(): SmileV2State {
    return { ...this.state };
  }

  /**
   * Get performance metrics
   */
  getMetrics(): SmileV2Metrics {
    return { ...this.metrics };
  }

  /**
   * Get total cycle duration
   */
  getTotalCycleDuration(): number {
    return (
      this.config.emergeDuration +
      this.config.glowDuration +
      this.config.twinkleDuration +
      this.config.fadeDuration +
      this.config.morphDuration +
      this.config.trailsDuration
    );
  }

  /**
   * Get progress through current cycle (0-1)
   */
  getCycleProgress(): number {
    const totalDuration = this.getTotalCycleDuration();
    return (this.state.totalElapsedTime % totalDuration) / totalDuration;
  }

  /**
   * Enable visibility culling for performance
   */
  enableVisibilityCulling(): void {
    this.pipeline?.setVisibilityCulling(true);
  }

  /**
   * Disable visibility culling
   */
  disableVisibilityCulling(): void {
    this.pipeline?.setVisibilityCulling(false);
  }

  /**
   * Enable indirect dispatch for dynamic workgroup sizing
   */
  enableIndirectDispatch(): void {
    this.pipeline?.setIndirectDispatch(true);
  }

  /**
   * Disable indirect dispatch
   */
  disableIndirectDispatch(): void {
    this.pipeline?.setIndirectDispatch(false);
  }

  /**
   * Reset all state
   */
  reset(): void {
    this.stopAnimation();
    this.state = {
      isPlaying: false,
      currentPhase: 0 as SmileV2Phase,
      phaseElapsedTime: 0,
      totalElapsedTime: 0,
      cycleCount: 0,
      frameTime: 0,
    };
    this.frameTimes = [];
    console.log('[SmileV2Controller] Reset');
  }
}

export default SmileV2Controller;
