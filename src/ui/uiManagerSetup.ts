import type { AnimationPattern } from '@/types/animation.js';
import type { QualityLevel } from '@/core/QualityPresets.js';
import type { ImageTuningSettings } from '@/core/ImageTuning.js';
import type { AnimationUIState, ExposureMode, TonemapMode, UIElements } from '@/ui/uiTypes.js';

export interface UIManagerSetupCallbacks {
  onViewChange: ((index: number) => void) | null;
  onPatternChange: ((mode: number) => void) | null;
  onAnimationChange: ((pattern: AnimationPattern) => void) | null;
  onPhysicsChange: ((mode: number) => void) | null;
  onQualityChange: ((level: QualityLevel) => void) | null;
  onSpeedChange: ((speed: number) => void) | null;
  onLoopToggle: ((loop: boolean) => void) | null;
  onDemoToggle: (() => void) | null;
  onDemoAutoToggle: ((enabled: boolean) => void) | null;
  onAudioToggle: ((muted: boolean) => void) | null;
  onTrailsToggle: ((enabled: boolean) => void) | null;
  onTrailLengthChange: ((mode: 'short' | 'medium' | 'long') => void) | null;
  onExposureModeChange: ((mode: ExposureMode) => void) | null;
  onManualExposureChange: ((value: number) => void) | null;
  onExposureAdaptationSpeedChange: ((value: number) => void) | null;
  onTonemapModeChange: ((mode: TonemapMode) => void) | null;
  onImageTuningChange: ((settings: ImageTuningSettings) => void) | null;
  onGodIdleOrbitToggle: ((enabled: boolean) => void) | null;
  onConstellationGuidesToggle: ((enabled: boolean) => void) | null;
  onMoonRingGuideToggle: ((enabled: boolean) => void) | null;
  onMoonScaleHudToggle: ((enabled: boolean) => void) | null;
}

export interface UIManagerSetupActions {
  setActiveButton(index: number): void;
  setActivePatternButton(mode: number): void;
  setActiveAnimationButton(patternIdx: number): void;
  setActivePhysicsButton(mode: number): void;
  setActiveQualityButton(level: QualityLevel): void;
  setAudioMuted(muted: boolean): void;
  setTrailsEnabled(enabled: boolean): void;
  setDemoAutoEnabled(enabled: boolean): void;
}

export interface UIManagerSetupContext {
  elements: UIElements;
  animationState: AnimationUIState;
  callbacks: UIManagerSetupCallbacks;
  actions: UIManagerSetupActions;
  getDemoAutoEnabled(): boolean;
  getLastImageTuning(): ImageTuningSettings;
  getImageTuningEnforceFloors(): boolean;
}

