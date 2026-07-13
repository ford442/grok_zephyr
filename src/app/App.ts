import { WebGPUError } from '@/core/WebGPUContext.js';
import type { WebGPUErrorReport } from '@/core/WebGPUErrorReporter.js';
import { CameraController } from '@/camera/CameraController.js';
import { GroundObserverCamera } from '@/camera/GroundObserverCamera.js';
import { UIManager } from '@/ui/UIManager.js';
import { PerformanceProfiler } from '@/utils/PerformanceProfiler.js';
import { AudioEngine } from '@/audio/AudioEngine.js';
import { SkylineCity } from '@/render/SkylineCity.js';
import { UI as UI_CONSTANTS } from '@/types/constants.js';
import { WebGPUCompatibilityManager } from '@/ui/WebGPUCompatibilityManager.js';
import { resolveRendererBackend } from '@/webgl/rendererSelection.js';
import { parseSavedExposureSettings } from '@/core/ExposureRuntime.js';
import type { QualityLevel } from '@/core/QualityPresets.js';
import type { FocusManager, FocusSelection } from '@/focus.js';
import type { CaptureManager } from '@/capture/CaptureManager.js';
import type { TLEData } from '@/types/index.js';
import type { AppRuntime } from '@/app/AppRuntime.js';
import { SatelliteCatalog } from '@/data/SatelliteCatalog.js';
import { pickAndSelectAtScreen } from '@/app/SatelliteSelection.js';
import { SimulationState } from '@/app/SimulationState.js';
import { ViewModeState } from '@/app/ViewModeCoordinator.js';
import {
  FrameLoopState,
  recordTrailSamplesForCamera,
  startWebGPULoop,
  stopLoop,
} from '@/app/FrameLoop.js';
import {
  setupCallbacks,
  registerUserActivity,
  applyExposureSettings as applyExposureSettingsBinder,
} from '@/app/AppCallbackBinder.js';
import { destroyGpuResources } from '@/app/destroyGpuResources.js';
import { createGpuResources } from '@/app/createGpuResources.js';
import { bootWebGPU } from '@/app/bootWebGPU.js';
import { bootWebGL } from '@/app/bootWebGL.js';
import { applyQualityPreset, syncVolumetricBeamConfig } from '@/app/QualityController.js';
import { applyViewTuning, applyGroundPresetEffects } from '@/app/ViewModeCoordinator.js';
import {
  setPatternMode as setPatternModeImpl,
  setAnimationPattern as setAnimationPatternImpl,
  setPhysicsMode as setPhysicsModeImpl,
  writePatternParamsBuffer,
  handleFocusSelectionChange as handleFocusSelectionChangeImpl,
  setGroundViewEnabled as setGroundViewEnabledImpl,
} from '@/app/PatternController.js';
import { setRealismMode as setRealismModeImpl } from '@/app/RealismController.js';
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
import {
  updateGroundObserverOverlay,
  applyGroundOverlayClass as applyGroundOverlayClassUi,
} from '@/app/GroundObserverUI.js';
import { writeUniforms } from '@/app/UniformWriter.js';
import type { CameraState } from '@/camera/CameraController.js';

export class App implements AppRuntime {
  readonly canvas: HTMLCanvasElement;
  readonly backend = resolveRendererBackend();
  readonly isMobileDevice = detectMobileDevice();
  readonly mobileDefaultQuality: QualityLevel = detectMobileDefaultQuality();
  readonly demoIdleTimeoutSeconds = UI_CONSTANTS.DEMO_IDLE_TIMEOUT_SECONDS;

  readonly simulation = new SimulationState();
  readonly view = new ViewModeState();
  readonly loop = new FrameLoopState();

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

  trailSamplePhase = 0;
  trailToggleOverride: boolean | null = null;
  trailLengthMode: 'short' | 'medium' | 'long' = 'medium';
  exposureSettings = parseSavedExposureSettings();
  patternNameDisplay: HTMLElement | null = null;
  selectedSatelliteIndex = -1;
  readonly satelliteCatalog = new SatelliteCatalog();
  fleetHostIndex = 0;
  dataSourceLabel = 'Procedural Walker';
  tleCatalogMeta = null;
  loadedTles: readonly TLEData[] = [];
  tleRealCount = 0;
  lastVisibleCount = 0;
  moonScaleHudEnabled = false;
  volumetricBeamQuality = null as AppRuntime['volumetricBeamQuality'];
  orientationLockAttempted = false;

