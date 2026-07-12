/**
 * Grok Zephyr - UI Manager
 *
 * Handles HUD updates, stats display, control buttons, and animation controls.
 */

import type { PerformanceStats } from '@/types/index.js';
import type { AnimationPattern } from '@/types/animation.js';
import type { QualityLevel } from '@/core/QualityPresets.js';
import { QUALITY_PRESETS } from '@/core/QualityPresets.js';
import type { PerformanceProfiler } from '@/utils/PerformanceProfiler.js';
import type { ImageTuningSettings } from '@/core/ImageTuning.js';
import { SHIPPING_IMAGE_TUNING } from '@/core/ImageTuning.js';
import type {
  AnimationUIState,
  ExposureMode,
  IDashboard,
  TonemapMode,
  UIElements,
} from '@/ui/uiTypes.js';
export type { AnimationUIState, ExposureMode, TonemapMode, UIElements } from '@/ui/uiTypes.js';
import {
  createAnimationControls,
  getElements,
  setupEventListeners,
  setupMobileMenu,
  type UIManagerSetupCallbacks,
} from '@/ui/uiManagerSetup.js';
import {
  createTimeScaleControl,
  updateSimTimeDisplay,
  type TimeScaleControlState,
} from '@/ui/timeScaleControl.js';

/**
 * UI Manager
 *
 * Manages all UI updates and interactions including:
 * - View mode buttons
 * - Beam pattern buttons
 * - Animation pattern buttons with speed/loop controls
 * - Physics mode buttons
 * - Stats display
 */
export class UIManager {
  private elements: UIElements;
  private callbacks: UIManagerSetupCallbacks = {
    onViewChange: null,
    onPatternChange: null,
    onAnimationChange: null,
    onPhysicsChange: null,
    onQualityChange: null,
    onSpeedChange: null,
    onLoopToggle: null,
    onDemoToggle: null,
    onDemoAutoToggle: null,
    onAudioToggle: null,
    onTrailsToggle: null,
    onTrailLengthChange: null,
    onExposureModeChange: null,
    onManualExposureChange: null,
    onExposureAdaptationSpeedChange: null,
    onTonemapModeChange: null,
    onImageTuningChange: null,
    onGodIdleOrbitToggle: null,
    onConstellationGuidesToggle: null,
    onMoonRingGuideToggle: null,
    onMoonScaleHudToggle: null,
  };
  private imageTuningEnforceFloors = true;
  private lastImageTuning: ImageTuningSettings = { ...SHIPPING_IMAGE_TUNING };

  private animationState: AnimationUIState = {
    currentPattern: 'grok',
    speed: 1.0,
    isPlaying: false,
    loop: true,
  };

  private dashboard: IDashboard | null = null;
  private currentQualityLevel: QualityLevel = 'high';
  private demoAutoEnabled = true;

  private timeScaleState: TimeScaleControlState;

  constructor() {
    this.elements = getElements();
    this.timeScaleState = {
      elements: this.elements,
      currentTimeScale: 1.0,
      onTimeScaleChange: null,
    };
    setupEventListeners({
      elements: this.elements,
      animationState: this.animationState,
      callbacks: this.callbacks,
      actions: this,
      getDemoAutoEnabled: () => this.demoAutoEnabled,
      getLastImageTuning: () => this.lastImageTuning,
      getImageTuningEnforceFloors: () => this.imageTuningEnforceFloors,
    });
    createAnimationControls(this.elements, this.animationState, this.callbacks);
    setupMobileMenu(this.elements);
  }

  setActiveButton(index: number): void {
    this.elements.buttons.forEach((btn, i) => {
      btn?.classList.toggle('active', i === index);
    });
  }

  setDemoActive(active: boolean): void {
    this.elements.demoButton?.classList.toggle('active', active);
    this.elements.demoButton.textContent = active ? 'DEMO STOP' : 'CINEMATIC DEMO';
  }

  setDemoAutoEnabled(enabled: boolean): void {
    this.demoAutoEnabled = enabled;
    this.elements.demoAutoButton?.classList.toggle('active', enabled);
    this.elements.demoAutoButton.textContent = enabled ? 'AUTO DEMO: ON' : 'AUTO DEMO: OFF';
  }

