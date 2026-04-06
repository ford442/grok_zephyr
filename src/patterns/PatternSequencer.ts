/**
 * Pattern Sequencer - Timeline-based LED pattern management for Sky Strips
 * 
 * Manages per-satellite pattern data and provides a timeline interface
 * for creating synchronized light shows across the orbital constellation.
 */

import type { SatelliteBufferSet } from '../core/SatelliteGPUBuffer.js';

/** Pattern types matching WGSL shader constants */
export enum PatternType {
  PULSE = 0,      // Sinusoidal brightness pulse
  CHASE = 1,      // Moving chase light with trail
  WAVE = 2,       // Sine wave propagation
  BEAT_SYNC = 3,  // Audio-reactive pulse
  MORSE = 4,      // Binary on/off for text
  SPARKLE = 5,    // Random twinkle
}

/** Per-satellite pattern data (matches WGSL struct layout) */
export interface PatternData {
  brightnessMod: number;  // Base brightness multiplier (0-1)
  patternId: PatternType; // Pattern type enum
  phaseOffset: number;    // Phase offset in radians
  speedMult: number;      // Speed multiplier
}

/** Uniform data for the compute shader */
export interface SkyStripUniforms {
  time: number;
  beatIntensity: number;   // Audio-reactive intensity (0-1)
  beatPulse: number;       // Instant beat pulse (0-1)
  bpm: number;             // Beats per minute
  globalBrightness: number;
  patternBlend: number;
  morseSpeed: number;      // Words per minute
  sparkleDensity: number;
}

/** Timeline event for pattern sequencing */
export interface PatternEvent {
  startTime: number;       // Global time to start
  duration: number;        // Duration in seconds
  satelliteRange: {        // Which satellites to affect
    start: number;
    count: number;
  };
  pattern: PatternType;
  params: {
    brightness?: number;
    phaseOffset?: number;
    speed?: number;
  };
}

/** Predefined pattern presets */
export const PATTERN_PRESETS = {
  /** All satellites pulse in unison */
  UNISON_PULSE: {
    pattern: PatternType.PULSE,
    brightness: 1.0,
    speed: 1.0,
    phaseOffset: 0,
  },
  
  /** Wave propagates around the orbit */
  ORBITAL_WAVE: {
    pattern: PatternType.WAVE,
    brightness: 0.9,
    speed: 0.5,
    phaseOffset: 0,
  },
  
  /** Chase lights running through constellation */
  CHASE_SEQUENCE: {
    pattern: PatternType.CHASE,
    brightness: 1.0,
    speed: 2.0,
    phaseOffset: 0,
  },
  
  /** Reactive to music beats */
  BEAT_REACTIVE: {
    pattern: PatternType.BEAT_SYNC,
    brightness: 0.8,
    speed: 1.0,
    phaseOffset: 0,
  },
  
  /** Random twinkling stars */
  TWINKLE_FIELD: {
    pattern: PatternType.SPARKLE,
    brightness: 0.7,
    speed: 1.0,
    phaseOffset: 0,
  },
  
  /** "GROK" in morse code */
  MORSE_GROK: {
    pattern: PatternType.MORSE,
    brightness: 1.0,
    speed: 15,  // 15 WPM
    phaseOffset: 0,
  },
};

/**
 * Pattern Sequencer - Main controller for Sky Strips
 */
export class PatternSequencer {
  private patternData: Float32Array;
  private uniforms: SkyStripUniforms;
  private timeline: PatternEvent[] = [];
  private startTime: number = 0;
  private isPlaying: boolean = false;
  
  // Audio analysis state
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private frequencyData: Uint8Array | null = null;
  
  constructor(
    private numSatellites: number = 1048576,
    private buffers: SatelliteBufferSet | null = null
  ) {
    // Allocate pattern data buffer (16 bytes per satellite = 4 floats)
    this.patternData = new Float32Array(numSatellites * 4);
    
    // Initialize with default uniforms
    this.uniforms = {
      time: 0,
      beatIntensity: 0,
      beatPulse: 0,
      bpm: 120,
      globalBrightness: 0.8,
      patternBlend: 1.0,
      morseSpeed: 15,
      sparkleDensity: 0.1,
    };
    
    // Initialize default patterns
    this.initializeDefaultPatterns();
  }
  