  private recoveringFromDeviceLoss = false;
  private recoveryOverlayEl: HTMLElement | null = null;

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
    setupCallbacks(this);
  }

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

  setRealismMode(enabled: boolean): void {
    setRealismModeImpl(this, enabled);
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
    setupMobileOrientationSupport(
      this,
      this.orientationChangeListener,
      this.orientationLockGestureListener,
    );
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
    void pickAndSelectAtScreen(this, clientX, clientY);
  }

  syncVolumetricBeamConfig(): void {
    syncVolumetricBeamConfig(this);
  }

  setGroundViewEnabled(enabled: boolean): void {
    setGroundViewEnabledImpl(this, enabled);
  }

  getQualityLevel(): QualityLevel {
    return this.simulation.currentQualityLevel;
  }

  setTimeScale(scale: number): void {
    this.simulation.clock.setRate(scale);
    console.log(`⏱️ Time scale: ${this.simulation.clock.rate}x`);
  }

  getTimeScale(): number {
    return this.simulation.clock.rate;
  }

  async initialize(): Promise<void> {
    try {
      console.log('[GrokZephyr] Initializing...');
      if (this.backend === 'webgl') {
        await bootWebGL(
          this,
          this.resizeListener,
          this.orientationChangeListener,
          this.orientationLockGestureListener,
        );
        return;
      }
      await bootWebGPU(
        this,
        this.resizeListener,
        this.orientationChangeListener,
        this.orientationLockGestureListener,
        {
          onDeviceLost: (info) => this.handleDeviceLost(info),
          onErrorReport: (report) => this.handleGpuErrorReport(report),
          startRenderLoop: () => this.start(),
        },
      );
    } catch (error) {
      this.handleError(error);
    }
  }

  start(): void {
    startWebGPULoop(this);
  }

  stop(): void {
    stopLoop(this);
  }

  private handleGpuErrorReport(report: WebGPUErrorReport): void {
    if (report.kind === 'uncaptured') {
      this.ui.showError(
        `GPU runtime error (${report.stage}): ${report.message}` +
          '<br><br>The simulation may be unstable. Try reloading the page.',
      );
      return;
    }

    if (this.recoveringFromDeviceLoss) return;

    this.ui.showError(
      `GPU ${report.kind} error during <b>${report.stage}</b>: ${report.message}` +
        '<br><br>Please use a modern browser with WebGPU enabled (Chrome 113+, Edge 113+, or Firefox Nightly).',
    );
  }

  private async handleDeviceLost(info: GPUDeviceLostInfo): Promise<void> {
    if (this.backend !== 'webgpu' || this.recoveringFromDeviceLoss || !this.context) {
      return;
    }

    console.warn('[GrokZephyr] GPU device lost — recovering...', info);
    this.recoveringFromDeviceLoss = true;
    this.stop();
    this.showDeviceRecoveryOverlay();

    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          destroyGpuResources(this, { deviceLost: true });
          await this.context.recoverContext();
          await createGpuResources(this, { mode: 'recovery' });
          this.hideDeviceRecoveryOverlay();
          this.ui.hideError();
          this.start();
          return;
        } catch (error) {
          console.error(`[GrokZephyr] GPU recovery attempt ${attempt + 1} failed:`, error);
        }
      }

      this.hideDeviceRecoveryOverlay();
      this.showRecoveryFailedOverlay(new Error('GPU device recovery failed after 2 attempts'));
    } finally {
      this.recoveringFromDeviceLoss = false;
    }
  }

  private showDeviceRecoveryOverlay(): void {
    this.hideDeviceRecoveryOverlay();
    this.recoveryOverlayEl = WebGPUCompatibilityManager.createRecoveryOverlay();
    document.body.appendChild(this.recoveryOverlayEl);
  }

  private hideDeviceRecoveryOverlay(): void {
    this.recoveryOverlayEl?.remove();
    this.recoveryOverlayEl = null;
  }

  private showRecoveryFailedOverlay(error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    const result = WebGPUCompatibilityManager.createInitFailureResult(
      'device-recovery',
      `GPU device recovery failed after multiple attempts. ${detail}`,
    );
    if (!WebGPUCompatibilityManager.hasActiveOverlay()) {
      document.body.appendChild(WebGPUCompatibilityManager.createCompatibilityOverlay(result));
    } else {
      this.handleError(error);
    }
  }

  private handleError(error: unknown): void {
    console.error('[GrokZephyr] Error:', error);

    let message = 'Unknown error occurred';
    let isWebGPUError = false;

    if (error instanceof WebGPUError) {
      message = error.message;
      const compatCheck = WebGPUCompatibilityManager.checkSupport();
      if (!compatCheck.isSupported) {
        if (!WebGPUCompatibilityManager.hasActiveOverlay()) {
          const overlay = WebGPUCompatibilityManager.createCompatibilityOverlay(compatCheck);
          document.body.appendChild(overlay);
        }
        return;
      }

      const failure = WebGPUCompatibilityManager.createInitFailureResult('webgpu', message);
      if (!WebGPUCompatibilityManager.hasActiveOverlay()) {
        document.body.appendChild(WebGPUCompatibilityManager.createCompatibilityOverlay(failure));
      } else {
        this.ui.showError(message);
      }
      return;
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
    destroyGpuResources(this);
    window.removeEventListener('resize', this.resizeListener);
    teardownMobileOrientationSupport(
      this.orientationChangeListener,
      this.orientationLockGestureListener,
    );
    this.ui.destroyDashboard();
    this.captureManager?.destroyGallery();
    this.webglDebugOverlay?.destroy();
    this.webglRenderer?.destroy();
    this.hideDeviceRecoveryOverlay();
    this.skyline.destroy();
    this.context?.destroy();
    this.profiler.destroy();
    this.audio.destroy();
  }
}