export function getElements(): UIElements {
  const getEl = (id: string) => document.getElementById(id)!;

  return {
    altitude: getEl('s-alt'),
    fleet: getEl('s-fleet'),
    fps: getEl('s-fps'),
    viewMode: getEl('s-view'),
    tuningProfile: getEl('s-tuning'),
    visible: getEl('s-visible'),
    quality: getEl('s-quality'),
    error: getEl('error'),
    controls: getEl('controls'),
    buttons: [
      document.getElementById('btn0') as HTMLButtonElement,
      document.getElementById('btn1') as HTMLButtonElement,
      document.getElementById('btn2') as HTMLButtonElement,
      document.getElementById('btn3') as HTMLButtonElement,
      document.getElementById('btn4') as HTMLButtonElement,
      document.getElementById('btn5') as HTMLButtonElement,
    ],
    demoButton: document.getElementById('btnDemo') as HTMLButtonElement,
    demoAutoButton: document.getElementById('btnDemoAuto') as HTMLButtonElement,
    patternButtons: [
      document.getElementById('pbtn0') as HTMLButtonElement,
      document.getElementById('pbtn1') as HTMLButtonElement,
      document.getElementById('pbtn2') as HTMLButtonElement,
    ],
    animationButtons: [
      document.getElementById('anim3') as HTMLButtonElement,
      document.getElementById('anim4') as HTMLButtonElement,
      document.getElementById('anim5') as HTMLButtonElement,
    ],
    physicsButtons: [
      document.getElementById('phys0') as HTMLButtonElement,
      document.getElementById('phys1') as HTMLButtonElement,
      document.getElementById('phys2') as HTMLButtonElement,
    ],
    qualityButtons: [
      document.getElementById('qlow') as HTMLButtonElement,
      document.getElementById('qbal') as HTMLButtonElement,
      document.getElementById('qhigh') as HTMLButtonElement,
      document.getElementById('qcine') as HTMLButtonElement,
    ],
    audioToggleButton:
      (document.getElementById('audioToggle') as HTMLButtonElement | null) ?? undefined,
    trailsToggleButton:
      (document.getElementById('trailsToggle') as HTMLButtonElement | null) ?? undefined,
    trailsLengthSelect:
      (document.getElementById('trailsLength') as HTMLSelectElement | null) ?? undefined,
    exposureModeSelect:
      (document.getElementById('exposureMode') as HTMLSelectElement | null) ?? undefined,
    manualExposureSlider:
      (document.getElementById('manualExposure') as HTMLInputElement | null) ?? undefined,
    manualExposureValue: document.getElementById('manualExposureValue') ?? undefined,
    exposureSpeedSlider:
      (document.getElementById('exposureSpeed') as HTMLInputElement | null) ?? undefined,
    exposureSpeedValue: document.getElementById('exposureSpeedValue') ?? undefined,
    tonemapModeSelect:
      (document.getElementById('tonemapMode') as HTMLSelectElement | null) ?? undefined,
    tuneBloomThresholdSlider:
      (document.getElementById('tuneBloomThreshold') as HTMLInputElement | null) ?? undefined,
    tuneBloomThresholdValue: document.getElementById('tuneBloomThresholdValue') ?? undefined,
    tuneBloomKneeSlider:
      (document.getElementById('tuneBloomKnee') as HTMLInputElement | null) ?? undefined,
    tuneBloomKneeValue: document.getElementById('tuneBloomKneeValue') ?? undefined,
    tuneBloomIntensitySlider:
      (document.getElementById('tuneBloomIntensity') as HTMLInputElement | null) ?? undefined,
    tuneBloomIntensityValue: document.getElementById('tuneBloomIntensityValue') ?? undefined,
    tuneSatCoreSlider:
      (document.getElementById('tuneSatCore') as HTMLInputElement | null) ?? undefined,
    tuneSatCoreValue: document.getElementById('tuneSatCoreValue') ?? undefined,
    tuneSatFalloffSlider:
      (document.getElementById('tuneSatFalloff') as HTMLInputElement | null) ?? undefined,
    tuneSatFalloffValue: document.getElementById('tuneSatFalloffValue') ?? undefined,
    tuneAnimIntensitySlider:
      (document.getElementById('tuneAnimIntensity') as HTMLInputElement | null) ?? undefined,
    tuneAnimIntensityValue: document.getElementById('tuneAnimIntensityValue') ?? undefined,
    godIdleOrbitToggle:
      (document.getElementById('godIdleOrbitToggle') as HTMLInputElement | null) ?? undefined,
    constellationGuidesToggle:
      (document.getElementById('constellationGuidesToggle') as HTMLInputElement | null) ??
      undefined,
    moonRingGuideToggle:
      (document.getElementById('moonRingGuideToggle') as HTMLInputElement | null) ?? undefined,
    moonScaleHudToggle:
      (document.getElementById('moonScaleHudToggle') as HTMLInputElement | null) ?? undefined,
    horizonIndicator: getEl('horizon-indicator'),
    horizonLimbLine: getEl('horizon-limb-line'),
    moonScaleAnnotation: getEl('moon-scale-annotation'),
    fleetCockpitHud: getEl('fleet-cockpit-hud'),
    fleetReticle: getEl('fleet-reticle'),
    fleetHudLeft: getEl('fleet-hud-left'),
    fleetHudRight: getEl('fleet-hud-right'),
    fleetHudSpeed: getEl('fleet-hud-speed'),
    fleetHudAltitude: getEl('fleet-hud-altitude'),
    fleetHudHeading: getEl('fleet-hud-heading'),
    fleetHudNearby: getEl('fleet-hud-nearby'),
    angleInfo: getEl('angleInfo'),
    resetAngleBtn: getEl('resetAngle'),
    animationControls: getEl('animation-controls'),
  };
}