  setActivePatternButton(mode: number): void {
    this.elements.patternButtons.forEach((btn) => {
      const btnMode = parseInt(btn?.dataset.pattern || '-1');
      btn?.classList.toggle('active', btnMode === mode);
    });
  }

  setActiveAnimationButton(patternIdx: number): void {
    this.elements.animationButtons.forEach((btn) => {
      const btnPattern = parseInt(btn?.dataset.pattern || '-1');
      btn?.classList.toggle('active', btnPattern === patternIdx);
    });
  }

  setActivePhysicsButton(mode: number): void {
    this.elements.physicsButtons.forEach((btn) => {
      const btnMode = parseInt(btn?.dataset.physics || '-1');
      btn?.classList.toggle('active', btnMode === mode);
    });
  }

  setActiveQualityButton(level: QualityLevel): void {
    this.elements.qualityButtons.forEach((btn) => {
      const btnLevel = btn?.dataset.quality as QualityLevel | undefined;
      btn?.classList.toggle('active', btnLevel === level);
    });
    this.setQualityDisplay(level);
  }

  setQualityDisplay(level: QualityLevel): void {
    const preset = QUALITY_PRESETS[level];
    if (this.elements.quality) {
      this.elements.quality.textContent = `Quality  : ${preset.label}`;
    }

    this.currentQualityLevel = level;
    if (this.dashboard) {
      this.dashboard.updateQualityPreset(level);
    }
  }

  setViewMode(modeName: string, altitude: string): void {
    this.elements.viewMode.textContent = `View     : ${modeName}`;
    this.elements.altitude.textContent = `Altitude : ${altitude} km`;
    if (modeName === '720km Horizon') {
      this.elements.horizonIndicator.style.display = 'block';
      this.elements.horizonLimbLine.style.display = 'block';
      this.elements.horizonIndicator.innerHTML = `
        <div>Earth Radius: 6,371 km</div>
        <div>Orbit Altitude: 550 km</div>
        <div>Camera Altitude: 720 km</div>
        <div>Horizon Distance: ~2,970 km</div>
      `;
    } else if (modeName === 'Ground View') {
      this.elements.horizonIndicator.style.display = 'block';
      this.elements.horizonLimbLine.style.display = 'none';
      this.elements.horizonIndicator.innerHTML = `
        <div>Earth Radius: 6,371 km</div>
        <div>Orbit Altitude: 550 km</div>
        <div>Camera Altitude: 0 km (Surface)</div>
        <div>Zenith View: Starlink Constellation</div>
      `;
    } else if (modeName === 'Moon View') {
      this.elements.horizonIndicator.style.display = 'block';
      this.elements.horizonLimbLine.style.display = 'none';
      this.elements.horizonIndicator.innerHTML = `
        <div>Earth-Moon Distance: 384,400 km</div>
        <div>Earth Angular Diameter: ~1.9°</div>
        <div>Constellation Ring: 550 km altitude</div>
        <div>View: Lunar surface toward Earth</div>
      `;
    } else {
      this.elements.horizonIndicator.style.display = 'none';
      this.elements.horizonLimbLine.style.display = 'none';
      this.elements.moonScaleAnnotation.style.display = 'none';
    }
  }

  setMoonScaleAnnotation(visible: boolean): void {
    const el = this.elements.moonScaleAnnotation;
    el.style.display = visible ? 'block' : 'none';
    if (visible) {
      el.textContent = 'Earth Ø 1.9° · Ring @ 550 km';
    }
  }

  setHorizonLimbGuide(normalizedY: number | null): void {
    const line = this.elements.horizonLimbLine;
    if (normalizedY === null || !Number.isFinite(normalizedY)) {
      line.style.display = 'none';
      return;
    }
    line.style.display = 'block';
    const clamped = Math.max(0.02, Math.min(0.98, normalizedY));
    line.style.top = `${(clamped * 100).toFixed(2)}%`;
  }

