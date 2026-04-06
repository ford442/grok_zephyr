/**
 * Smile from the Moon v2 - Animation Controller
 * 
 * Manages the 48-second smile animation cycle with 7 phases:
 * 0: Approach - Satellites drift from chaos toward formation
 * 1: Focus - Eyes begin to form
 * 2: Recognition - Smile curve materializes
 * 3: Response - Full smile glows
 * 4: Connection - Heartbeat pulse syncs
 * 5: Transformation - Morphing display
 * 6: Trails - Persistent orbital trails with fade-out
 * 
 * Integrates with PatternSequencer and SatelliteGPUBuffer for seamless
 * rendering within the Grok Zephyr pipeline.
 */

import type { PatternSequencer } from '../patterns/PatternSequencer.js';
import { PatternType } from '../patterns/PatternSequencer.js';
import type { SatelliteBufferSet } from '../core/SatelliteGPUBuffer.js';
import type { PerformanceProfiler } from '../utils/PerformanceProfiler.js';
import type { Vec3 } from '../types/index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES & INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════

/** Animation phases for the smile cycle */
export enum SmilePhase {
  APPROACH = 0,      // Phase 0: Satellites drift from chaos to formation
  FOCUS = 1,         // Phase 1: Eyes begin to form
  RECOGNITION = 2,   // Phase 2: Smile curve materializes
  RESPONSE = 3,      // Phase 3: Full smile glows
  CONNECTION = 4,    // Phase 4: Heartbeat pulse syncs
  TRANSFORMATION = 5,// Phase 5: Morphing display
  TRAILS = 6,        // Phase 6: Persistent orbital trails
}

/** Animation state */
export type AnimationState = 'idle' | 'playing' | 'paused' | 'interrupting';

/** Target render mode */
export enum TargetMode {
  PATTERN = 0,
  CHAOS = 1,
}

/** Event callback types */
export type PhaseStartCallback = (phase: SmilePhase, phaseProgress: number) => void;
export type PhaseEndCallback = (phase: SmilePhase, nextPhase: SmilePhase | null) => void;
export type CycleCompleteCallback = () => void;
export type PerformanceWarningCallback = (frameTimeMs: number, thresholdMs: number) => void;

/** Event handlers interface */
export interface SmileV2Events {
  onPhaseStart?: PhaseStartCallback;
  onPhaseEnd?: PhaseEndCallback;
  onCycleComplete?: CycleCompleteCallback;
  onPerformanceWarning?: PerformanceWarningCallback;
}

/** Uniform data structure for GPU (matches WGSL layout) */
export interface SmileV2Uniforms {
  global_time: number;        // Accumulated animation time
  transition_alpha: number;   // Cross-fade alpha (0-1)
  target_mode: number;        // 0=pattern, 1=chaos
  morph_progress: number;     // Phase 5 morphing progress (0-1)
}

/** Trail point data for phase 6 */
export interface TrailPoint {
  position: Vec3;
  timestamp: number;          // When this point was recorded
  intensity: number;
  satelliteIndex: number;
}

/** Configuration options */
export interface SmileV2Config {
  totalDuration: number;      // Total cycle duration in seconds (default: 48)
  phaseDurations: number[];   // Duration for each phase (7 phases)
  enableTrails: boolean;      // Enable trail system for phase 6
  trailBufferDuration: number;// Trail buffer duration in seconds (default: 4)
  enablePerformanceMonitoring: boolean;
  performanceThresholdMs: number; // Frame time warning threshold (default: 16)
  interruptFadeDuration: number;  // Cross-fade duration in seconds (default: 2)
}

