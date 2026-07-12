/**
 * Grok Zephyr - Main Entry Point
 *
 * WebGPU-powered orbital simulation with 1M+ satellites.
 * Composition root — delegates to modules under src/app/.
 */

import { WebGPUError } from '@/core/WebGPUContext.js';
import { CameraController } from '@/camera/CameraController.js';
import { GroundObserverCamera } from '@/camera/GroundObserverCamera.js';
import { UIManager } from '@/ui/UIManager.js';
import { PerformanceProfiler } from '@/utils/PerformanceProfiler.js';
import { AudioEngine } from '@/audio/AudioEngine.js';
import { SkylineCity } from '@/render/SkylineCity.js';
import { UI as UI_CONSTANTS } from '@/types/constants.js';
import { OnboardingManager } from '@/ui/OnboardingManager.js';
import { WebGPUCompatibilityManager } from '@/ui/WebGPUCompatibilityManager.js';
import { resolveRendererBackend } from '@/webgl/rendererSelection.js';
import {
  parseSavedExposureSettings,
  type ExposureRuntimeSettings,
} from '@/core/ExposureRuntime.js';
import { resolveImageTuning, type ImageTuningSettings } from '@/core/ImageTuning.js';
import type { QualityLevel, VolumetricBeamQualitySettings } from '@/core/QualityPresets.js';
import type { FocusManager, FocusSelection } from '@/focus.js';
import type { CaptureManager } from '@/capture/CaptureManager.js';
import type { AppRuntime } from '@/app/AppRuntime.js';
import { setupCallbacks, registerUserActivity, applyExposureSettings as applyExposureSettingsBinder } from '@/app/AppCallbackBinder.js';
import { bootstrapWebGPU } from '@/app/WebGPUBootstrap.js';
import { createWebGPURenderLoop, recordTrailSamplesForCamera } from '@/app/WebGPURenderLoop.js';
import { initializeWebGL } from '@/app/WebGLSession.js';
import { applyQualityPreset, syncVolumetricBeamConfig } from '@/app/QualityController.js';
import { applyViewTuning } from '@/app/ImageTuningController.js';
import { applyGroundPresetEffects } from '@/app/ViewEffectsController.js';
import {
  setPatternMode as setPatternModeImpl,
  setAnimationPattern as setAnimationPatternImpl,
  setPhysicsMode as setPhysicsModeImpl,
  writePatternParamsBuffer,
  handleFocusSelectionChange as handleFocusSelectionChangeImpl,
  setGroundViewEnabled as setGroundViewEnabledImpl,
} from '@/app/PatternController.js';
import {
  detectMobileDevice,
  detectMobileDefaultQuality,
  getDrawableSize,
  handleResize as handleResizeImpl,
  updateMobileViewportPresentation,
  tryLockLandscapeOrientation,
  setupMobileOrientationSupport,
  teardownMobileOrientationSupport,
} from '@/app/MobilePresentation.js';
import { updateGroundObserverOverlay, applyGroundOverlayClass as applyGroundOverlayClassUi } from '@/app/GroundObserverUI.js';
import { writeUniforms } from '@/app/UniformWriter.js';
import type { CameraState } from '@/camera/CameraController.js';

import './styles.css';
import './styles/onboarding.css';
import './styles/fleet-cockpit.css';

class GrokZephyrApp implements AppRuntime {
  readonly canvas: HTMLCanvasElement;
  readonly backend = resolveRendererBackend();
  readonly isMobileDevice = detectMobileDevice();
  readonly mobileDefaultQuality: QualityLevel = detectMobileDefaultQuality();
  readonly demoIdleTimeoutSeconds = UI_CONSTANTS.DEMO_IDLE_TIMEOUT_SECONDS;

  context = null as AppRuntime['context'];
  buffers = null as AppRuntime['buffers'];
  pipeline = null as AppRuntime['pipeline'];
  postProcessStack = null as AppRuntime['postProcessStack'];
  volumetricBeamRenderer = null as AppRuntime['volumetricBeamRenderer'];
  readonly camera: CameraController;
  readonly groundObserver: GroundObserverCamera;
  readonly ui: UIManager;
  readonly profiler: PerformanceProfiler;
  readonly audio: AudioEngine;
  focusManager: FocusManager | null = null;
  trailRenderer = null as AppRuntime['trailRenderer'];
  constellationGuides = null as AppRuntime['constellationGuides'];
  moonRingGuide = null as AppRuntime['moonRingGuide'];
  earthAtmosphereRenderer = null as AppRuntime['earthAtmosphereRenderer'];
  readonly skyline = new SkylineCity();
  webglRenderer = null as AppRuntime['webglRenderer'];
  webglOrbital = null as AppRuntime['webglOrbital'];
  webglDebugOverlay = null as AppRuntime['webglDebugOverlay'];
  captureManager: CaptureManager | null = null;