  setFleetCockpitVisible(visible: boolean): void {
    this.elements.fleetCockpitHud.classList.toggle('visible', visible);
    this.elements.fleetCockpitHud.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  setFleetCockpitTelemetry(speedKms: number, altitudeKm: number, headingDeg: number, nearbyCount: number): void {
    this.elements.fleetHudSpeed.textContent = `${speedKms.toFixed(2)} km/s`;
    this.elements.fleetHudAltitude.textContent = `${Math.round(altitudeKm)} km`;
    this.elements.fleetHudHeading.textContent = `${Math.round(headingDeg)}°`;
    this.elements.fleetHudNearby.textContent = String(nearbyCount);
  }

  setFleetCockpitDrift(reticlePxX: number, reticlePxY: number, hudJitterPx: number): void {
    this.elements.fleetReticle.style.transform = `translate(${reticlePxX.toFixed(1)}px, ${reticlePxY.toFixed(1)}px)`;
    const jitter = `translate(${hudJitterPx.toFixed(2)}px, ${(-hudJitterPx * 0.6).toFixed(2)}px)`;
    this.elements.fleetHudLeft.style.transform = jitter;
    this.elements.fleetHudRight.style.transform = jitter;
  }

  setTuningProfile(label: string): void {
    this.elements.tuningProfile.textContent = `Tuning   : ${label}`;
  }

  setFPS(fps: number): void {
    this.elements.fps.textContent = `FPS      : ${fps}`;
  }

  setFleetCount(count: number): void {
    this.elements.fleet.textContent = `Fleet    : ${count.toLocaleString()}`;
  }

  setVisibleCount(count: number): void {
    this.elements.visible.textContent = `Visible  : ${count.toLocaleString()}`;
  }

  setDataSource(label: string): void {
    let el = document.getElementById('s-datasrc');
    if (!el) {
      el = document.createElement('div');
      el.id = 's-datasrc';
      el.className = 'stat';
      this.elements.fleet.parentElement?.insertBefore(el, this.elements.fleet.nextSibling);
    }
    el.textContent = `Source   : ${label}`;
  }

  setAnimationState(state: Partial<AnimationUIState>): void {
    this.animationState = { ...this.animationState, ...state };

    const speedSlider = document.getElementById('animSpeed') as HTMLInputElement;
    const speedValue = document.getElementById('animSpeedValue');
    const loopCheckbox = document.getElementById('animLoop') as HTMLInputElement;

    if (speedSlider && state.speed !== undefined) {
      speedSlider.value = state.speed.toString();
      if (speedValue) speedValue.textContent = state.speed.toFixed(2) + 'x';
    }

    if (loopCheckbox && state.loop !== undefined) {
      loopCheckbox.checked = state.loop;
    }
  }

  updateStats(stats: PerformanceStats): void {
    this.setFPS(stats.fps);
    this.setVisibleCount(stats.visibleSatellites);

    if (this.dashboard) {
      this.dashboard.updateStats(stats);
    }
  }

  async initializeDashboard(profiler: PerformanceProfiler): Promise<void> {
    if (!this.dashboard) {
      const { PerformanceDashboard } = await import('@/ui/PerformanceDashboard.js');
      this.dashboard = new PerformanceDashboard(profiler);
      this.dashboard.initialize();
      this.dashboard.updateQualityPreset(this.currentQualityLevel);
    }
  }

  destroyDashboard(): void {
    if (this.dashboard) {
      this.dashboard.destroy();
      this.dashboard = null;
    }
  }

  showError(message: string): void {
    this.elements.error.style.display = 'block';
    this.elements.error.innerHTML = `<b>WebGPU Error</b><br>${message}`;
  }

  hideError(): void {
    this.elements.error.style.display = 'none';
  }

  onViewModeChange(callback: (index: number) => void): void {
    this.callbacks.onViewChange = callback;
  }

  onPatternChange(callback: (mode: number) => void): void {
    this.callbacks.onPatternChange = callback;
  }

  onAnimationChange(callback: (pattern: AnimationPattern) => void): void {
    this.callbacks.onAnimationChange = callback;
  }

  onPhysicsChange(callback: (mode: number) => void): void {
    this.callbacks.onPhysicsChange = callback;
  }

  onQualityChange(callback: (level: QualityLevel) => void): void {
    this.callbacks.onQualityChange = callback;
  }

  onSpeedChange(callback: (speed: number) => void): void {
    this.callbacks.onSpeedChange = callback;
  }

  onLoopToggle(callback: (loop: boolean) => void): void {
    this.callbacks.onLoopToggle = callback;
  }

  onDemoToggle(callback: () => void): void {
    this.callbacks.onDemoToggle = callback;
  }

  onDemoAutoToggle(callback: (enabled: boolean) => void): void {
    this.callbacks.onDemoAutoToggle = callback;
  }

  onAudioToggle(callback: (muted: boolean) => void): void {
    this.callbacks.onAudioToggle = callback;
  }

  onTrailsToggle(callback: (enabled: boolean) => void): void {
    this.callbacks.onTrailsToggle = callback;
  }

  onTrailLengthChange(callback: (mode: 'short' | 'medium' | 'long') => void): void {
    this.callbacks.onTrailLengthChange = callback;
  }

  onExposureModeChange(callback: (mode: ExposureMode) => void): void {
    this.callbacks.onExposureModeChange = callback;
  }

  onManualExposureChange(callback: (value: number) => void): void {
    this.callbacks.onManualExposureChange = callback;
  }

  onExposureAdaptationSpeedChange(callback: (value: number) => void): void {
    this.callbacks.onExposureAdaptationSpeedChange = callback;
  }

  onTonemapModeChange(callback: (mode: TonemapMode) => void): void {
    this.callbacks.onTonemapModeChange = callback;
  }

  onImageTuningChange(callback: (settings: ImageTuningSettings) => void): void {
    this.callbacks.onImageTuningChange = callback;
  }

  onGodIdleOrbitToggle(callback: (enabled: boolean) => void): void {
    this.callbacks.onGodIdleOrbitToggle = callback;
  }

  onConstellationGuidesToggle(callback: (enabled: boolean) => void): void {
    this.callbacks.onConstellationGuidesToggle = callback;
  }

  onMoonRingGuideToggle(callback: (enabled: boolean) => void): void {
    this.callbacks.onMoonRingGuideToggle = callback;
  }

  onMoonScaleHudToggle(callback: (enabled: boolean) => void): void {
    this.callbacks.onMoonScaleHudToggle = callback;
  }

  setGodIdleOrbitEnabled(enabled: boolean): void {
    const el = this.elements.godIdleOrbitToggle;
    if (el) el.checked = enabled;
  }

  setConstellationGuidesEnabled(enabled: boolean): void {
    const el = this.elements.constellationGuidesToggle;
    if (el) el.checked = enabled;
  }

  setImageTuningControls(settings: ImageTuningSettings, options?: { enforceFloors?: boolean }): void {
    this.lastImageTuning = { ...settings };
    if (options?.enforceFloors !== undefined) {
      this.imageTuningEnforceFloors = options.enforceFloors;
    }
    const sliders = [
      { el: this.elements.tuneBloomThresholdSlider, val: settings.bloomThreshold, label: this.elements.tuneBloomThresholdValue, decimals: 2 },
      { el: this.elements.tuneBloomKneeSlider, val: settings.bloomKnee, label: this.elements.tuneBloomKneeValue, decimals: 2 },
      { el: this.elements.tuneBloomIntensitySlider, val: settings.bloomIntensity, label: this.elements.tuneBloomIntensityValue, decimals: 2 },
      { el: this.elements.tuneSatCoreSlider, val: settings.satCoreOuter, label: this.elements.tuneSatCoreValue, decimals: 2 },
      { el: this.elements.tuneSatFalloffSlider, val: settings.satCoreInner, label: this.elements.tuneSatFalloffValue, decimals: 2 },
      { el: this.elements.tuneAnimIntensitySlider, val: settings.animationMasterIntensity, label: this.elements.tuneAnimIntensityValue, decimals: 2 },
    ] as const;
    for (const { el, val, label, decimals } of sliders) {
      if (el) el.value = String(val);
      if (label) label.textContent = val.toFixed(decimals);
    }
  }

  setAudioMuted(muted: boolean): void {
    const btn = this.elements.audioToggleButton;
    if (!btn) return;
    btn.textContent = muted ? 'AUDIO OFF' : 'AUDIO ON';
    btn.classList.toggle('active', !muted);
    btn.setAttribute('aria-pressed', muted ? 'false' : 'true');
    btn.setAttribute('title', muted ? 'Enable audio' : 'Mute audio');
  }

  setTrailsEnabled(enabled: boolean): void {
    const btn = this.elements.trailsToggleButton;
    if (!btn) return;
    btn.textContent = enabled ? 'TRAILS ON' : 'TRAILS OFF';
    btn.classList.toggle('active', enabled);
    btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  }

  setTrailLengthMode(mode: 'short' | 'medium' | 'long'): void {
    const sel = this.elements.trailsLengthSelect;
    if (!sel) return;
    sel.value = mode;
  }

  setExposureControls(settings: {
    mode: ExposureMode;
    manualExposure: number;
    adaptationSpeed: number;
    tonemapMode: TonemapMode;
  }): void {
    const modeSel = this.elements.exposureModeSelect;
    const manualSlider = this.elements.manualExposureSlider;
    const manualValue = this.elements.manualExposureValue;
    const speedSlider = this.elements.exposureSpeedSlider;
    const speedValue = this.elements.exposureSpeedValue;
    const tonemapSel = this.elements.tonemapModeSelect;

    if (modeSel) modeSel.value = settings.mode;
    if (manualSlider) {
      manualSlider.value = settings.manualExposure.toFixed(2);
      manualSlider.disabled = settings.mode === 'auto';
    }
    if (manualValue) {
      manualValue.textContent = `${settings.manualExposure.toFixed(2)}x`;
    }
    if (speedSlider) {
      speedSlider.value = settings.adaptationSpeed.toFixed(1);
    }
    if (speedValue) {
      speedValue.textContent = settings.adaptationSpeed.toFixed(1);
    }
    if (tonemapSel) {
      tonemapSel.value = String(settings.tonemapMode);
    }
  }

  createTimeScaleControl(): void {
    createTimeScaleControl(this.timeScaleState);
  }

  updateSimTime(simTime: number): void {
    updateSimTimeDisplay(this.elements, simTime);
  }

  onTimeScaleChange(callback: (scale: number) => void): void {
    this.timeScaleState.onTimeScaleChange = callback;
  }

  getButtons(): HTMLButtonElement[] {
    return this.elements.buttons;
  }

  static createUI(): string {
    return `
      <div id="ui">
        <div class="title">◈ GROK ZEPHYR</div>
        <div class="stat" id="s-alt">Altitude : 720 km</div>
        <div class="stat" id="s-fleet">Fleet    : 1,048,576</div>
        <div class="stat" id="s-fps">FPS      : --</div>
        <div class="stat" id="s-view">View     : 720km Horizon</div>
        <div class="stat" id="s-visible">Visible  : --</div>
      </div>
      <div id="controls">
        <section class="control-group control-group-view" aria-label="View Modes">
          <div class="group-label">VIEW MODES</div>
          <div class="view-btn-grid">
            <button class="vbtn active" id="btn0">720km HORIZON</button>
            <button class="vbtn" id="btn1">GOD VIEW</button>
            <button class="vbtn" id="btn2">FLEET POV</button>
            <button class="vbtn" id="btn3">GROUND VIEW</button>
            <button class="vbtn" id="btn4">MOON VIEW</button>
            <button class="vbtn" id="btn5">SKYLINE</button>
          </div>
          <div class="view-extra-row">
            <button class="vbtn" id="btnDemo" data-no-interrupt-demo="true">CINEMATIC DEMO</button>
            <button class="vbtn active" id="btnDemoAuto">AUTO DEMO: ON</button>
          </div>
        </section>
      </div>
      <div id="horizon-limb-line" aria-hidden="true"></div>
      <div id="horizon-indicator">
        <div>Earth Radius: 6,371 km</div>
        <div>Orbit Altitude: 550 km</div>
        <div>Camera Altitude: 720 km</div>
        <div>Horizon Distance: ~2,970 km</div>
      </div>
      <div id="error"></div>
    `;
  }
}

export default UIManager;
