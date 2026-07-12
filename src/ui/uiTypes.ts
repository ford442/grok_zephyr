import type { PerformanceStats } from '@/types/index.js';
import type { AnimationPattern } from '@/types/animation.js';
import type { QualityLevel } from '@/core/QualityPresets.js';

export type ExposureMode = 'auto' | 'manual';
export type TonemapMode = 0 | 1 | 2 | 3;

/** UI element references */
export interface UIElements {
  altitude: HTMLElement;
  fleet: HTMLElement;
  fps: HTMLElement;
  viewMode: HTMLElement;
  tuningProfile: HTMLElement;
  visible: HTMLElement;
  quality: HTMLElement;
  error: HTMLElement;
  controls: HTMLElement;
  buttons: HTMLButtonElement[];
  demoButton: HTMLButtonElement;
  demoAutoButton: HTMLButtonElement;
  patternButtons: HTMLButtonElement[];
  animationButtons: HTMLButtonElement[];
  physicsButtons: HTMLButtonElement[];
  qualityButtons: HTMLButtonElement[];
  audioToggleButton?: HTMLButtonElement;
  trailsToggleButton?: HTMLButtonElement;
  trailsLengthSelect?: HTMLSelectElement;
  exposureModeSelect?: HTMLSelectElement;
  manualExposureSlider?: HTMLInputElement;
  manualExposureValue?: HTMLElement;
  exposureSpeedSlider?: HTMLInputElement;
  exposureSpeedValue?: HTMLElement;
  tonemapModeSelect?: HTMLSelectElement;
  tuneBloomThresholdSlider?: HTMLInputElement;
  tuneBloomThresholdValue?: HTMLElement;
  tuneBloomKneeSlider?: HTMLInputElement;
  tuneBloomKneeValue?: HTMLElement;
  tuneBloomIntensitySlider?: HTMLInputElement;
  tuneBloomIntensityValue?: HTMLElement;
  tuneSatCoreSlider?: HTMLInputElement;
  tuneSatCoreValue?: HTMLElement;
  tuneSatFalloffSlider?: HTMLInputElement;
  tuneSatFalloffValue?: HTMLElement;
  tuneAnimIntensitySlider?: HTMLInputElement;
  tuneAnimIntensityValue?: HTMLElement;
  godIdleOrbitToggle?: HTMLInputElement;
  constellationGuidesToggle?: HTMLInputElement;
  moonRingGuideToggle?: HTMLInputElement;
  moonScaleHudToggle?: HTMLInputElement;
  horizonIndicator: HTMLElement;
  horizonLimbLine: HTMLElement;
  moonScaleAnnotation: HTMLElement;
  fleetCockpitHud: HTMLElement;
  fleetReticle: HTMLElement;
  fleetHudLeft: HTMLElement;
  fleetHudRight: HTMLElement;
  fleetHudSpeed: HTMLElement;
  fleetHudAltitude: HTMLElement;
  fleetHudHeading: HTMLElement;
  fleetHudNearby: HTMLElement;
  angleInfo: HTMLElement;
  resetAngleBtn: HTMLElement;
  animationControls: HTMLElement;
  timeControls?: HTMLElement;
  simTimeDisplay?: HTMLElement;
  timeScaleSlider?: HTMLInputElement;
  timeScaleValue?: HTMLElement;
}

/** Animation control options */
export interface AnimationUIState {
  currentPattern: AnimationPattern;
  speed: number;
  isPlaying: boolean;
  loop: boolean;
}

/** Minimal interface for PerformanceDashboard */
export interface IDashboard {
  initialize(): void;
  updateStats(stats: PerformanceStats): void;
  updateQualityPreset(level: QualityLevel): void;
  destroy(): void;
}