  /**
   * Initialize pattern buffer with default values
   * Groups satellites by orbital plane for varied effects
   */
  private initializeDefaultPatterns(): void {
    const { patternData, numSatellites } = this;
    
    for (let i = 0; i < numSatellites; i++) {
      const idx = i * 4;
      
      // Distribute phase across constellation
      const phase = (i % 1000) * 0.01;
      
      // Varied pattern by orbital group
      const patternId = Math.floor(i / 10000) % 4;
      
      // Slight speed variation for organic feel
      const speed = 0.8 + Math.random() * 0.4;
      
      // Base brightness with slight variation
      const brightness = 0.7 + Math.random() * 0.3;
      
      patternData[idx + 0] = brightness;      // brightnessMod
      patternData[idx + 1] = patternId;       // patternId
      patternData[idx + 2] = phase;           // phaseOffset
      patternData[idx + 3] = speed;           // speedMult
    }
  }
  
  /**
   * Set a strip pattern for a range of satellites
   */
  setStripPattern(
    startIdx: number,
    count: number,
    patternType: PatternType,
    params: {
      brightness?: number;
      phaseOffset?: number;
      speed?: number;
      phaseSpread?: number;  // Spread phase across range
    } = {}
  ): void {
    const { patternData, numSatellites } = this;
    const endIdx = Math.min(startIdx + count, numSatellites);
    
    const brightness = params.brightness ?? 1.0;
    const basePhase = params.phaseOffset ?? 0;
    const speed = params.speed ?? 1.0;
    const phaseSpread = params.phaseSpread ?? 0.1;
    
    for (let i = startIdx; i < endIdx; i++) {
      const idx = i * 4;
      const localIdx = i - startIdx;
      
      // Calculate distributed phase
      const phase = basePhase + (localIdx / count) * phaseSpread * Math.PI * 2;
      
      patternData[idx + 0] = brightness;
      patternData[idx + 1] = patternType;
      patternData[idx + 2] = phase;
      patternData[idx + 3] = speed;
    }
  }
  
  /**
   * Create a wave pattern that propagates across the constellation
   */
  setWavePattern(
    wavelength: number = 10000,  // Satellites per wavelength
    speed: number = 1.0,
    brightness: number = 1.0
  ): void {
    const { patternData, numSatellites } = this;
    
    for (let i = 0; i < numSatellites; i++) {
      const idx = i * 4;
      const phase = (i % wavelength) / wavelength * Math.PI * 2;
      
      patternData[idx + 0] = brightness;
      patternData[idx + 1] = PatternType.WAVE;
      patternData[idx + 2] = phase;
      patternData[idx + 3] = speed;
    }
  }
  
  /**
   * Create a chase pattern with multiple "heads"
   */
  setChasePattern(
    numHeads: number = 4,
    trailLength: number = 5000,
    speed: number = 2.0
  ): void {
    const { patternData, numSatellites } = this;
    const headSpacing = numSatellites / numHeads;
    
    for (let i = 0; i < numSatellites; i++) {
      const idx = i * 4;
      
      // Determine which chase head this satellite follows
      const headIdx = Math.floor(i / headSpacing);
      const headOffset = headIdx * headSpacing;
      
      // Phase based on position within trail
      const trailPos = (i - headOffset) / trailLength;
      const phase = trailPos * Math.PI * 2;
      
      patternData[idx + 0] = 1.0;
      patternData[idx + 1] = PatternType.CHASE;
      patternData[idx + 2] = phase;
      patternData[idx + 3] = speed;
    }
  }
  
  /**
   * Set all satellites to the same pattern (unison)
   */
  setUnisonPattern(
    patternType: PatternType,
    brightness: number = 1.0,
    speed: number = 1.0
  ): void {
    const { patternData, numSatellites } = this;
    
    for (let i = 0; i < numSatellites; i++) {
      const idx = i * 4;
      
      // Slight phase variation for organic feel
      const phase = Math.random() * 0.1;
      
      patternData[idx + 0] = brightness;
      patternData[idx + 1] = patternType;
      patternData[idx + 2] = phase;
      patternData[idx + 3] = speed;
    }
  }
  
  /**
   * Clear all patterns to default state
   */
  clearPatterns(): void {
    this.initializeDefaultPatterns();
  }
  
  /**
   * Randomize patterns across the constellation
   */
  randomizePatterns(): void {
    const { patternData, numSatellites } = this;
    
    for (let i = 0; i < numSatellites; i++) {
      const idx = i * 4;
      
      patternData[idx + 0] = 0.5 + Math.random() * 0.5;  // brightness
      patternData[idx + 1] = Math.floor(Math.random() * 6);  // random pattern
      patternData[idx + 2] = Math.random() * Math.PI * 2;    // random phase
      patternData[idx + 3] = 0.5 + Math.random() * 1.0;      // random speed
    }
  }
  
