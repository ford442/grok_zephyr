/**
 * Grok Zephyr - Animation Engine
 * 
 * Manages satellite formation animations with state machine,
 * pattern queue system, and smooth transitions between patterns.
 */

import type { 
  AnimationState, 
  AnimationPattern, 
  AnimationPhase,
  AnimationConfig,
  SatelliteFeature
} from '@/types/animation.js';
import {
  DEFAULT_ANIMATION_CONFIG
} from '@/types/animation.js';

/** Animation event callbacks */
export interface AnimationCallbacks {
  onPhaseChange?: (pattern: AnimationPattern, phase: AnimationPhase, progress: number) => void;
  onPatternComplete?: (pattern: AnimationPattern) => void;
  onPatternStart?: (pattern: AnimationPattern) => void;
}

/** Pattern queue entry */
interface QueuedPattern {
  pattern: AnimationPattern;
  speed: number;
  loop: boolean;
}

/**
 * Animation Engine
 * 
 * Manages the lifecycle of satellite formation animations including:
 * - Pattern state machine (emerge → playing → fade)
 * - Smooth transitions between patterns
 * - Queue management for playlists
 * - Feature assignment for complex patterns (smile, heart, etc.)
 */
export class AnimationEngine {
  private state: AnimationState;
  private config: AnimationConfig;
  private callbacks: AnimationCallbacks;
  
  // Pattern queue
  private queue: QueuedPattern[] = [];
  private queueIndex = 0;
  private isPlayingQueue = false;
  private randomizeQueue = false;
  
  // Timing
  private lastTime = 0;
  private phaseStartTime = 0;
  
  // GPU buffer references (set externally)
  private gpuBuffers: {
    positions?: GPUBuffer;
    colors?: GPUBuffer;
    features?: GPUBuffer;
  } = {};
  
  // Feature assignments (computed once per pattern)
  private featureAssignments: Map<number, SatelliteFeature> = new Map();
  private patternPhaseOffsets: Map<number, number> = new Map();
  


  constructor(config: Partial<AnimationConfig> = {}, callbacks: AnimationCallbacks = {}) {
    this.config = { ...DEFAULT_ANIMATION_CONFIG, ...config };
    this.callbacks = callbacks;
    
    this.state = {
      currentPattern: this.config.defaultPattern,
      phase: 'idle',
      progress: 0,
      speed: this.config.defaultSpeed,
      loop: this.config.loopByDefault,
      elapsedTime: 0,
      phaseStartTime: 0,
      nextPattern: null,
    };
    
    this.lastTime = performance.now() / 1000;
  }

  /**
   * Set GPU buffers for compute shader dispatch
   */
  setGPUBuffers(buffers: { positions?: GPUBuffer; colors?: GPUBuffer; features?: GPUBuffer }): void {
    this.gpuBuffers = buffers;
  }

  /**
   * Get current animation state
   */
  getState(): AnimationState {
    return { ...this.state };
  }

  /**
   * Get current pattern
   */
  getCurrentPattern(): AnimationPattern {
    return this.state.currentPattern;
  }

  /**
   * Get current phase
   */
  getCurrentPhase(): AnimationPhase {
    return this.state.phase;
  }

  /**
   * Start a specific pattern
   */
  startPattern(
    pattern: AnimationPattern,
    options: { speed?: number; loop?: boolean; immediate?: boolean } = {}
  ): void {
    const { speed = this.state.speed, loop = this.state.loop, immediate = false } = options;
    
    if (immediate || this.state.phase === 'idle') {
      // Start immediately
      this.transitionToPattern(pattern, speed, loop);
    } else {
      // Queue for after current pattern
      this.state.nextPattern = pattern;
    }
  }

  /**
   * Stop current animation and return to idle
   */
  stop(): void {
    this.state.phase = 'fade';
    this.state.progress = 0;
    this.phaseStartTime = this.state.elapsedTime;
    this.queue = [];
    this.isPlayingQueue = false;
  }

