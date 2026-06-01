import type { ViewMode } from '@/types/index.js';

type AmbientProfile = {
  droneHz: number;
  textureHz: number;
  noiseCutoffHz: number;
  textureGain: number;
};

const AUDIO_MUTED_STORAGE_KEY = 'gz.audio.muted';
const AMBIENT_PROFILES: Record<ViewMode, AmbientProfile> = {
  'horizon-720': { droneHz: 58, textureHz: 0.11, noiseCutoffHz: 420, textureGain: 0.18 },
  god:           { droneHz: 54, textureHz: 0.08, noiseCutoffHz: 380, textureGain: 0.16 },
  'sat-pov':     { droneHz: 76, textureHz: 0.22, noiseCutoffHz: 620, textureGain: 0.24 },
  ground:        { droneHz: 66, textureHz: 0.16, noiseCutoffHz: 1100, textureGain: 0.28 },
  moon:          { droneHz: 49, textureHz: 0.06, noiseCutoffHz: 260, textureGain: 0.14 },
};

/**
 * Procedural audio engine for ambient layers and interaction/UI cues.
 * Safe by default: muted until user enables audio and a user gesture unlocks AudioContext.
 */
export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private unlocked = false;
  private initializing = false;
  private muted = true;
  private currentMode: ViewMode = 'horizon-720';

  private masterGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private uiGain: GainNode | null = null;
  private interactionGain: GainNode | null = null;

  private ambientLayers = new Map<ViewMode, GainNode>();
  private ambientSources: AudioScheduledSourceNode[] = [];
  private textureLfoByMode = new Map<ViewMode, OscillatorNode>();

  constructor() {
    this.muted = this.loadMutedPreference();
  }

  isMuted(): boolean {
    return this.muted;
  }

  async unlock(): Promise<void> {
    if (this.unlocked || this.muted || this.initializing) return;
    this.initializing = true;

    try {
      if (!this.audioContext) {
        this.audioContext = new AudioContext({ latencyHint: 'interactive' });
        this.setupGraph(this.audioContext);
      }
      if (this.audioContext.state !== 'running') {
        await this.audioContext.resume();
      }
      this.unlocked = this.audioContext.state === 'running';
      if (this.unlocked) {
        this.applyMutedState(false);
        this.applyAmbientMode(this.currentMode, false);
      }
    } catch {
      // Ignore unlock failures to keep autoplay-policy behavior silent and safe.
    } finally {
      this.initializing = false;
    }
  }

  async setMuted(muted: boolean): Promise<void> {
    this.muted = muted;
    this.saveMutedPreference(muted);

    if (muted) {
      this.applyMutedState(true);
      return;
    }

    if (!this.unlocked) {
      await this.unlock();
      return;
    }

    if (this.audioContext && this.audioContext.state !== 'running') {
      try {
        await this.audioContext.resume();
      } catch {
        return;
      }
    }

    this.applyMutedState(false);
  }

  setViewMode(mode: ViewMode): void {
    this.currentMode = mode;
    this.applyAmbientMode(mode, true);
  }

  playButtonTick(): void {
    this.playTick(this.uiGain, 900, 0.018, 0.0009);
  }

  playCaptureToggle(started: boolean): void {
    if (!this.canPlay()) return;
    const base = started ? 420 : 360;
    const second = started ? 560 : 300;
    this.playTick(this.uiGain, base, 0.12, 0.02);
    this.playTick(this.uiGain, second, 0.12, 0.03);
  }

  playPatternChange(mode: number): void {
    if (!this.canPlay()) return;
    const hue = [840, 990, 760][mode] ?? 900;
    this.playTick(this.interactionGain, hue, 0.04, 0.0012);
    this.playTick(this.interactionGain, hue * 1.33, 0.03, 0.02);
  }

  playModeWhoosh(): void {
    if (!this.canPlay()) return;
    const ctx = this.audioContext!;
    const noise = this.createNoiseSource(ctx, 0.16);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(300, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(1400, ctx.currentTime + 0.24);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.24);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.interactionGain!);
    noise.start();
    noise.stop(ctx.currentTime + 0.25);
    noise.onended = () => {
      noise.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }

  playFocusChime(altitudeKm: number): void {
    if (!this.canPlay()) return;
    const normalized = Math.max(0, Math.min(1, (altitudeKm - 250) / 1100));
    const baseHz = 520 + normalized * 220;
    this.playTick(this.interactionGain, baseHz, 0.06, 0.0014);
    this.playTick(this.interactionGain, baseHz * 1.5, 0.04, 0.032);
  }

  destroy(): void {
    for (const src of this.ambientSources) {
      try { src.stop(); } catch {}
      src.disconnect();
    }
    this.ambientSources = [];

    for (const lfo of this.textureLfoByMode.values()) {
      try { lfo.stop(); } catch {}
      lfo.disconnect();
    }
    this.textureLfoByMode.clear();
    this.ambientLayers.clear();

    this.masterGain?.disconnect();
    this.ambientGain?.disconnect();
    this.uiGain?.disconnect();
    this.interactionGain?.disconnect();

    void this.audioContext?.close().catch(() => undefined);
    this.audioContext = null;
    this.unlocked = false;
  }

  private canPlay(): boolean {
    return !this.muted && this.unlocked && !!this.audioContext && this.audioContext.state === 'running';
  }

  private setupGraph(ctx: AudioContext): void {
    const master = ctx.createGain();
    const ambient = ctx.createGain();
    const ui = ctx.createGain();
    const interaction = ctx.createGain();

    master.gain.value = 0.0;
    ambient.gain.value = 0.2;
    ui.gain.value = 0.3;
    interaction.gain.value = 0.35;

    ambient.connect(master);
    ui.connect(master);
    interaction.connect(master);
    master.connect(ctx.destination);

    this.masterGain = master;
    this.ambientGain = ambient;
    this.uiGain = ui;
    this.interactionGain = interaction;

    this.createAmbientLayers(ctx);
  }

  private createAmbientLayers(ctx: AudioContext): void {
    for (const mode of Object.keys(AMBIENT_PROFILES) as ViewMode[]) {
      const profile = AMBIENT_PROFILES[mode];
      const modeGain = ctx.createGain();
      modeGain.gain.value = 0;
      modeGain.connect(this.ambientGain!);
      this.ambientLayers.set(mode, modeGain);

      const drone = ctx.createOscillator();
      drone.type = 'triangle';
      drone.frequency.value = profile.droneHz;
      const droneGain = ctx.createGain();
      droneGain.gain.value = 0.03;
      drone.connect(droneGain);
      droneGain.connect(modeGain);
      drone.start();
      this.ambientSources.push(drone);

      const texture = ctx.createOscillator();
      texture.type = 'sine';
      texture.frequency.value = profile.droneHz * 2.01;
      const textureGain = ctx.createGain();
      textureGain.gain.value = profile.textureGain * 0.015;
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = profile.textureHz;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = profile.textureGain * 0.012;
      lfo.connect(lfoDepth);
      lfoDepth.connect(textureGain.gain);
      texture.connect(textureGain);
      textureGain.connect(modeGain);
      texture.start();
      lfo.start();
      this.ambientSources.push(texture);
      this.textureLfoByMode.set(mode, lfo);

      const noise = this.createNoiseSource(ctx, 2.2);
      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'lowpass';
      noiseFilter.frequency.value = profile.noiseCutoffHz;
      const noiseGain = ctx.createGain();
      noiseGain.gain.value = 0.01;
      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(modeGain);
      noise.start();
      this.ambientSources.push(noise);
    }
  }

  private applyAmbientMode(mode: ViewMode, smooth: boolean): void {
    if (!this.canPlay() || !this.audioContext) return;
    const now = this.audioContext.currentTime;
    const tau = smooth ? 0.45 : 0.14;
    for (const [layerMode, gainNode] of this.ambientLayers) {
      const target = layerMode === mode ? 1.0 : 0.0;
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setTargetAtTime(target, now, tau);
    }
  }

  private applyMutedState(muted: boolean): void {
    if (!this.audioContext || !this.masterGain) return;
    const now = this.audioContext.currentTime;

    if (muted) {
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(0.0, now, 0.03);
      void this.audioContext.suspend().catch(() => undefined);
      return;
    }

    if (this.audioContext.state !== 'running') return;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(0.7, now, 0.12);
  }

  private playTick(targetGain: GainNode | null, frequencyHz: number, duration: number, delay: number): void {
    if (!this.canPlay() || !targetGain || !this.audioContext) return;
    const ctx = this.audioContext;
    const now = ctx.currentTime + Math.max(0, delay);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(frequencyHz, now);
    osc.frequency.exponentialRampToValueAtTime(frequencyHz * 0.96, now + duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(targetGain);
    osc.start(now);
    osc.stop(now + duration + 0.01);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  private createNoiseSource(ctx: AudioContext, durationSec: number): AudioBufferSourceNode {
    const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.5;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    return source;
  }

  private loadMutedPreference(): boolean {
    try {
      const raw = localStorage.getItem(AUDIO_MUTED_STORAGE_KEY);
      if (raw === null) return true;
      return raw === 'true';
    } catch {
      return true;
    }
  }

  private saveMutedPreference(muted: boolean): void {
    try {
      localStorage.setItem(AUDIO_MUTED_STORAGE_KEY, muted ? 'true' : 'false');
    } catch {
      // Ignore persistence failures.
    }
  }
}

export default AudioEngine;
