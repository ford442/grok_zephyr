/**
 * SmileV2Controller Integration Example
 * 
 * This file demonstrates how to integrate SmileV2Controller with the
 * Grok Zephyr render pipeline.
 */

import { SmileV2Controller, SmilePhase } from './animations/SmileV2Controller.js';
import { PatternSequencer } from './patterns/PatternSequencer.js';
import { SatelliteGPUBuffer } from './core/SatelliteGPUBuffer.js';
import { PerformanceProfiler } from './utils/PerformanceProfiler.js';
import type WebGPUContext from './core/WebGPUContext.js';

/**
 * Example: Initialize and use SmileV2Controller in the render loop
 */
export class SmileV2IntegrationExample {
  private controller: SmileV2Controller | null = null;
  private patternSequencer: PatternSequencer;
  private satelliteBuffers: SatelliteGPUBuffer;
  private profiler: PerformanceProfiler;
  private context: WebGPUContext;

  constructor(context: WebGPUContext) {
    this.context = context;
    
    // Initialize dependencies
    this.patternSequencer = new PatternSequencer(1048576, null);
    this.satelliteBuffers = new SatelliteGPUBuffer(context);
    this.profiler = new PerformanceProfiler();
    
    // Get buffer set
    const buffers = this.satelliteBuffers.getBuffers();
    
    // Create controller with event handlers
    this.controller = new SmileV2Controller(
      this.patternSequencer,
      buffers,
      this.profiler,
      {
        totalDuration: 48,
        enableTrails: true,
        enablePerformanceMonitoring: true,
      }
    );
    
    // Register event handlers
    this.controller.onEvents({
      onPhaseStart: (phase, progress) => {
        console.log(`Phase ${SmilePhase[phase]} started at ${(progress * 100).toFixed(1)}%`);
        
        // Example: Trigger UI updates, audio cues, etc.
        switch (phase) {
          case SmilePhase.FOCUS:
            // Start eye formation animation
            break;
          case SmilePhase.RESPONSE:
            // Trigger full smile glow effect
            break;
          case SmilePhase.TRAILS:
            // Enable trail rendering
            break;
        }
      },
      
      onPhaseEnd: (phase, nextPhase) => {
        console.log(`Phase ${SmilePhase[phase]} ended`);
        
        // Example: Cleanup phase-specific effects
        if (phase === SmilePhase.TRAILS && nextPhase === null) {
          console.log('Animation cycle complete!');
        }
      },
      
      onCycleComplete: () => {
        console.log('Full 48-second cycle complete');
        // Example: Auto-restart or trigger next animation
        // this.controller?.startCycle();
      },
      
      onPerformanceWarning: (frameTime, threshold) => {
        console.warn(`Performance warning: ${frameTime.toFixed(2)}ms > ${threshold}ms`);
      },
    });
  }

  /**
   * Initialize the controller with GPU device
   */
  async initialize(): Promise<void> {
    const device = this.context.getDevice();
    
    // Initialize controller GPU resources
    this.controller?.initialize(device);
    
    // Initialize profiler with GPU timing
    await this.profiler.initialize(device);
  }

  /**
   * Main render loop integration
   * Call this from your render loop
   */
  render(encoder: GPUCommandEncoder): void {
    if (!this.controller) return;
    
    // Update controller and get uniform data
    const uniforms = this.controller.update(encoder);
    
    // Upload uniforms to GPU (use patternParams buffer)
    const device = this.context.getDevice();
    const buffers = this.satelliteBuffers.getBuffers();
    
    // Update patternParams uniform buffer with SmileV2 data
    const uniformData = new Float32Array([
      uniforms.global_time,
      uniforms.transition_alpha,
      uniforms.target_mode,
      uniforms.morph_progress,
      0, 0, 0, 0, // padding
    ]);
    device.queue.writeBuffer(buffers.patternParams, 0, uniformData);
    
    // If in trail phase, update trail data
    if (this.controller.isInPhase(SmilePhase.TRAILS)) {
      this.controller.uploadTrailData(device);
    }
    
    // Continue with normal rendering...
  }

  /**
   * Record satellite positions for trail system
   * Call this when computing satellite positions
   */
  recordSatellitePositions(positions: Float32Array): void {
    if (!this.controller) return;
    
    const timestamp = performance.now() / 1000;
    
    // Sample some satellites for trail (the controller handles subsampling)
    for (let i = 0; i < positions.length; i += 384) { // Every 128th satellite, 3 floats per position
      const x = positions[i];
      const y = positions[i + 1];
      const z = positions[i + 2];
      
      this.controller.recordTrailPosition(
        i / 3,
        [x, y, z],
        timestamp
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // USER CONTROLS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Start the animation cycle
   */
  startAnimation(): void {
    this.controller?.startCycle();
  }

  /**
   * Interrupt and fade to chaos
   */
  stopAnimation(): void {
    this.controller?.stopCycle();
  }

  /**
   * Pause animation
   */
  pauseAnimation(): void {
    this.controller?.pauseCycle();
  }

  /**
   * Resume from pause
   */
  resumeAnimation(): void {
    this.controller?.resumeCycle();
  }

  /**
   * Jump to specific phase (0-6)
   */
  seekToPhase(phase: number): void {
    this.controller?.seekPhase(phase);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GETTERS FOR UI/STATE
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Get current animation state for UI
   */
  getAnimationState() {
    if (!this.controller) return null;
    
    return {
      state: this.controller.getState(),
      phase: SmilePhase[this.controller.getCurrentPhase()],
      phaseProgress: this.controller.getPhaseProgress(),
      cycleProgress: this.controller.getCycleProgress(),
      globalTime: this.controller.getGlobalTime(),
      trailStats: this.controller.getTrailStats(),
    };
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.controller?.destroy();
    this.controller = null;
    this.satelliteBuffers.destroy();
    this.profiler.destroy();
  }
}

export default SmileV2IntegrationExample;