  /**
   * Upload pattern data to GPU
   */
  uploadToGPU(device: GPUDevice, buffer: GPUBuffer): void {
    device.queue.writeBuffer(buffer, 0, this.patternData);
  }
  
  /**
   * Get pattern data buffer (for initialization kernels)
   */
  getPatternData(): Float32Array {
    return this.patternData;
  }
  
  /**
   * Update uniforms and sync with audio if enabled
   */
  updateUniforms(deltaTime: number): SkyStripUniforms {
    this.uniforms.time += deltaTime;
    
    // Update audio analysis if available
    if (this.analyser && this.frequencyData) {
      this.analyser.getByteFrequencyData(this.frequencyData);
      
      // Calculate beat intensity from bass frequencies
      const bassRange = this.frequencyData.slice(0, 10);
      const bassAvg = bassRange.reduce((a, b) => a + b, 0) / bassRange.length;
      this.uniforms.beatIntensity = bassAvg / 255;
      
      // Detect beat pulse (sudden increase)
      const beatThreshold = 200;
      const isBeat = bassAvg > beatThreshold;
      this.uniforms.beatPulse = isBeat ? 1.0 : this.uniforms.beatPulse * 0.9;
    }
    
    return this.uniforms;
  }
  
  /**
   * Get current uniforms for GPU upload
   */
  getUniformsArray(): Float32Array {
    const u = this.uniforms;
    return new Float32Array([
      u.time,
      u.beatIntensity,
      u.beatPulse,
      u.bpm,
      u.globalBrightness,
      u.patternBlend,
      u.morseSpeed,
      u.sparkleDensity,
      0, 0, 0, 0,  // 16 bytes padding
    ]);
  }
  
  /**
   * Set global BPM for beat-synced patterns
   */
  setBPM(bpm: number): void {
    this.uniforms.bpm = bpm;
  }
  
  /**
   * Set global brightness
   */
  setGlobalBrightness(brightness: number): void {
    this.uniforms.globalBrightness = Math.max(0, Math.min(1, brightness));
  }
  
  /**
   * Trigger a beat pulse (for manual or external audio sync)
   */
  triggerBeat(): void {
    this.uniforms.beatPulse = 1.0;
  }
  
  /**
   * Connect to Web Audio API for music reactivity
   */
  async connectAudio(audioElement: HTMLAudioElement): Promise<void> {
    try {
      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaElementSource(audioElement);
      this.analyser = this.audioContext.createAnalyser();
      
      this.analyser.fftSize = 256;
      this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
      
      source.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);
      
      console.log('[PatternSequencer] Audio connected for beat sync');
    } catch (err) {
      console.error('[PatternSequencer] Failed to connect audio:', err);
    }
  }
  
  /**
   * Disconnect audio
   */
  disconnectAudio(): void {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
      this.analyser = null;
      this.frequencyData = null;
    }
  }
  
  /**
   * Add a timeline event
   */
  addTimelineEvent(event: PatternEvent): void {
    this.timeline.push(event);
    // Sort by start time
    this.timeline.sort((a, b) => a.startTime - b.startTime);
  }
  
  /**
   * Clear timeline
   */
  clearTimeline(): void {
    this.timeline = [];
  }
  
  /**
   * Play timeline from beginning
   */
  play(): void {
    this.startTime = performance.now();
    this.isPlaying = true;
  }
  
  /**
   * Stop timeline playback
   */
  stop(): void {
    this.isPlaying = false;
  }
  
  /**
   * Update timeline (call every frame)
   */
  updateTimeline(): void {
    if (!this.isPlaying) return;
    
    const currentTime = (performance.now() - this.startTime) / 1000;
    
    // Process active events
    for (const event of this.timeline) {
      if (currentTime >= event.startTime && 
          currentTime < event.startTime + event.duration) {
        // Event is active
        this.setStripPattern(
          event.satelliteRange.start,
          event.satelliteRange.count,
          event.pattern,
          event.params
        );
      }
    }
  }
  
  /**
   * Export current pattern configuration as JSON
   */
  exportConfig(): object {
    return {
      uniforms: { ...this.uniforms },
      patternData: Array.from(this.patternData.slice(0, 1000)), // Sample first 1000
      timeline: this.timeline,
    };
  }
  
  /**
   * Import pattern configuration from JSON
   */
  importConfig(config: any): void {
    if (config.uniforms) {
      Object.assign(this.uniforms, config.uniforms);
    }
    if (config.timeline) {
      this.timeline = config.timeline;
    }
  }
}

export default PatternSequencer;