  earthVertexBuffer: GPUBuffer | null = null;
  earthIndexBuffer: GPUBuffer | null = null;
  earthIndexCount = 0;

  animationId = 0;
  isRunning = false;
  lastTime = 0;
  trailSamplePhase = 0;
  trailToggleOverride: boolean | null = null;
  trailLengthMode: 'short' | 'medium' | 'long' = 'medium';
  exposureSettings: ExposureRuntimeSettings = parseSavedExposureSettings();
  imageTuning: ImageTuningSettings = resolveImageTuning();
  imageTuningManualOverride = false;
  animationMasterIntensity = 1.0;
  patternSeed = 0;
  patternAnimationStart = 0;
  patternNameDisplay: HTMLElement | null = null;
  selectedSatelliteIndex = -1;
  dataSourceLabel = 'Procedural Walker';
  lastVisibleCount = 0;
  moonScaleHudEnabled = false;
  currentPatternMode = 1;
  volumetricBeamQuality: VolumetricBeamQualitySettings | null = null;
  currentAnimationPattern = 0;
  currentPhysicsMode = 0;
  currentQualityLevel: QualityLevel = 'high';
  qualityAtmosphereHaze = 0.28;
  qualityAtmosphereScatteringEnabled = false;
  baseViewBloomIntensity = 1.7;
  horizonLensActive = false;
  fleetLensActive = false;
  taaEnabled = true;
  timeScale = 1.0;
  simTime = 0.0;
  demoAutoEnabled = true;
  lastUserActivityTime = performance.now() * 0.001;
  orientationLockAttempted = false;

  private readonly renderWebGPU: (timestamp: number) => void;

  private readonly resizeListener = () => {
    this.handleResize();
  };
  private readonly orientationChangeListener = () => {
    this.updateMobileViewportPresentation();
    this.handleResize();
  };
  private readonly orientationLockGestureListener = () => {
    tryLockLandscapeOrientation(this);
  };

  constructor() {
    const canvas = document.getElementById('gpu-canvas') as HTMLCanvasElement;
    if (!canvas) {
      throw new Error('Canvas element #gpu-canvas not found');
    }
    this.canvas = canvas;
    this.camera = new CameraController();
    this.groundObserver = new GroundObserverCamera();
    this.ui = new UIManager();
    this.profiler = new PerformanceProfiler();
    this.audio = new AudioEngine();
    this.patternNameDisplay = document.getElementById('patternName');
    this.renderWebGPU = createWebGPURenderLoop(this);
    setupCallbacks(this);
  }

  // --- AppRuntime method implementations (thin delegates) ---

  handleResize(): void {
    handleResizeImpl(this);
  }

  getDrawableSize(): { width: number; height: number } | null {
    return getDrawableSize(this);
  }

  setPatternMode(mode: number): void {
    setPatternModeImpl(this, mode);
  }

  setAnimationPattern(mode: number): void {
    setAnimationPatternImpl(this, mode);
  }

  setPhysicsMode(mode: number): void {
    setPhysicsModeImpl(this, mode);
  }

  applyQualityPreset(level: QualityLevel): void {
    applyQualityPreset(this, level);
  }

  applyExposureSettings(): void {
    applyExposureSettingsBinder(this);
  }

  applyViewTuning(time: number): void {
    applyViewTuning(this, time);
  }

  applyGroundPresetEffects(deltaTime: number): void {
    applyGroundPresetEffects(this, deltaTime);
  }

  applyGroundOverlayClass(overlayClass: string): void {
    applyGroundOverlayClassUi(this, overlayClass);
  }

  updateGroundObserverOverlay(): void {
    updateGroundObserverOverlay(this);
  }

  registerUserActivity(interruptCinematic: boolean): void {
    registerUserActivity(this, interruptCinematic);
  }

  updateMobileViewportPresentation(): void {
    updateMobileViewportPresentation(this);
  }

  setupMobileOrientationSupport(): void {
    setupMobileOrientationSupport(this, this.orientationChangeListener, this.orientationLockGestureListener);
  }

  writePatternParamsBuffer(): void {
    writePatternParamsBuffer(this);
  }

