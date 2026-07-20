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
import { setupSkylineDisplayButtons } from '@/app/SkylineDisplayController.js';
import { setRealismMode } from '@/app/RealismController.js';
import {
  applyConstellationSelection,
  toggleConstellationGroup,
} from '@/app/loadSatelliteOrbitalData.js';
import { getGroupIdForCatalog } from '@/data/ConstellationGroups.js';
import { bindSimClock } from '@/app/SimClockController.js';
import { applyViewTuning } from '@/app/ViewModeCoordinator.js';
import {
  followSelectedSatellite,
  frameSatelliteInGodView,
  searchAndSelectSatellite,
} from '@/app/SatelliteSelection.js';
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
  bindSimClock(rt);

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
    rt.simulation.demoAutoEnabled = enabled;
    rt.registerUserActivity(false);
  });
  rt.ui.onAudioToggle((muted) => {
    void rt.audio.setMuted(muted);
  });
  rt.ui.setAudioMuted(rt.audio.isMuted());
  rt.ui.onTrailsToggle((enabled) => {
    rt.trailToggleOverride = enabled;
    rt.applyQualityPreset(rt.simulation.currentQualityLevel);
  });
  rt.ui.onTrailLengthChange((mode) => {
    rt.trailLengthMode = mode;
    rt.applyQualityPreset(rt.simulation.currentQualityLevel);
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
    rt.view.imageTuning = settings;
    rt.view.animationMasterIntensity = settings.animationMasterIntensity;
    rt.view.imageTuningManualOverride = true;
    applyViewTuning(rt, performance.now() * 0.001);
    saveImageTuning(rt.view.imageTuning);
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
    rt.ui.setMoonScaleAnnotation(enabled && rt.camera.getViewMode() === 'moon');
  });
  rt.ui.onRealismChange((enabled) => {
    setRealismMode(rt, enabled);
  });

  rt.ui.onConstellationChipClick((catalogId, shiftKey) => {
    const enabled = [...rt.enabledConstellations];
    const isLoaded = enabled.includes(catalogId);

    if (shiftKey) {
      const next = isLoaded
        ? enabled.filter((id) => id !== catalogId)
        : [...enabled, catalogId];
      void applyConstellationSelection(rt, next.length > 0 ? next : []);
      return;
    }

    if (!isLoaded) {
      void applyConstellationSelection(rt, [...enabled, catalogId]);
      return;
    }

    const groupId = getGroupIdForCatalog(catalogId);
    const visibility = rt.buffers?.getGroupVisibilityState().visible ?? rt.webglGroupVisibility;
    const currentlyVisible = visibility[groupId] !== false;
    toggleConstellationGroup(rt, groupId, !currentlyVisible);
    rt.ui.setConstellationChips(
      rt.enabledConstellations,
      rt.constellationGroupCounts,
      rt.buffers?.getGroupVisibilityState().visible ?? rt.webglGroupVisibility,
    );
  });

  rt.ui.setDemoActive(false);
  rt.ui.setDemoAutoEnabled(rt.simulation.demoAutoEnabled);
  rt.ui.setExposureControls(rt.exposureSettings);

  rt.profiler.onStatsUpdate((stats) => {
    rt.ui.updateStats(stats);
    rt.lastVisibleCount = stats.visibleSatellites;
  });

  setupPatternButtons(rt);
  setupAnimationPatternButtons(rt);
  setupPhysicsButtons(rt);
  setupGroundPresetButtons(rt);
  setupSkylineDisplayButtons(rt);

  rt.ui.createSimTransport(() => rt.simulation.clock);
  rt.ui.updateSimClock(rt.simulation.clock);

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

  document.addEventListener('satellite-follow', () => {
    followSelectedSatellite(rt);
  });
  document.addEventListener('satellite-frame-god', () => {
    if (rt.selectedSatelliteIndex >= 0) {
      frameSatelliteInGodView(rt, rt.selectedSatelliteIndex);
    }
  });

  setupSatelliteSearch(rt);

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
  rt.simulation.lastUserActivityTime = performance.now() * 0.001;
  void rt.audio.unlock();
  if (interruptCinematic && rt.camera.isCinematicActive()) {
    rt.camera.stopCinematic();
  }
}

export function applyExposureSettings(rt: AppRuntime): void {
  applyExposureSettingsImpl(rt);
}

function setupSatelliteSearch(rt: AppRuntime): void {
  const input = document.getElementById('satelliteSearch') as HTMLInputElement | null;
  const resultsEl = document.getElementById('satelliteSearchResults');
  if (!input || !resultsEl) return;

  let debounceId = 0;

  const hideResults = (): void => {
    resultsEl.hidden = true;
    resultsEl.replaceChildren();
  };

  const renderResults = (query: string): void => {
    resultsEl.replaceChildren();
    if (!query.trim()) {
      hideResults();
      return;
    }

    const indices = rt.satelliteCatalog.search(query, 8);
    if (indices.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'satellite-search-empty';
      empty.textContent = 'No matches';
      resultsEl.appendChild(empty);
      resultsEl.hidden = false;
      return;
    }

    for (const index of indices) {
      const identity = rt.satelliteCatalog.getIdentity(index);
      const li = document.createElement('li');
      li.className = 'satellite-search-item';
      const norad =
        identity?.noradId !== null && identity?.noradId !== undefined
          ? ` · NORAD ${identity.noradId}`
          : '';
      const group =
        identity?.groupLabel && identity.groupLabel !== 'Walker'
          ? ` · ${identity.groupLabel}`
          : '';
      li.textContent = `${identity?.name ?? `SAT #${index}`}${group}${norad}`;
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        input.value = identity?.name ?? String(index);
        hideResults();
        frameSatelliteInGodView(rt, index);
      });
      resultsEl.appendChild(li);
    }
    resultsEl.hidden = false;
  };

  input.addEventListener('input', () => {
    window.clearTimeout(debounceId);
    debounceId = window.setTimeout(() => renderResults(input.value), 120);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      searchAndSelectSatellite(rt, input.value);
      hideResults();
    } else if (e.key === 'Escape') {
      hideResults();
      input.blur();
    }
  });

  input.addEventListener('blur', () => {
    window.setTimeout(hideResults, 150);
  });
}