/** GPU timing data */
interface GPUTimingData {
  querySet: GPUQuerySet | null;
  resolveBuffer: GPUBuffer | null;
  resultBuffer: GPUBuffer | null;
  startTime: number;
  endTime: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEFAULT CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: SmileV2Config = {
  totalDuration: 48,
  phaseDurations: [6, 6, 8, 8, 8, 6, 6], // Total: 48 seconds
  enableTrails: true,
  trailBufferDuration: 4,
  enablePerformanceMonitoring: true,
  performanceThresholdMs: 16,
  interruptFadeDuration: 2,
};

// Phase-to-pattern mapping
const PHASE_PATTERNS: PatternType[] = [
  PatternType.SPARKLE,    // APPROACH: Random twinkling
  PatternType.PULSE,      // FOCUS: Sinusoidal pulse for eyes
  PatternType.WAVE,       // RECOGNITION: Wave along smile curve
  PatternType.BEAT_SYNC,  // RESPONSE: Audio-reactive glow
  PatternType.PULSE,      // CONNECTION: Heartbeat pulse
  PatternType.CHASE,      // TRANSFORMATION: Moving chase lights
  PatternType.CHASE,      // TRAILS: Chase with persistent trails
];

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN CONTROLLER CLASS
// ═══════════════════════════════════════════════════════════════════════════════

export class SmileV2Controller {
  // Configuration
  private config: SmileV2Config;
  
  // State
  private state: AnimationState = 'idle';
  private currentPhase: SmilePhase = SmilePhase.APPROACH;
  private phaseProgress: number = 0;     // 0-1 within current phase
  private cycleProgress: number = 0;     // 0-1 for entire cycle
  private globalTime: number = 0;        // Accumulated animation time
  
  // Timing
  private cycleStartTime: number = 0;
  private pausedAt: number = 0;
  private pauseDuration: number = 0;
  private lastFrameTime: number = 0;
  
  // Interrupt handling
  private interruptStartTime: number = 0;
  private interruptFromAlpha: number = 0;
  private transitionAlpha: number = 1;   // 1 = full pattern, 0 = chaos
  
  // Trail system (phase 6)
  private trailBuffer: TrailPoint[] = [];
  private trailGPUBuffer: GPUBuffer | null = null;
  private maxTrailPoints: number = 0;
  
  // Event handlers
  private events: SmileV2Events = {};
  private phaseStarted: boolean[] = new Array(7).fill(false);
  private phaseEnded: boolean[] = new Array(7).fill(false);
  
  // GPU timing
  private gpuTiming: GPUTimingData = {
    querySet: null,
    resolveBuffer: null,
    resultBuffer: null,
    startTime: 0,
    endTime: 0,
  };
  
  // Performance tracking
  private frameTimeHistory: number[] = [];
  private lastWarningTime: number = 0;
  
  // Dependencies
  private _device: GPUDevice | null = null;

