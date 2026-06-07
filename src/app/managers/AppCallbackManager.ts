
import { GrokZephyrApp } from '@/app/GrokZephyrApp.js';


import { getBackgroundModeIndex, setBackgroundMode } from '@/background.js';
export class AppCallbackManager {
  constructor(private app: GrokZephyrApp) {}

  public setupCallbacks(): void {
    // Camera callbacks
    this.app.camera.onModeChange((_mode, name, altitude) => {
      this.app.ui.setViewMode(name, altitude);
      this.app.ui.setActiveButton(this.app.camera.getViewModeIndex());
      this.app.appUIManager.updateGroundObserverOverlay();
      this.app.audio.setViewMode(_mode);
      this.app.audio.playModeWhoosh();
    });

    this.app.ui.onViewModeChange((index) => {
      this.app.camera.setViewMode(index);
    });

    this.app.camera.onCinematicChange((active) => {
      this.app.ui.setDemoActive(active);
    });

    this.app.camera.onUserInteraction(() => {
      this.app.registerUserActivity(true);
      void this.app.audio.unlock();
    });

    // UI callbacks
    this.app.ui.onDemoToggle(() => {
      this.app.registerUserActivity(false);
      if (this.app.camera.isCinematicActive()) {
        this.app.camera.stopCinematic();
      } else {
        this.app.camera.startCinematic(performance.now() * 0.001);
      }
    });

    this.app.ui.onDemoAutoToggle((enabled) => {
      this.app.autoDemoEnabled = enabled;
      this.app.registerUserActivity(false);
    });

    this.app.ui.onAudioToggle((muted) => {
      void this.app.audio.setMuted(muted);
    });
    this.app.ui.setAudioMuted(this.app.audio.isMuted());

    this.app.ui.onTrailsToggle((enabled) => {
      this.app.trailsEnabled = enabled;
      this.app.appQualityManager.applyQualityPreset(this.app.currentQualityLevel);
    });

    this.app.ui.onTrailLengthChange((mode) => {
      this.app.trailLengthMode = mode;
      this.app.appQualityManager.applyQualityPreset(this.app.currentQualityLevel);
    });

    this.app.ui.onExposureModeChange((mode) => {
      this.app.exposureSettings.tonemapMode = mode;
      this.app.appQualityManager.applyExposureSettings();
    });

    this.app.ui.onManualExposureChange((value) => {
      this.app.exposureSettings.manualExposure = value;
      this.app.appQualityManager.applyExposureSettings();
    });

    // Profiler / Quality callbacks
    this.app.profiler.onQualityChange((suggestedPreset) => {
      if (this.app.currentQualityLevel !== suggestedPreset && !this.app.isMobileDevice) {
        console.log(`📉 Auto-downgrading quality to ${suggestedPreset} to maintain performance`);
        this.app.appQualityManager.applyQualityPreset(suggestedPreset);
        this.app.ui.setQualityPreset(suggestedPreset);
      }
    });

    this.app.ui.onQualityChange((level) => {
      this.app.appQualityManager.applyQualityPreset(level);
    });

    // Background Mode
    this.app.ui.onBackgroundModeChange((mode) => {
       const idx = getBackgroundModeIndex(mode);
       if (idx >= 0) {
          setBackgroundMode(idx);
          this.app.audio.playClick();
       }
    });

    // Time Scale
    this.app.ui.onTimeScaleChange((scale) => {
        this.app.timeScale = scale;
    });

    // Error handling
    window.addEventListener('error', (event) => {
        this.app.handleError(event.error || event.message);
    });

    window.addEventListener('unhandledrejection', (event) => {
        this.app.handleError(event.reason);
    });
  }
}