export function readImageTuningFromUI(ctx: UIManagerSetupContext): ImageTuningSettings {
  const last = ctx.getLastImageTuning();
  return {
    bloomThreshold: Number(ctx.elements.tuneBloomThresholdSlider?.value ?? 1.5),
    bloomKnee: Number(ctx.elements.tuneBloomKneeSlider?.value ?? 0.05),
    bloomIntensity: Number(ctx.elements.tuneBloomIntensitySlider?.value ?? 2.25),
    satCoreOuter: Number(ctx.elements.tuneSatCoreSlider?.value ?? 0.4),
    satCoreInner: Number(ctx.elements.tuneSatFalloffSlider?.value ?? 0.1),
    haloStrength: last.haloStrength,
    coreBoost: last.coreBoost,
    distanceCullKm: last.distanceCullKm,
    animationIntensity: last.animationIntensity,
    animationContrast: last.animationContrast,
    animationMasterIntensity: Number(ctx.elements.tuneAnimIntensitySlider?.value ?? 1.0),
    enforceFloors: ctx.getImageTuningEnforceFloors(),
  };
}

export function emitImageTuningChange(ctx: UIManagerSetupContext): void {
  if (ctx.callbacks.onImageTuningChange) {
    ctx.callbacks.onImageTuningChange(readImageTuningFromUI(ctx));
  }
}