  constructor(
    private patternSequencer: PatternSequencer,
    private _buffers: SatelliteBufferSet,
    private _profiler: PerformanceProfiler,
    config?: Partial<SmileV2Config>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Calculate max trail points based on buffer duration
    this.maxTrailPoints = Math.floor(this.config.trailBufferDuration * 60); // 60 FPS assumption
    
    // Pre-allocate trail buffer
    if (this.config.enableTrails) {
      this.trailBuffer = new Array(this.maxTrailPoints);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // LIFECYCLE METHODS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Initialize GPU resources for the controller
   */
  initialize(device: GPUDevice): void {
    this._device = device;
    
    // Initialize GPU timing queries if supported
    if (this.config.enablePerformanceMonitoring && device.features.has('timestamp-query')) {
      this.initializeGPUTiming(device);
    }
    
    // Initialize trail GPU buffer
    if (this.config.enableTrails) {
      this.initializeTrailBuffer(device);
    }
    
    console.log('[SmileV2Controller] Initialized with config:', this.config);
  }

  /**
   * Start the 48-second animation cycle from the beginning
   */
  startCycle(): void {
    this.state = 'playing';
    this.cycleStartTime = performance.now();
    this.globalTime = 0;
    this.currentPhase = SmilePhase.APPROACH;
    this.phaseProgress = 0;
    this.cycleProgress = 0;
    this.pauseDuration = 0;
    this.transitionAlpha = 1;
    
    // Reset phase tracking
    this.phaseStarted.fill(false);
    this.phaseEnded.fill(false);
    this.phaseStarted[SmilePhase.APPROACH] = true;
    
    // Set initial pattern
    this.patternSequencer.setUnisonPattern(PHASE_PATTERNS[SmilePhase.APPROACH], 0.7, 1.0);
    
    // Emit phase start event
    this.emitPhaseStart(SmilePhase.APPROACH, 0);
    
    console.log('[SmileV2Controller] Cycle started');
  }

  /**
   * Interrupt and cross-fade to chaos (≤2 seconds)
   */
  stopCycle(): void {
    if (this.state === 'idle') return;
    
    this.state = 'interrupting';
    this.interruptStartTime = performance.now();
    this.interruptFromAlpha = this.transitionAlpha;
    
    console.log('[SmileV2Controller] Cycle interrupted, fading to chaos');
  }

  /**
   * Pause at current phase
   */
  pauseCycle(): void {
    if (this.state !== 'playing') return;
    
    this.state = 'paused';
    this.pausedAt = performance.now();
    
    console.log('[SmileV2Controller] Cycle paused at phase', this.currentPhase);
  }

  /**
   * Resume from pause
   */
  resumeCycle(): void {
    if (this.state !== 'paused') return;
    
    const now = performance.now();
    this.pauseDuration += now - this.pausedAt;
    this.state = 'playing';
    
    console.log('[SmileV2Controller] Cycle resumed');
  }

  /**
   * Jump to a specific phase (0-6)
   */
  seekPhase(phase: number): void {
    if (phase < 0 || phase > 6) {
      console.warn(`[SmileV2Controller] Invalid phase ${phase}, must be 0-6`);
      return;
    }
    
    // Calculate target time for this phase
    let targetTime = 0;
    for (let i = 0; i < phase; i++) {
      targetTime += this.config.phaseDurations[i] * 1000;
    }
    
    // Adjust cycle start time to position at this phase
    const now = performance.now();
    this.cycleStartTime = now - targetTime - this.pauseDuration;
    this.currentPhase = phase as SmilePhase;
    this.phaseProgress = 0;
    
    // Reset phase tracking
    this.phaseStarted.fill(false);
    this.phaseEnded.fill(false);
    for (let i = 0; i <= phase; i++) {
      this.phaseStarted[i] = true;
      if (i < phase) this.phaseEnded[i] = true;
    }
    
    // Apply pattern for new phase
    this.patternSequencer.setUnisonPattern(PHASE_PATTERNS[phase], 1.0, 1.0);
    
    // Emit events
    this.emitPhaseStart(phase as SmilePhase, 0);
    
    console.log(`[SmileV2Controller] Seeked to phase ${phase}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // UPDATE LOOP
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Main update method - call each frame
   * Returns uniform data for GPU upload
   */
  update(encoder?: GPUCommandEncoder): SmileV2Uniforms {
    const now = performance.now();
    const deltaTime = this.lastFrameTime > 0 ? (now - this.lastFrameTime) / 1000 : 0;
    this.lastFrameTime = now;
    
    // Start GPU timing if available
    if (encoder && this.gpuTiming.querySet) {
      this.beginGPUTiming(encoder);
    }
    
    // Handle state-specific updates
    switch (this.state) {
      case 'playing':
        this.updatePlaying(now, deltaTime);
        break;
      case 'interrupting':
        this.updateInterrupting(now);
        break;
      case 'paused':
      case 'idle':
        // No updates when paused or idle
        break;
    }
    
    // Update pattern sequencer
    this.patternSequencer.updateUniforms(deltaTime);
    
    // Check performance
    if (this.config.enablePerformanceMonitoring) {
      this.checkPerformance(deltaTime * 1000);
    }
    
    // Build and return uniform data
    const uniforms: SmileV2Uniforms = {
      global_time: this.globalTime,
      transition_alpha: this.transitionAlpha,
      target_mode: this.state === 'interrupting' || this.transitionAlpha < 0.5 
        ? TargetMode.CHAOS 
        : TargetMode.PATTERN,
      morph_progress: this.currentPhase === SmilePhase.TRANSFORMATION 
        ? this.phaseProgress 
        : 0,
    };
    
    // End GPU timing if available
    if (encoder && this.gpuTiming.querySet) {
      this.endGPUTiming(encoder);
    }
    
    return uniforms;
  }

  /**
   * Update when in playing state
   */
  private updatePlaying(now: number, _deltaTime: number): void {
    // Calculate elapsed time accounting for pauses
    const elapsed = now - this.cycleStartTime - this.pauseDuration;
    this.globalTime = elapsed / 1000;
    
    // Calculate cycle progress (0-1)
    this.cycleProgress = Math.min(this.globalTime / this.config.totalDuration, 1);
    
    // Determine current phase
    let accumulatedTime = 0;
    let newPhase = SmilePhase.APPROACH;
    
    for (let i = 0; i < this.config.phaseDurations.length; i++) {
      const phaseDuration = this.config.phaseDurations[i] * 1000;
      if (elapsed < accumulatedTime + phaseDuration) {
        newPhase = i as SmilePhase;
        this.phaseProgress = (elapsed - accumulatedTime) / phaseDuration;
        break;
      }
      accumulatedTime += phaseDuration;
    }
    
    // Handle phase transitions
    if (newPhase !== this.currentPhase) {
      this.transitionPhase(this.currentPhase, newPhase);
    }
    
    // Handle phase start event (once per phase)
    if (!this.phaseStarted[newPhase]) {
      this.phaseStarted[newPhase] = true;
      this.emitPhaseStart(newPhase, this.phaseProgress);
    }
    
    // Handle cycle completion
    if (this.cycleProgress >= 1 && !this.phaseEnded[SmilePhase.TRAILS]) {
      this.phaseEnded[SmilePhase.TRAILS] = true;
      this.emitPhaseEnd(SmilePhase.TRAILS, null);
      this.emitCycleComplete();
      this.state = 'idle';
    }
    
    // Update pattern for current phase
    this.updatePhasePattern();
  }

  /**
   * Update when interrupting (cross-fade to chaos)
   */
  private updateInterrupting(now: number): void {
    const interruptElapsed = (now - this.interruptStartTime) / 1000;
    const fadeDuration = this.config.interruptFadeDuration;
    
    // Smooth cross-fade using smoothstep
    const t = Math.min(interruptElapsed / fadeDuration, 1);
    this.transitionAlpha = this.interruptFromAlpha * (1 - this.smoothstep(t));
    
    // Check if interrupt complete
    if (t >= 1) {
      this.transitionAlpha = 0;
      this.state = 'idle';
      this.globalTime = 0;
      
      // Restore chaos pattern
      this.patternSequencer.randomizePatterns();
      
      console.log('[SmileV2Controller] Interrupt complete, chaos restored');
    }
  }

  /**
   * Transition between phases
   */
  private transitionPhase(from: SmilePhase, to: SmilePhase): void {
    // Emit end event for previous phase
    if (!this.phaseEnded[from]) {
      this.phaseEnded[from] = true;
      this.emitPhaseEnd(from, to);
    }
    
    this.currentPhase = to;
    console.log(`[SmileV2Controller] Phase transition: ${SmilePhase[from]} -> ${SmilePhase[to]}`);
  }

  /**
   * Update pattern sequencer for current phase
   */
  private updatePhasePattern(): void {
    const phase = this.currentPhase;
    const pattern = PHASE_PATTERNS[phase];
    
    // Vary parameters based on phase progress
    let brightness = 1.0;
    let speed = 1.0;
    
    switch (phase) {
      case SmilePhase.APPROACH:
        brightness = 0.5 + this.phaseProgress * 0.5;
        speed = 0.5 + this.phaseProgress * 0.5;
        break;
      case SmilePhase.FOCUS:
        brightness = 0.7 + Math.sin(this.phaseProgress * Math.PI) * 0.3;
        break;
      case SmilePhase.RECOGNITION:
        speed = 0.5 + this.phaseProgress;
        break;
      case SmilePhase.RESPONSE:
        brightness = 0.8 + this.phaseProgress * 0.2;
        break;
      case SmilePhase.CONNECTION:
        // Heartbeat pulse speed
        speed = 1.0 + Math.sin(this.phaseProgress * Math.PI * 4) * 0.5;
        break;
      case SmilePhase.TRANSFORMATION:
        speed = 1.5;
        break;
      case SmilePhase.TRAILS:
        brightness = 1.0 - this.phaseProgress * 0.3;
        break;
    }
    
    this.patternSequencer.setUnisonPattern(pattern, brightness, speed);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // TRAIL SYSTEM (PHASE 6)
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Initialize trail GPU buffer
   */
  private initializeTrailBuffer(device: GPUDevice): void {
    // Each trail point: position (vec3) + age (f32) + intensity (f32) = 20 bytes
    // Align to 32 bytes for GPU
    const bufferSize = this.maxTrailPoints * 32;
    
    this.trailGPUBuffer = device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    
    console.log(`[SmileV2Controller] Trail buffer initialized: ${bufferSize} bytes`);
  }

  /**
   * Record a satellite position for trail rendering
   * Call this from the render loop for visible satellites
   */
  recordTrailPosition(satelliteIndex: number, position: Vec3, timestamp: number): void {
    if (!this.config.enableTrails) return;
    if (this.currentPhase !== SmilePhase.TRAILS && this.state !== 'playing') return;
    
    // Sample every Nth satellite for performance
    if (satelliteIndex % 128 !== 0) return;
    
    const age = timestamp - (this.cycleStartTime + this.pauseDuration) / 1000;
    
    // Calculate fade-out: exp(-age/2.0)
    const intensity = Math.exp(-age / 2.0);
    
    // Add to trail buffer
    const point: TrailPoint = {
      position: [...position],
      timestamp,
      intensity,
      satelliteIndex,
    };
    
    // Maintain circular buffer
    if (this.trailBuffer.length >= this.maxTrailPoints) {
      this.trailBuffer.shift();
    }
    this.trailBuffer.push(point);
  }

  /**
   * Upload trail data to GPU
   */
  uploadTrailData(device: GPUDevice): void {
    if (!this.trailGPUBuffer || this.trailBuffer.length === 0) return;
    
    const data = new Float32Array(this.maxTrailPoints * 8); // 8 floats per point (padded)
    
    for (let i = 0; i < this.trailBuffer.length; i++) {
      const point = this.trailBuffer[i];
      const idx = i * 8;
      
      data[idx + 0] = point.position[0];
      data[idx + 1] = point.position[1];
      data[idx + 2] = point.position[2];
      data[idx + 3] = 0; // padding
      data[idx + 4] = point.timestamp;
      data[idx + 5] = point.intensity;
      data[idx + 6] = point.satelliteIndex;
      data[idx + 7] = 0; // padding
    }
    
    device.queue.writeBuffer(this.trailGPUBuffer, 0, data);
  }

  /**
   * Get trail GPU buffer for binding
   */
  getTrailBuffer(): GPUBuffer | null {
    return this.trailGPUBuffer;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // UNIFORM MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Upload uniforms to GPU buffer
   */
  uploadUniforms(device: GPUDevice, buffer: GPUBuffer, uniforms: SmileV2Uniforms): void {
    const data = new Float32Array([
      uniforms.global_time,
      uniforms.transition_alpha,
      uniforms.target_mode,
      uniforms.morph_progress,
      0, 0, 0, 0, // 16 bytes padding for alignment
    ]);
    
    device.queue.writeBuffer(buffer, 0, data);
  }

  /**
   * Get uniform buffer size (aligned)
   */
  getUniformBufferSize(): number {
    return 32; // 8 floats * 4 bytes
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PERFORMANCE MONITORING
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Initialize GPU timing queries
   */
  private initializeGPUTiming(device: GPUDevice): void {
    try {
      this.gpuTiming.querySet = device.createQuerySet({
        type: 'timestamp',
        count: 2,
      });
      
      this.gpuTiming.resolveBuffer = device.createBuffer({
        size: 16, // 2 timestamps * 8 bytes
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      });
      
      console.log('[SmileV2Controller] GPU timing initialized');
    } catch (err) {
      console.warn('[SmileV2Controller] Failed to initialize GPU timing:', err);
    }
  }

  /**
   * Begin GPU timing
   */
  private beginGPUTiming(encoder: GPUCommandEncoder): void {
    if (!this.gpuTiming.querySet) return;
    
    try {
      (encoder as unknown as { writeTimestamp(set: GPUQuerySet, index: number): void })
        .writeTimestamp(this.gpuTiming.querySet, 0);
    } catch {
      // Ignore errors from unsupported timing
    }
  }

  /**
   * End GPU timing
   */
  private endGPUTiming(encoder: GPUCommandEncoder): void {
    if (!this.gpuTiming.querySet) return;
    
    try {
      (encoder as unknown as { writeTimestamp(set: GPUQuerySet, index: number): void })
        .writeTimestamp(this.gpuTiming.querySet, 1);
      
      // Resolve and read back
      if (this.gpuTiming.resolveBuffer) {
        encoder.resolveQuerySet(
          this.gpuTiming.querySet,
          0,
          2,
          this.gpuTiming.resolveBuffer,
          0
        );
      }
    } catch {
      // Ignore errors from unsupported timing
    }
  }

  /**
   * Check performance and emit warnings
   */
  private checkPerformance(frameTimeMs: number): void {
    // Add to history
    this.frameTimeHistory.push(frameTimeMs);
    if (this.frameTimeHistory.length > 60) {
      this.frameTimeHistory.shift();
    }
    
    // Check threshold
    if (frameTimeMs > this.config.performanceThresholdMs) {
      const now = performance.now();
      // Throttle warnings to once per second
      if (now - this.lastWarningTime > 1000) {
        this.lastWarningTime = now;
        this.emitPerformanceWarning(frameTimeMs, this.config.performanceThresholdMs);
      }
    }
  }

  /**
   * Get average frame time
   */
  getAverageFrameTime(): number {
    if (this.frameTimeHistory.length === 0) return 0;
    const sum = this.frameTimeHistory.reduce((a, b) => a + b, 0);
    return sum / this.frameTimeHistory.length;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // EVENT HANDLING
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Register event handlers
   */
  onEvents(events: SmileV2Events): void {
    this.events = { ...this.events, ...events };
  }

  private emitPhaseStart(phase: SmilePhase, progress: number): void {
    if (this.events.onPhaseStart) {
      this.events.onPhaseStart(phase, progress);
    }
  }

  private emitPhaseEnd(phase: SmilePhase, nextPhase: SmilePhase | null): void {
    if (this.events.onPhaseEnd) {
      this.events.onPhaseEnd(phase, nextPhase);
    }
  }

  private emitCycleComplete(): void {
    if (this.events.onCycleComplete) {
      this.events.onCycleComplete();
    }
  }

  private emitPerformanceWarning(frameTimeMs: number, thresholdMs: number): void {
    if (this.events.onPerformanceWarning) {
      this.events.onPerformanceWarning(frameTimeMs, thresholdMs);
    }
    console.warn(`[SmileV2Controller] Performance warning: frame time ${frameTimeMs.toFixed(2)}ms exceeds threshold ${thresholdMs}ms`);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // UTILITY METHODS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Smoothstep function for smooth transitions
   */
  private smoothstep(t: number): number {
    return t * t * (3 - 2 * t);
  }

  /**
   * Get current animation state
   */
  getState(): AnimationState {
    return this.state;
  }

  /**
   * Get current phase (0-6)
   */
  getCurrentPhase(): SmilePhase {
    return this.currentPhase;
  }

  /**
   * Get phase progress (0-1 within current phase)
   */
  getPhaseProgress(): number {
    return this.phaseProgress;
  }

  /**
   * Get cycle progress (0-1 for entire cycle)
   */
  getCycleProgress(): number {
    return this.cycleProgress;
  }

  /**
   * Get global time (accumulated animation time in seconds)
   */
  getGlobalTime(): number {
    return this.globalTime;
  }

  /**
   * Check if currently in a specific phase
   */
  isInPhase(phase: SmilePhase): boolean {
    return this.currentPhase === phase && this.state === 'playing';
  }

  /**
   * Get phase name
   */
  getPhaseName(phase: SmilePhase): string {
    return SmilePhase[phase];
  }

  /**
   * Allow immediate restart (reset state)
   */
  allowRestart(): boolean {
    return this.state === 'idle' || this.state === 'paused';
  }

  /**
   * Get trail statistics
   */
  getTrailStats(): { count: number; max: number } {
    return {
      count: this.trailBuffer.length,
      max: this.maxTrailPoints,
    };
  }

  /**
   * Destroy and cleanup resources
   */
  destroy(): void {
    if (this.trailGPUBuffer) {
      this.trailGPUBuffer.destroy();
      this.trailGPUBuffer = null;
    }
    
    if (this.gpuTiming.querySet) {
      this.gpuTiming.querySet.destroy();
    }
    if (this.gpuTiming.resolveBuffer) {
      this.gpuTiming.resolveBuffer.destroy();
    }
    if (this.gpuTiming.resultBuffer) {
      this.gpuTiming.resultBuffer.destroy();
    }
    
    this.state = 'idle';
    
    // References to injected dependencies (used for integration)
    void this._device;
    void this._buffers;
    void this._profiler;
    
    console.log('[SmileV2Controller] Destroyed');
  }
}

export default SmileV2Controller;

// End of file