  /**
   * Pause animation (maintain current state)
   */
  pause(): void {
    // State is preserved, updates stop
    this.lastTime = -1; // Signal paused
  }

  /**
   * Resume from pause
   */
  resume(): void {
    this.lastTime = performance.now() / 1000;
  }

  /**
   * Set playback speed (0.25x - 4.0x)
   */
  setSpeed(speed: number): void {
    this.state.speed = Math.max(0.25, Math.min(4.0, speed));
  }

  /**
   * Get playback speed
   */
  getSpeed(): number {
    return this.state.speed;
  }

  /**
   * Set loop mode
   */
  setLoop(loop: boolean): void {
    this.state.loop = loop;
  }

  /**
   * Add pattern to queue
   */
  queuePattern(pattern: AnimationPattern, options: { speed?: number; loop?: boolean } = {}): void {
    this.queue.push({
      pattern,
      speed: options.speed ?? this.state.speed,
      loop: options.loop ?? false,
    });
  }

  /**
   * Clear pattern queue
   */
  clearQueue(): void {
    this.queue = [];
    this.queueIndex = 0;
    this.isPlayingQueue = false;
  }

  /**
   * Start playing queue
   */
  playQueue(options: { randomize?: boolean; loop?: boolean } = {}): void {
    this.randomizeQueue = options.randomize ?? false;
    this.state.loop = options.loop ?? false;
    this.queueIndex = 0;
    this.isPlayingQueue = true;
    
    if (this.queue.length > 0) {
      const first = this.queue[0];
      this.transitionToPattern(first.pattern, first.speed, first.loop);
    }
  }

  /**
   * Shuffle queue order
   */
  shuffleQueue(): void {
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
  }

  /**
   * Update animation state (call each frame)
   */
  update(currentTime: number): void {
    if (this.lastTime < 0) {
      // Paused
      return;
    }
    
    const deltaTime = currentTime - this.lastTime;
    this.lastTime = currentTime;
    
    this.state.elapsedTime += deltaTime * this.state.speed;
    
    // Update based on current phase
    switch (this.state.phase) {
      case 'idle':
        this.updateIdle(deltaTime);
        break;
      case 'emerge':
        this.updateEmerge(deltaTime);
        break;
      case 'playing':
        this.updatePlaying(deltaTime);
        break;
      case 'fade':
        this.updateFade(deltaTime);
        break;
      case 'transitioning':
        this.updateTransition(deltaTime);
        break;
    }
  }

  /**
   * Get shader uniform data for current animation state
   */
  getShaderUniforms(): {
    pattern: number;
    phase: number;
    progress: number;
    speed: number;
    time: number;
  } {
    const patternMap: Record<AnimationPattern, number> = {
      chaos: 0,
      grok: 1,
      x: 2,
      smile: 3,
      rain: 4,
      heartbeat: 5,
      spiral: 6,
      text: 7,
      fireworks: 8,
      none: 255,
    };
    
    const phaseMap: Record<AnimationPhase, number> = {
      idle: 0,
      emerge: 1,
      playing: 2,
      fade: 3,
      transitioning: 4,
    };
    
    return {
      pattern: patternMap[this.state.currentPattern] ?? 255,
      phase: phaseMap[this.state.phase] ?? 0,
      progress: this.state.progress,
      speed: this.state.speed,
      time: this.state.elapsedTime,
    };
  }

  /**
   * Get feature assignment for a satellite (for complex patterns)
   */
  getSatelliteFeature(satIndex: number): SatelliteFeature {
    return this.featureAssignments.get(satIndex) ?? 'none';
  }