export function setupEventListeners(ctx: UIManagerSetupContext): void {
  const { elements, callbacks, actions } = ctx;

  elements.buttons.forEach((btn, index) => {
    btn?.addEventListener('click', () => {
      actions.setActiveButton(index);
      if (callbacks.onViewChange) {
        callbacks.onViewChange(index);
      }
    });
  });

  elements.demoButton?.addEventListener('click', () => {
    if (callbacks.onDemoToggle) {
      callbacks.onDemoToggle();
    }
  });

  elements.demoAutoButton?.addEventListener('click', () => {
    const enabled = !ctx.getDemoAutoEnabled();
    actions.setDemoAutoEnabled(enabled);
    if (callbacks.onDemoAutoToggle) {
      callbacks.onDemoAutoToggle(enabled);
    }
  });

  elements.patternButtons.forEach((btn) => {
    btn?.addEventListener('click', (e) => {
      const target = e.target as HTMLButtonElement;
      const mode = parseInt(target.dataset.pattern || '1');
      actions.setActivePatternButton(mode);
      if (callbacks.onPatternChange) {
        callbacks.onPatternChange(mode);
      }
    });
  });

  elements.animationButtons.forEach((btn) => {
    btn?.addEventListener('click', (e) => {
      const target = e.target as HTMLButtonElement;
      const patternIdx = parseInt(target.dataset.pattern || '3');
      const patternMap: Record<number, AnimationPattern> = {
        3: 'smile',
        4: 'rain',
        5: 'heartbeat',
      };
      const pattern = patternMap[patternIdx] || 'grok';

      actions.setActiveAnimationButton(patternIdx);
      ctx.animationState.currentPattern = pattern;
      ctx.animationState.isPlaying = true;

      if (callbacks.onAnimationChange) {
        callbacks.onAnimationChange(pattern);
      }
    });
  });

  elements.physicsButtons.forEach((btn) => {
    btn?.addEventListener('click', (e) => {
      const target = e.target as HTMLButtonElement;
      if (target.classList.contains('disabled')) return;

      const mode = parseInt(target.dataset.physics || '0');
      actions.setActivePhysicsButton(mode);
      if (callbacks.onPhysicsChange) {
        callbacks.onPhysicsChange(mode);
      }
    });
  });

  elements.qualityButtons.forEach((btn) => {
    btn?.addEventListener('click', (e) => {
      const target = e.target as HTMLButtonElement;
      const level = (target.dataset.quality || 'high') as QualityLevel;
      actions.setActiveQualityButton(level);
      if (callbacks.onQualityChange) {
        callbacks.onQualityChange(level);
      }
    });
  });

  elements.audioToggleButton?.addEventListener('click', () => {
    const nextMuted = elements.audioToggleButton?.classList.contains('active') ?? true;
    actions.setAudioMuted(nextMuted);
    if (callbacks.onAudioToggle) {
      callbacks.onAudioToggle(nextMuted);
    }
  });

  elements.trailsToggleButton?.addEventListener('click', () => {
    const nextEnabled = !(elements.trailsToggleButton?.classList.contains('active') ?? false);
    actions.setTrailsEnabled(nextEnabled);
    if (callbacks.onTrailsToggle) {
      callbacks.onTrailsToggle(nextEnabled);
    }
  });

  elements.trailsLengthSelect?.addEventListener('change', () => {
    const raw = elements.trailsLengthSelect?.value ?? 'medium';
    const mode: 'short' | 'medium' | 'long' = raw === 'short' || raw === 'long' ? raw : 'medium';
    if (callbacks.onTrailLengthChange) {
      callbacks.onTrailLengthChange(mode);
    }
  });

  elements.exposureModeSelect?.addEventListener('change', () => {
    const raw = elements.exposureModeSelect?.value;
    const mode: ExposureMode = raw === 'manual' ? 'manual' : 'auto';
    const manualDisabled = mode === 'auto';
    if (elements.manualExposureSlider) {
      elements.manualExposureSlider.disabled = manualDisabled;
    }
    if (callbacks.onExposureModeChange) {
      callbacks.onExposureModeChange(mode);
    }
  });

  elements.manualExposureSlider?.addEventListener('input', () => {
    const value = Number(elements.manualExposureSlider?.value ?? 1);
    if (elements.manualExposureValue) {
      elements.manualExposureValue.textContent = `${value.toFixed(2)}x`;
    }
    if (callbacks.onManualExposureChange) {
      callbacks.onManualExposureChange(value);
    }
  });

  elements.exposureSpeedSlider?.addEventListener('input', () => {
    const value = Number(elements.exposureSpeedSlider?.value ?? 1.8);
    if (elements.exposureSpeedValue) {
      elements.exposureSpeedValue.textContent = value.toFixed(1);
    }
    if (callbacks.onExposureAdaptationSpeedChange) {
      callbacks.onExposureAdaptationSpeedChange(value);
    }
  });

  elements.tonemapModeSelect?.addEventListener('change', () => {
    const parsed = Number(elements.tonemapModeSelect?.value ?? 0);
    const mode: TonemapMode = (parsed >= 0 && parsed <= 3 ? parsed : 0) as TonemapMode;
    if (callbacks.onTonemapModeChange) {
      callbacks.onTonemapModeChange(mode);
    }
  });

  const tuningSliders: Array<{
    slider?: HTMLInputElement;
    valueEl?: HTMLElement;
    decimals: number;
  }> = [
    {
      slider: elements.tuneBloomThresholdSlider,
      valueEl: elements.tuneBloomThresholdValue,
      decimals: 2,
    },
    { slider: elements.tuneBloomKneeSlider, valueEl: elements.tuneBloomKneeValue, decimals: 2 },
    {
      slider: elements.tuneBloomIntensitySlider,
      valueEl: elements.tuneBloomIntensityValue,
      decimals: 2,
    },
    { slider: elements.tuneSatCoreSlider, valueEl: elements.tuneSatCoreValue, decimals: 2 },
    { slider: elements.tuneSatFalloffSlider, valueEl: elements.tuneSatFalloffValue, decimals: 2 },
    {
      slider: elements.tuneAnimIntensitySlider,
      valueEl: elements.tuneAnimIntensityValue,
      decimals: 2,
    },
  ];

  for (const { slider, valueEl, decimals } of tuningSliders) {
    slider?.addEventListener('input', () => {
      const val = Number(slider.value);
      if (valueEl) {
        valueEl.textContent = val.toFixed(decimals);
      }
      emitImageTuningChange(ctx);
    });
  }

  elements.godIdleOrbitToggle?.addEventListener('change', () => {
    const enabled = elements.godIdleOrbitToggle?.checked ?? true;
    if (callbacks.onGodIdleOrbitToggle) {
      callbacks.onGodIdleOrbitToggle(enabled);
    }
  });

  elements.constellationGuidesToggle?.addEventListener('change', () => {
    const enabled = elements.constellationGuidesToggle?.checked ?? false;
    if (callbacks.onConstellationGuidesToggle) {
      callbacks.onConstellationGuidesToggle(enabled);
    }
  });

  elements.moonRingGuideToggle?.addEventListener('change', () => {
    const enabled = elements.moonRingGuideToggle?.checked ?? false;
    if (callbacks.onMoonRingGuideToggle) {
      callbacks.onMoonRingGuideToggle(enabled);
    }
  });

  elements.moonScaleHudToggle?.addEventListener('change', () => {
    const enabled = elements.moonScaleHudToggle?.checked ?? false;
    if (callbacks.onMoonScaleHudToggle) {
      callbacks.onMoonScaleHudToggle(enabled);
    }
  });
}

