import { clamp } from '@/utils/math.js';
import { saveImageTuning } from '@/core/ImageTuning.js';
import { applyExposureSettings as applyExposureSettingsImpl } from '@/core/ExposureRuntime.js';
import { CaptureManager } from '@/capture/CaptureManager.js';
import {
  setupGroundPresetButtons,
  setupTAAToggle,
  updateGroundObserverOverlay,
} from '@/app/GroundObserverUI.js';
import {
  setupPatternButtons,
  setupAnimationPatternButtons,
  setupPhysicsButtons,
} from '@/app/PatternController.js';
import { applyViewTuning } from '@/app/ImageTuningController.js';
import type { AppRuntime } from '@/app/AppRuntime.js';

function shouldPlayButtonTick(button: HTMLButtonElement): boolean {
  if (/^btn[0-4]$/.test(button.id)) return false;
  if (button.id.startsWith('pbtn')) return false;
  if (button.id === 'capVideoStart') return false;
  return true;
}

function updateAngleDisplay(yaw: number, pitch: number): void {
  const angleInfo = document.getElementById('angleInfo');
  if (angleInfo) {
    angleInfo.textContent = `Yaw: ${yaw.toFixed(0)}° Pitch: ${pitch.toFixed(0)}°`;
  }
}

export function setupCallbacks(rt: AppRuntime): void {
  rt.camera.onModeChange((_mode, name, altitude) => {
    rt.ui.setViewMode(name, altitude);
    rt.ui.setActiveButton(rt.camera.getViewModeIndex());
    updateGroundObserverOverlay(rt);
    rt.applyGroundPresetEffects(0);
    rt.audio.setViewMode(_mode);
    rt.audio.playModeWhoosh();
  });

  rt.ui.onViewModeChange((index) => {
    rt.camera.setViewMode(index);
  });

  rt.camera.onCinematicChange((active) => {
    rt.ui.setDemoActive(active);
  });

  rt.camera.onUserInteraction(() => {
    rt.registerUserActivity(true);
    void rt.audio.unlock();
  });

  rt.ui.onDemoToggle(() => {
    rt.registerUserActivity(false);
    if (rt.camera.isCinematicActive()) {
      rt.camera.stopCinematic();
    } else {
      rt.camera.startCinematic(performance.now() * 0.001);
    }
  });

  rt.ui.onDemoAutoToggle((enabled) => {
    rt.demoAutoEnabled = enabled;
    rt.registerUserActivity(false);
  });
  rt.ui.onAudioToggle((muted) => {
    void rt.audio.setMuted(muted);
  });
  rt.ui.setAudioMuted(rt.audio.isMuted());
  rt.ui.onTrailsToggle((enabled) => {
    rt.trailToggleOverride = enabled;
    rt.applyQualityPreset(rt.currentQualityLevel);
  });
  rt.ui.onTrailLengthChange((mode) => {
    rt.trailLengthMode = mode;
    rt.applyQualityPreset(rt.currentQualityLevel);
  });
  rt.ui.onExposureModeChange((mode) => {
    rt.exposureSettings.mode = mode;
    rt.applyExposureSettings();
  });
  rt.ui.onManualExposureChange((value) => {
    rt.exposureSettings.manualExposure = clamp(value, 0.1, 10.0);
    rt.applyExposureSettings();
  });
  rt.ui.onExposureAdaptationSpeedChange((value) => {
    rt.exposureSettings.adaptationSpeed = clamp(value, 0.1, 5.0);
    rt.applyExposureSettings();
  });
  rt.ui.onTonemapModeChange((mode) => {
    rt.exposureSettings.tonemapMode = mode;
    rt.applyExposureSettings();
  });
  rt.ui.onImageTuningChange((settings) => {
    rt.imageTuning = settings;
    rt.animationMasterIntensity = settings.animationMasterIntensity;
    rt.imageTuningManualOverride = true;
    applyViewTuning(rt, performance.now() * 0.001);
    saveImageTuning(rt.imageTuning);
  });
  rt.ui.onGodIdleOrbitToggle((enabled) => {
    rt.camera.setGodIdleOrbitEnabled(enabled);
  });
  rt.ui.onConstellationGuidesToggle((enabled) => {
    rt.constellationGuides?.setEnabled(enabled);
  });
  rt.ui.onMoonRingGuideToggle((enabled) => {
    rt.moonRingGuide?.setEnabled(enabled);
  });
  rt.ui.onMoonScaleHudToggle((enabled) => {
    rt.moonScaleHudEnabled = enabled;
    rt.ui.setMoonScaleAnnotation(
      enabled && rt.camera.getViewMode() === 'moon',
    );
  });

  rt.ui.setDemoActive(false);
  rt.ui.setDemoAutoEnabled(rt.demoAutoEnabled);
  rt.ui.setExposureControls(rt.exposureSettings);

  rt.profiler.onStatsUpdate((stats) => {
    rt.ui.updateStats(stats);
    rt.lastVisibleCount = stats.visibleSatellites;
  });

  setupPatternButtons(rt);
  setupAnimationPatternButtons(rt);
  setupPhysicsButtons(rt);
  setupGroundPresetButtons(rt);

  rt.ui.createTimeScaleControl();
  rt.ui.onTimeScaleChange((scale) => {
    rt.timeScale = Math.max(1, Math.min(100000, scale));
    console.log(`⏱️ Time scale: ${rt.timeScale}x`);
  });

  rt.captureManager = new CaptureManager(rt);
  rt.captureManager.setupCaptureControls();

  rt.ui.onQualityChange((level) => {
    rt.applyQualityPreset(level);
  });

  setupTAAToggle(rt);

  rt.camera.onAngleChange((yaw, pitch) => {
    updateAngleDisplay(yaw, pitch);
  });
  rt.camera.onTouchDoubleTap((x, y) => {
    rt.focusSatelliteAtScreenPoint(x, y);
  });

  const resetBtn = document.getElementById('resetAngle');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      rt.camera.resetCameraAngle();
      updateAngleDisplay(0, 0);
    });
  }

  rt.canvas.addEventListener('click', (e) => rt.focusSatelliteAtScreenPoint(e.clientX, e.clientY));
  rt.canvas.addEventListener('dblclick', () => {
    rt.focusManager?.releaseFocus();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      rt.focusManager?.releaseFocus();
    }
  });

  const controls = document.getElementById('controls');
  controls?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    const button = target?.closest('button') as HTMLButtonElement | null;
    if (!button) return;
    rt.registerUserActivity(!button.hasAttribute('data-no-interrupt-demo'));
    if (shouldPlayButtonTick(button)) {
      rt.audio.playButtonTick();
    }
  });
}

export function registerUserActivity(rt: AppRuntime, interruptCinematic: boolean): void {
  rt.lastUserActivityTime = performance.now() * 0.001;
  void rt.audio.unlock();
  if (interruptCinematic && rt.camera.isCinematicActive()) {
    rt.camera.stopCinematic();
  }
}

export function applyExposureSettings(rt: AppRuntime): void {
  applyExposureSettingsImpl(rt);
}