  /**
   * Pre-compute feature assignments for current pattern
   */
  computeFeatureAssignments(satellitePositions: Float32Array): void {
    this.featureAssignments.clear();
    this.patternPhaseOffsets.clear();
    
    const count = satellitePositions.length / 4;
    
    switch (this.state.currentPattern) {
      case 'smile':
        this.computeSmileFeatures(satellitePositions, count);
        break;
      case 'heartbeat':
        this.computeHeartFeatures(satellitePositions, count);
        break;
      case 'rain':
        this.computeRainFeatures(count);
        break;
      case 'spiral':
        this.computeSpiralFeatures(satellitePositions, count);
        break;
      case 'fireworks':
        this.computeFireworkFeatures(satellitePositions, count);
        break;
      default:
        // No features needed
        break;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PRIVATE METHODS
  // ═══════════════════════════════════════════════════════════════════════════════

  private transitionToPattern(pattern: AnimationPattern, speed: number, loop: boolean): void {
    this.state.currentPattern = pattern;
    this.state.speed = speed;
    this.state.loop = loop;
    this.state.phase = 'emerge';
    this.state.progress = 0;
    this.state.elapsedTime = 0;
    this.state.phaseStartTime = 0;
    this.state.nextPattern = null;
    
    this.callbacks.onPatternStart?.(pattern);
    this.callbacks.onPhaseChange?.(pattern, 'emerge', 0);
  }

  private updateIdle(_deltaTime: number): void {
    // Check for queued patterns
    if (this.isPlayingQueue && this.queue.length > 0) {
      const next = this.queue[this.queueIndex];
      this.transitionToPattern(next.pattern, next.speed, next.loop);
    }
  }

  private updateEmerge(_deltaTime: number): void {
    const duration = this.config.phaseDurations.emerge;
    this.state.progress = (this.state.elapsedTime - this.state.phaseStartTime) / duration;
    
    if (this.state.progress >= 1.0) {
      this.state.progress = 0;
      this.state.phase = 'playing';
      this.state.phaseStartTime = this.state.elapsedTime;
      this.callbacks.onPhaseChange?.(this.state.currentPattern, 'playing', 0);
    }
  }

  private updatePlaying(_deltaTime: number): void {
    const duration = this.config.phaseDurations.playing;
    this.state.progress = (this.state.elapsedTime - this.state.phaseStartTime) / duration;
    
    if (this.state.progress >= 1.0) {
      if (this.state.loop) {
        // Loop: reset to emerge phase
        this.state.progress = 0;
        this.state.phase = 'emerge';
        this.state.phaseStartTime = this.state.elapsedTime;
        this.callbacks.onPhaseChange?.(this.state.currentPattern, 'emerge', 0);
      } else {
        // Move to fade
        this.state.progress = 0;
        this.state.phase = 'fade';
        this.state.phaseStartTime = this.state.elapsedTime;
        this.callbacks.onPhaseChange?.(this.state.currentPattern, 'fade', 0);
      }
    }
  }

  private updateFade(_deltaTime: number): void {
    const duration = this.config.phaseDurations.fade;
    this.state.progress = (this.state.elapsedTime - this.state.phaseStartTime) / duration;
    
    if (this.state.progress >= 1.0) {
      this.callbacks.onPatternComplete?.(this.state.currentPattern);
      
      if (this.state.nextPattern) {
        // Transition to queued pattern
        this.transitionToPattern(this.state.nextPattern, this.state.speed, this.state.loop);
      } else if (this.isPlayingQueue) {
        // Advance queue
        this.queueIndex++;
        if (this.queueIndex >= this.queue.length) {
          if (this.randomizeQueue) {
            this.shuffleQueue();
          }
          if (this.state.loop) {
            this.queueIndex = 0;
          } else {
            this.isPlayingQueue = false;
            this.state.phase = 'idle';
            return;
          }
        }
        
        const next = this.queue[this.queueIndex];
        this.transitionToPattern(next.pattern, next.speed, next.loop);
      } else {
        // Return to idle
        this.state.phase = 'idle';
        this.state.currentPattern = 'none';
      }
    }
  }

  private updateTransition(_deltaTime: number): void {
    // Smooth transition between patterns - uses fixed timestep
    
    if (this.state.progress >= 1.0) {
      if (this.state.nextPattern) {
        this.transitionToPattern(this.state.nextPattern, this.state.speed, this.state.loop);
      } else {
        this.state.phase = 'idle';
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // FEATURE ASSIGNMENT METHODS
  // ═══════════════════════════════════════════════════════════════════════════════

  private computeSmileFeatures(positions: Float32Array, count: number): void {
    // Eye positions (relative to Earth-facing hemisphere)
    const eyeOffsetX = 300;
    const eyeOffsetY = 300;
    const eyeRadius = 120;
    
    for (let i = 0; i < count; i++) {
      const x = positions[i * 4 + 0];
      const y = positions[i * 4 + 1];
      const z = positions[i * 4 + 2];
      
      // Gnomonic projection to 2D plane facing Earth
      const dist = Math.sqrt(x * x + y * y + z * z);
      const facing = -z / dist; // Simplified facing check
      
      if (facing < 0.7) {
        this.featureAssignments.set(i, 'none');
        continue;
      }
      
      // Project to tangent plane
      const projX = x;
      const projY = y;
      
      // Check left eye
      const distLeftEye = Math.sqrt(
        Math.pow(projX - (-eyeOffsetX), 2) + 
        Math.pow(projY - eyeOffsetY, 2)
      );
      
      // Check right eye
      const distRightEye = Math.sqrt(
        Math.pow(projX - eyeOffsetX, 2) + 
        Math.pow(projY - eyeOffsetY, 2)
      );
      
      // Check smile curve (simplified parabola)
      const smileY = 0.0015 * projX * projX - 350;
      const distSmile = Math.abs(projY - smileY);
      
      if (distLeftEye < eyeRadius) {
        this.featureAssignments.set(i, 'eye_left');
      } else if (distRightEye < eyeRadius) {
        this.featureAssignments.set(i, 'eye_right');
      } else if (distSmile < 80 && Math.abs(projX) < 500) {
        this.featureAssignments.set(i, 'smile_curve');
      } else {
        this.featureAssignments.set(i, 'none');
      }
      
      // Random phase offset for twinkling
      this.patternPhaseOffsets.set(i, Math.random() * Math.PI * 2);
    }
  }

  private computeHeartFeatures(positions: Float32Array, count: number): void {
    const heartScale = 1200;
    
    for (let i = 0; i < count; i++) {
      const x = positions[i * 4 + 0];
      const y = positions[i * 4 + 1];
      
      // Heart SDF approximation
      const px = x / heartScale;
      const py = -y / heartScale; // Flip Y
      
      const a = px * px + py * py - 0.5;
      const d = a * a * a - px * px * py * py * py;
      
      if (Math.abs(d) < 0.15 && d < 0) {
        this.featureAssignments.set(i, 'heart');
      } else {
        this.featureAssignments.set(i, 'none');
      }
    }
  }

  private computeRainFeatures(count: number): void {
    // Rain doesn't need per-satellite features, just column assignments
    // Deterministic based on satellite index
    for (let i = 0; i < count; i++) {
      const isActive = ((i * 7919) % 100) < 70; // 70% active
      this.featureAssignments.set(i, isActive ? 'text_pixel' : 'none');
    }
  }

  private computeSpiralFeatures(positions: Float32Array, count: number): void {
    // Assign satellites to spiral arms based on angle
    for (let i = 0; i < count; i++) {
      const x = positions[i * 4 + 0];
      const y = positions[i * 4 + 1];
      const r = Math.sqrt(x * x + y * y);
      const theta = Math.atan2(y, x);
      
      // Check if in galaxy radius
      if (r > 3500 || r < 200) {
        this.featureAssignments.set(i, 'none');
        continue;
      }
      
      // Calculate closest arm
      const numArms = 3;
      const armOffset = (theta / (Math.PI * 2)) * numArms;
      const armIndex = Math.floor(armOffset) % numArms;
      
      this.featureAssignments.set(i, 'text_pixel'); // Generic feature
    }
  }

  private computeFireworkFeatures(positions: Float32Array, count: number): void {
    // Fireworks assign dynamically based on time, no pre-computation needed
    for (let i = 0; i < count; i++) {
      this.featureAssignments.set(i, 'none');
    }
  }
}

export default AnimationEngine;