  recordTrailSamplesForCamera(time: number, cameraState: CameraState): void {
    recordTrailSamplesForCamera(this, time, cameraState);
  }

  writeUniforms(time: number, deltaTime: number, camera?: CameraState | null): void {
    writeUniforms(this, time, deltaTime, camera ?? null);
  }

  handleFocusSelectionChange(selection: FocusSelection | null): void {
    handleFocusSelectionChangeImpl(this, selection);
  }

  focusSatelliteAtScreenPoint(clientX: number, clientY: number): void {
    if (!this.focusManager || !this.buffers || !this.context) return;
    const time = this.lastTime || performance.now() / 1000;
    const cameraState = this.camera.calculateCamera(
      (idx, t) => this.buffers!.calculateSatellitePosition(idx, t),
      (idx, t) => this.buffers!.calculateSatelliteVelocity(idx, t),
      time,
    );
    const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    const { viewProjection } = this.camera.buildViewProjection(cameraState, aspect);
    const selection = this.focusManager.raycast(clientX, clientY, cameraState, viewProjection, time);
    if (selection) {
      this.focusManager.selectSatellite(selection);
    }
  }

  syncVolumetricBeamConfig(): void {
    syncVolumetricBeamConfig(this);
  }

  // --- Public API ---

  setGroundViewEnabled(enabled: boolean): void {
    setGroundViewEnabledImpl(this, enabled);
  }

  getQualityLevel(): QualityLevel {
    return this.currentQualityLevel;
  }

  setTimeScale(scale: number): void {
    this.timeScale = Math.max(1, Math.min(100000, scale));
    console.log(`⏱️ Time scale: ${this.timeScale}x`);
  }

  getTimeScale(): number {
    return this.timeScale;
  }

  async initialize(): Promise<void> {
    try {
      console.log('[GrokZephyr] Initializing...');
      if (this.backend === 'webgl') {
        await initializeWebGL(this, this.resizeListener, this.orientationChangeListener, this.orientationLockGestureListener);
        return;
      }
      await bootstrapWebGPU(
        this,
        this.resizeListener,
        this.orientationChangeListener,
        this.orientationLockGestureListener,
        () => this.start(),
      );
    } catch (error) {
      this.handleError(error);
    }
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.animationId = requestAnimationFrame(this.renderWebGPU);
  }

  stop(): void {
    this.isRunning = false;
    cancelAnimationFrame(this.animationId);
  }

  private handleError(error: unknown): void {
    console.error('[GrokZephyr] Error:', error);

    let message = 'Unknown error occurred';
    let isWebGPUError = false;

    if (error instanceof WebGPUError) {
      message = error.message;
      isWebGPUError = true;
    } else if (error instanceof Error) {
      message = error.message;
      isWebGPUError = message.toLowerCase().includes('webgpu');
    }

    if (isWebGPUError) {
      const compatCheck = WebGPUCompatibilityManager.checkSupport();
      if (!compatCheck.isSupported) {
        if (!WebGPUCompatibilityManager.hasActiveOverlay()) {
          const overlay = WebGPUCompatibilityManager.createCompatibilityOverlay(compatCheck);
          document.body.appendChild(overlay);
        }
        return;
      }
    }

    this.ui.showError(
      message +
      '<br><br>Please use a modern browser with WebGPU enabled (Chrome 113+, Edge 113+, or Firefox Nightly).',
    );
  }

  destroy(): void {
    this.stop();
    window.removeEventListener('resize', this.resizeListener);
    teardownMobileOrientationSupport(this.orientationChangeListener, this.orientationLockGestureListener);
    this.ui.destroyDashboard();
    this.captureManager?.destroyGallery();
    this.webglDebugOverlay?.destroy();
    this.webglRenderer?.destroy();
    this.constellationGuides?.destroy();
    this.moonRingGuide?.destroy();
    this.pipeline?.destroy();
    this.postProcessStack?.destroy();
    this.volumetricBeamRenderer?.destroy();
    this.skyline.destroy();
    this.buffers?.destroy();
    this.context?.destroy();
    this.profiler.destroy();
    this.earthVertexBuffer?.destroy();
    this.earthIndexBuffer?.destroy();
    this.audio.destroy();
  }
}

function main(): void {
  const onboarding = new OnboardingManager();
  onboarding.showIfNew();

  const app = new GrokZephyrApp();
  app.initialize().catch(console.error);

  window.addEventListener('beforeunload', () => {
    app.destroy();
  });

  (window as unknown as { zephyr: GrokZephyrApp }).zephyr = app;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}

export default GrokZephyrApp;