export function setupMobileMenu(elements: UIElements): void {
  const toggle = document.getElementById('menu-toggle');
  const controls = elements.controls;
  if (!toggle || !controls) return;

  const setOpen = (open: boolean): void => {
    controls.classList.toggle('mobile-open', open);
    toggle.textContent = open ? '✕' : '☰';
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!controls.classList.contains('mobile-open'));
  });

  document.addEventListener('click', (e) => {
    if (
      controls.classList.contains('mobile-open') &&
      !controls.contains(e.target as Node) &&
      !toggle.contains(e.target as Node)
    ) {
      setOpen(false);
    }
  });
}

export function createAnimationControls(
  elements: UIElements,
  animationState: AnimationUIState,
  callbacks: Pick<UIManagerSetupCallbacks, 'onSpeedChange' | 'onLoopToggle'>,
): void {
  const container = document.createElement('div');
  container.className = 'animation-controls-extended';
  container.innerHTML = `
      <div class="anim-controls-row">
        <label>Speed:</label>
        <input type="range" id="animSpeed" min="0.25" max="4.0" step="0.25" value="1.0">
        <span id="animSpeedValue">1.0x</span>
      </div>
      <div class="anim-controls-row">
        <label>Loop:</label>
        <input type="checkbox" id="animLoop" checked>
      </div>
    `;

  elements.animationControls?.appendChild(container);

  const speedSlider = document.getElementById('animSpeed') as HTMLInputElement;
  const speedValue = document.getElementById('animSpeedValue');
  const loopCheckbox = document.getElementById('animLoop') as HTMLInputElement;

  speedSlider?.addEventListener('input', (e) => {
    const value = parseFloat((e.target as HTMLInputElement).value);
    animationState.speed = value;
    if (speedValue) speedValue.textContent = value.toFixed(2) + 'x';
    if (callbacks.onSpeedChange) {
      callbacks.onSpeedChange(value);
    }
  });

  loopCheckbox?.addEventListener('change', (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    animationState.loop = checked;
    if (callbacks.onLoopToggle) {
      callbacks.onLoopToggle(checked);
    }
  });
}
