
import { WebGPUContext, WebGPUError } from '@/core/WebGPUContext.js';
import { SatelliteGPUBuffer } from '@/core/SatelliteGPUBuffer.js';
import { RenderPipeline, type TonemapMode } from '@/render/RenderPipeline.js';
import { PostProcessStack } from '@/render/PostProcessStack.js';
import { VolumetricBeamRenderer } from '@/render/VolumetricBeamRenderer.js';
import { CameraController, type CameraState } from '@/camera/CameraController.js';
import { GroundObserverCamera, GroundObserverPreset } from '@/camera/GroundObserverCamera.js';
import { UIManager } from '@/ui/UIManager.js';
import { PerformanceProfiler } from '@/utils/PerformanceProfiler.js';
import { FocusManager, type ConstellationStats, type FocusSelection } from '@/focus.js';
import { AudioEngine } from '@/audio/AudioEngine.js';
import { TrailRenderer } from '@/render/TrailRenderer.js';
import { EarthAtmosphereRenderer } from '@/earth.js';
import { genSphere, extractFrustum, mat4inv } from '@/utils/math.js';
import { getBeamPatternTitle } from '@/patterns.js';
import { CONSTANTS, BUFFER_SIZES, UI as UI_CONSTANTS } from '@/types/constants.js';
import { TLELoader } from '@/data/TLELoader.js';
import { getBackgroundModeIndex, resolveBackgroundMode, setBackgroundMode } from '@/background.js';
import { type QualityLevel, QUALITY_PRESETS, saveQualityLevel, parseQualityParam } from '@/core/QualityPresets.js';
import { OnboardingManager } from '@/ui/OnboardingManager.js';
import { WebGPUCompatibilityManager } from '@/ui/WebGPUCompatibilityManager.js';
import type { TrailConfig } from '@/types/animation.js';

import { CELESTRAK_GROUPS, TIMING_ESTIMATES, type ExposureRuntimeSettings, EXPOSURE_STORAGE_KEY, DEFAULT_EXPOSURE_SETTINGS, clamp, parseSavedExposureSettings, saveExposureSettings } from '@/app/constants.js';
import { MobileManager } from '@/app/managers/MobileManager.js';
import { CaptureManager } from '@/app/managers/CaptureManager.js';
import { AppUIManager } from '@/app/managers/AppUIManager.js';
import { AppInitializer } from '@/app/managers/AppInitializer.js';
import { AppEventsManager } from '@/app/managers/AppEventsManager.js';
import { AppRenderManager } from '@/app/managers/AppRenderManager.js';
import { AppSceneManager } from '@/app/managers/AppSceneManager.js';
import { AppPipelineManager } from '@/app/managers/AppPipelineManager.js';
import { AppRenderLoop } from '@/app/managers/AppRenderLoop.js';
import { AppCallbackManager } from '@/app/managers/AppCallbackManager.js';
import { AppQualityManager } from '@/app/managers/AppQualityManager.js';
import { AppBootManager } from '@/app/managers/AppBootManager.js';

import '@/styles.css';
import '@/styles/onboarding.css';

export class GrokZephyrApp {
  private static readonly CAPTURE_UI_HIDE_IDS = ['ui', 'controls', 'horizon-indicator', 'ground-preset-selector', 'capture-gallery'];
  private static readonly CAPTURE_GALLERY_LIMIT = 6;
  private static readonly PREFERRED_VIDEO_MIME_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

  public canvas: HTMLCanvasElement;
  public context: WebGPUContext | null = null;
  public buffers: SatelliteGPUBuffer | null = null;
  public pipeline: RenderPipeline | null = null;
  public postProcessStack: PostProcessStack | null = null;
  public volumetricBeamRenderer: VolumetricBeamRenderer | null = null;
  public camera: CameraController;
  public groundObserver: GroundObserverCamera;
  public ui: UIManager;
  private profiler: PerformanceProfiler;
  public audio: AudioEngine;
  public focusManager: FocusManager | null = null;
  public trailRenderer: TrailRenderer | null = null;
  public earthAtmosphereRenderer: EarthAtmosphereRenderer | null = null;
  private groundViewEnabled = true;
  private selectedSatelliteIndex = -1;
  public patternSeed = 0;
  public patternAnimationStart = 0;
  private patternNameDisplay: HTMLElement | null = null;
  private captureStatus: HTMLElement | null = null;
  private captureGallery: HTMLElement | null = null;
  private captureOverlayToggle: HTMLInputElement | null = null;
  private captureHideUIToggle: HTMLInputElement | null = null;
  private captureVideoLength: HTMLSelectElement | null = null;
  private captureVideoButton: HTMLButtonElement | null = null;
  private captureManager!: CaptureManager;
  private appUIManager!: AppUIManager;
  private appInitializer!: AppInitializer;
  private appEventsManager!: AppEventsManager;
  public appRenderManager!: AppRenderManager;
  public appSceneManager!: AppSceneManager;
  public appPipelineManager!: AppPipelineManager;
  public appRenderLoop!: AppRenderLoop;
  public appCallbackManager!: AppCallbackManager;
  public appQualityManager!: AppQualityManager;
  public appBootManager!: AppBootManager;
  private dataSourceLabel = 'Procedural Walker';
  private lastVisibleCount = 0;

  // Earth geometry
  private earthVertexBuffer: GPUBuffer | null = null;
  private earthIndexBuffer: GPUBuffer | null = null;
  private earthIndexCount = 0;

  // Animation state
  private animationId = 0;
  private isRunning = false;
  public lastTime = 0;



  private orientationLockAttempted = false;
  private trailSamplePhase = 0;
  private trailToggleOverride: boolean | null = null;
  public trailLengthMode: 'short' | 'medium' | 'long' = 'medium';
  public exposureSettings: ExposureRuntimeSettings = parseSavedExposureSettings();

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

    // Setup callbacks
    this.setupCallbacks();
  }

  /** Cached mobile device detection (computed once at startup) */
  private readonly isMobileDevice = MobileManager.detectMobileDevice();
  private readonly mobileDefaultQuality: QualityLevel = MobileManager.detectMobileDefaultQuality();

  /** Current beam pattern mode (0=chaos, 1=GROK, 2=X logo) */
  private currentPatternMode = 1;

  /** Current animation pattern mode (0=none, 3=smile, 4=digital_rain, 5=heartbeat) */
  private currentAnimationPattern = 0;

  /** Current physics mode (0=simple, 1=keplerian, 2=J2) */
  private currentPhysicsMode = 0;

  /** Current quality preset level */
  public currentQualityLevel: QualityLevel = 'high';

  /** Whether TAA (Temporal Anti-Aliasing) is currently active */
  public taaEnabled = true;

  /** Time scale for simulation (1.0 = real-time) */
  public timeScale: number = 1.0;

  /** Scaled simulation time (accumulated based on timeScale) */
  public simTime: number = 0.0;

  /** Demo mode settings */
  private demoAutoEnabled = true;
  private readonly demoIdleTimeoutSeconds = UI_CONSTANTS.DEMO_IDLE_TIMEOUT_SECONDS;
  private lastUserActivityTime = performance.now() * 0.001;



  private registerUserActivity(interruptCinematic: boolean): void {
    this.lastUserActivityTime = performance.now() * 0.001;
    void this.audio.unlock();
    if (interruptCinematic && this.camera.isCinematicActive()) {
      this.camera.stopCinematic();
    }
  }

















  /**
   * Set beam pattern mode (0=chaos, 1=GROK, 2=X logo)
   */
  setPatternMode(mode: number): void {
    if (!this.context || !this.buffers) return;

    this.currentPatternMode = mode;
    this.patternAnimationStart = performance.now() / 1000;

    // Update beam params uniform buffer
    const beamParamsData = new ArrayBuffer(16);
    const f32 = new Float32Array(beamParamsData);
    const u32 = new Uint32Array(beamParamsData);

    f32[0] = this.patternAnimationStart;
    u32[1] = mode;
    u32[2] = 65536;
    u32[3] = 0;

    this.context.writeBuffer(this.buffers.getBuffers().beamParams, beamParamsData);
    this.writePatternParamsBuffer();
    this.updatePatternTitle();
    this.audio.playPatternChange(mode);

    const modeNames = ['CHAOS', 'GROK', '𝕏 LOGO'];
    console.log(`🔄 Beam pattern switched to: ${modeNames[mode]}`);
  }



  private recordTrailSamplesForCamera(time: number, cameraState: CameraState): void {
    if (!this.trailRenderer || !this.buffers || !this.trailRenderer.isEnabled()) return;

    const orbitalData = this.buffers.getOrbitalElementData();
    const sampleCount = this.trailRenderer.getSamplingBudget();
    if (sampleCount <= 0) return;
    const sampleStride = Math.max(1, Math.floor(CONSTANTS.NUM_SATELLITES / sampleCount));
    const phase = this.trailSamplePhase % sampleStride;
    this.trailSamplePhase++;

    const position = new Float32Array(3);
    const cameraForward = new Float32Array([
      cameraState.target[0] - cameraState.position[0],
      cameraState.target[1] - cameraState.position[1],
      cameraState.target[2] - cameraState.position[2],
    ]);
    const forwardLen = Math.hypot(cameraForward[0], cameraForward[1], cameraForward[2]) || 1.0;
    cameraForward[0] /= forwardLen;
    cameraForward[1] /= forwardLen;
    cameraForward[2] /= forwardLen;
    const cameraPos = new Float32Array(cameraState.position);
    const maxDistance = this.camera.getViewMode() === 'moon' ? 240000 : this.camera.getViewMode() === 'god' ? 140000 : 90000;
    const visibilityDotThreshold = this.camera.getViewMode() === 'god' ? -0.35 : -0.2;

    for (let idx = phase; idx < CONSTANTS.NUM_SATELLITES; idx += sampleStride) {
      const satPos = this.buffers.calculateSatellitePosition(idx, time);
      const dx = satPos[0] - cameraPos[0];
      const dy = satPos[1] - cameraPos[1];
      const dz = satPos[2] - cameraPos[2];
      const dist = Math.hypot(dx, dy, dz);
      if (dist > maxDistance) continue;
      const invDist = dist > 1e-3 ? 1.0 / dist : 0.0;
      const facing = (dx * cameraForward[0] + dy * cameraForward[1] + dz * cameraForward[2]) * invDist;
      if (facing < visibilityDotThreshold) continue;
      position[0] = satPos[0];
      position[1] = satPos[1];
      position[2] = satPos[2];
      const shellIndex = (orbitalData[idx * 4 + 3] >> 8) & 0xFF;
      this.trailRenderer.recordPosition(idx, position, time, shellIndex);
    }
  }





  /**
   * Set physics propagation mode (0=simple, 1=keplerian, 2=J2)
   */
  setPhysicsMode(mode: number): void {
    if (mode < 0 || mode > 2) {
      console.warn(`Invalid physics mode: ${mode}`);
      return;
    }

    this.currentPhysicsMode = mode;

    const modeNames = ['Simple (Circular)', 'Keplerian', 'J2 Perturbed'];
    const implemented = [true, true, false];

    console.log(`⚛️ Physics mode switched to: ${modeNames[mode]} ${implemented[mode] ? '' : '(placeholder)'}`);

    // TODO: Update GPU uniform or reinitialize orbital elements based on mode
    // For now, this is a UI-only change that affects future calculations
    // Full implementation would require:
    // 1. Updating the compute shader to use different propagation math
    // 2. Recomputing orbital elements with J2 perturbations if needed
    // 3. Updating CPU-side position calculations for camera tracking
  }





  /**
   * Enable or disable the volumetric beam (god-ray) renderer and push config.
   *
   * When `enabled` is true and the renderer has not been created yet, it is
   * lazily initialised here.  When `enabled` is false the renderer is destroyed
   * to free GPU memory.
   */
  private applyVolumetricBeamPreset(
    enabled: boolean,
    config: {
      maxSteps?: number;
      density?: number;
      intensity?: number;
      mieG?: number;
      beamRadius?: number;
      ambientFactor?: number;
      earthShadow?: boolean;
    } = {},
  ): void {
    if (!enabled) {
      if (this.volumetricBeamRenderer) {
        this.volumetricBeamRenderer.destroy();
        this.volumetricBeamRenderer = null;
        console.log('✨ Volumetric beams: disabled');
      }
      return;
    }

    // Only create if we have the required GPU resources
    if (!this.context || !this.buffers || !this.pipeline) return;

    const size = this.getDrawableSize();
    if (!size) return;

    if (!this.volumetricBeamRenderer) {
      const buffers = this.buffers.getBuffers();
      this.volumetricBeamRenderer = new VolumetricBeamRenderer(
        this.context,
        buffers.beams,
        buffers.uniforms,
      );
      this.volumetricBeamRenderer.initialize(size.width, size.height);
      console.log('✨ Volumetric beams: enabled (Cinematic)');
    }

    this.volumetricBeamRenderer.setConfig(config);
  }







  private getDrawableSize(): { width: number; height: number } | null {
    const rawDpr = window.devicePixelRatio || 1;
    const dpr = this.isMobileDevice ? Math.min(rawDpr, 1.5) : rawDpr;
    const width = Math.floor(this.canvas.clientWidth * dpr);
    const height = Math.floor(this.canvas.clientHeight * dpr);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  /**
   * Handle window resize
   */
  public handleResize(): void {
    MobileManager.updateMobileViewportPresentation();
    if (!this.context || !this.buffers || !this.pipeline) return;

    const size = this.getDrawableSize();
    if (!size) return;
    const { width, height } = size;

    // Explicitly set canvas dimensions
    this.canvas.width = width;
    this.canvas.height = height;

    this.context.resize(width, height);
    this.pipeline.resize(width, height);
    this.postProcessStack?.resize(width, height);
    this.volumetricBeamRenderer?.resize(width, height);
    this.buffers.updateBloomUniforms(width, height);
  }



  /**
   * Set time scale for simulation (1.0 = real-time).
   * @param scale - Time multiplier (clamped between 1 and 100000)
   */
  setTimeScale(scale: number): void {
    this.timeScale = Math.max(1, Math.min(100000, scale));
    console.log(`⏱️ Time scale: ${this.timeScale}x`);
  }

  /**
   * Get current time scale.
   * @returns Current time multiplier
   */
  getTimeScale(): number {
    return this.timeScale;
  }







  /**
   * Main render loop
   */
  private render = (timestamp: number): void => {
    if (!this.isRunning || !this.context || !this.pipeline || !this.earthVertexBuffer || !this.earthIndexBuffer) {
      return;
    }

    // Keep the render-loop resize check as a fallback for DPR/layout changes
    // that may not arrive through a window resize event.
    const size = this.getDrawableSize();
    if (!size) {
      this.animationId = requestAnimationFrame(this.render);
      return;
    }
    const { width, height } = size;
    if (width !== this.canvas.width || height !== this.canvas.height) {
      this.handleResize();
    }

    // Calculate timing
    const time = timestamp * 0.001;
    const deltaTime = Math.min(time - this.lastTime, 0.1);
    this.lastTime = time;

    // Update scaled simulation time based on timeScale
    this.simTime += deltaTime * this.timeScale;

    if (
      this.demoAutoEnabled &&
      !this.camera.isCinematicActive() &&
      time - this.lastUserActivityTime >= this.demoIdleTimeoutSeconds
    ) {
      this.camera.startCinematic(time);
    }

    // Sync background mode from the current camera view
    setBackgroundMode(resolveBackgroundMode(this.camera.getViewMode()));

    // Update profiler
    this.profiler.beginFrame(timestamp);

    // Update ground observer parallax if in ground mode
    if (this.camera.getViewMode() === 'ground') {
      this.groundObserver.update();
    }

    // Update any active click focus state
    // Calculate camera state once and share across focus manager and trail renderer.
    const cameraState = this.camera.calculateCamera(
      (idx, t) => this.buffers!.calculateSatellitePosition(idx, t),
      (idx, t) => this.buffers!.calculateSatelliteVelocity(idx, t),
      time
    );
    this.recordTrailSamplesForCamera(this.simTime, cameraState);

    if (this.focusManager) {
      this.focusManager.setCameraPosition(cameraState.position);
      this.focusManager.setConstellationStats(this.appRenderManager.buildConstellationStats());
      this.focusManager.update(time);
    }

    if (this.trailRenderer) {
      const forward = new Float32Array([
        cameraState.target[0] - cameraState.position[0],
        cameraState.target[1] - cameraState.position[1],
        cameraState.target[2] - cameraState.position[2],
      ]);
      const fLen = Math.hypot(forward[0], forward[1], forward[2]) || 1.0;
      forward[0] /= fLen;
      forward[1] /= fLen;
      forward[2] /= fLen;
      this.trailRenderer.updateGeometry(this.simTime, new Float32Array(cameraState.position), forward);
    }
    this.appRenderManager.writeUniforms(time, deltaTime, cameraState);
    this.pipeline.updateDepthOfFieldFocus(
      cameraState.position,
      this.selectedSatelliteIndex,
      time,
      deltaTime,
      (idx, t) => this.buffers!.calculateSatellitePosition(idx, t)
    );

    // Create command encoder
    const encoder = this.context.createCommandEncoder('frame');

    // Pass 1: Compute orbital positions
    this.pipeline.encodeComputePass(encoder);

    // Pass 1.5: Compute beam positions
    this.pipeline.encodeBeamComputePass(encoder);

    // Note: Animation patterns (Smile, Digital Rain, Heartbeat) are rendered
    // directly in the satellite vertex shader via patternParams uniform.
    // No separate compute pass is needed.

    // Pass 2: Scene rendering (different for ground view)
    if (this.camera.getViewMode() === 'ground') {
      const groundRenderer = this.groundViewEnabled ? this.earthAtmosphereRenderer : null;
      this.pipeline.encodeGroundScenePass(
        encoder,
        groundRenderer ?? undefined,
        this.earthVertexBuffer ?? undefined,
        this.earthIndexBuffer ?? undefined,
        this.earthIndexCount
      );
    } else {
      this.pipeline.encodeScenePass(
        encoder,
        this.earthVertexBuffer,
        this.earthIndexBuffer,
        this.earthIndexCount
      );
    }

    // Pass 2.5: Trails rendered additively onto HDR target
    if (this.trailRenderer) {
      this.pipeline.encodeTrailPass(encoder, this.trailRenderer);
    }

    // Pass 2.6: Volumetric beams (Cinematic quality only)
    // Ray-march at half resolution, then composite additively into HDR.
    if (this.volumetricBeamRenderer) {
      this.volumetricBeamRenderer.encodeRaymarchPass(encoder);
      this.volumetricBeamRenderer.encodeCompositePass(encoder, this.pipeline.getHDRView());
    }

    const sceneSourceView = this.pipeline.encodeDepthOfFieldPasses(encoder);
    const motionBlurSourceView = this.pipeline.encodeMotionBlurPass(encoder, sceneSourceView);
    this.pipeline.encodeAutoExposurePasses(encoder, motionBlurSourceView, deltaTime);

    // Passes 3-5: Bloom
    this.pipeline.encodeBloomPasses(encoder, motionBlurSourceView);

    // Pass 6: Composite + (optionally) post-process to screen
    const { width: canvasWidth, height: canvasHeight } = this.context.getCanvasSize();
    const screenView = this.context.getContext().getCurrentTexture().createView();

    if (this.postProcessStack) {
      // Route the composite pass to an intermediate texture, then run the
      // PostProcessStack (TAA + color grading + film grain) to the screen.
      this.pipeline.encodeCompositePass(
        encoder,
        this.pipeline.getCompositeIntermediateView(),
        canvasWidth,
        canvasHeight,
        motionBlurSourceView
      );
      this.postProcessStack.execute(
        encoder,
        this.pipeline.getCompositeIntermediateView(),
        screenView,
        canvasWidth,
        canvasHeight,
        deltaTime
      );
    } else {
      // Fallback: direct composite to screen (legacy path).
      this.pipeline.encodeCompositePass(encoder, screenView, canvasWidth, canvasHeight, motionBlurSourceView);
    }

    // Submit
    this.context.submit([encoder.finish()]);

    // Record timing estimates (based on quality preset)
    this.appRenderManager.recordPassTimings();

    // Update profiler
    const stats = this.profiler.endFrame(timestamp);
    if (stats) {
      // Estimate visible satellites (this is approximate)
      // In a full implementation, we'd use occlusion queries
      stats.visibleSatellites = this.estimateVisibleSatellites();
      // Update UI with modified stats
      this.ui.updateStats(stats);

      // Update simulation time display
      this.ui.updateSimTime(this.simTime);
    }

    // Next frame
    this.animationId = requestAnimationFrame(this.render);
  };



  private getEffectiveTrailConfig(level: QualityLevel): TrailConfig {
    const base = QUALITY_PRESETS[level].trail;
    const lengthScale = this.trailLengthMode === 'short' ? 0.55 : this.trailLengthMode === 'long' ? 1.65 : 1.0;
    const enabled = this.trailToggleOverride ?? base.enabled;
    return {
      enabled,
      maxLength: Math.max(8, Math.round(base.maxLength * lengthScale)),
      fadeOut: Math.max(8, Math.round(base.fadeOut * lengthScale)),
      colorByShell: true,
      ribbonWidth: Math.max(2.5, base.ribbonWidth * (this.trailLengthMode === 'long' ? 1.12 : 1.0)),
    };
  }



  /**
   * Start the render loop
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.animationId = requestAnimationFrame(this.render);
  }

  /**
   * Stop the render loop
   */
  stop(): void {
    this.isRunning = false;
    cancelAnimationFrame(this.animationId);
  }

  /**
   * Handle initialization errors
   */
  public handleError(error: unknown): void {
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

    // Use enhanced WebGPU compatibility messaging if available
    if (isWebGPUError) {
      const compatCheck = WebGPUCompatibilityManager.checkSupport();
      if (!compatCheck.isSupported) {
        // Check if an overlay already exists to prevent duplicates
        if (!WebGPUCompatibilityManager.hasActiveOverlay()) {
          const overlay = WebGPUCompatibilityManager.createCompatibilityOverlay(compatCheck);
          document.body.appendChild(overlay);
        }
        return;
      }
    }

    this.ui.showError(
      message +
      '<br><br>Please use a modern browser with WebGPU enabled (Chrome 113+, Edge 113+, or Firefox Nightly).'
    );
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stop();
    this.appEventsManager?.unbindEvents();

    window.removeEventListener('pointerdown', this.orientationLockGestureListener);
    window.removeEventListener('touchstart', this.orientationLockGestureListener);
    this.ui.destroyDashboard();
    if (this.captureGallery) {
      this.captureGallery.querySelectorAll<HTMLAnchorElement>('.capture-gallery-item').forEach((item) => {
        const url = item.dataset.captureUrl;
        if (url?.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      });
    }
    this.pipeline?.destroy();
    this.postProcessStack?.destroy();
    this.volumetricBeamRenderer?.destroy();
    this.buffers?.destroy();
    this.context?.destroy();
    this.profiler.destroy();
    this.earthVertexBuffer?.destroy();
    this.earthIndexBuffer?.destroy();
    this.audio.destroy();
  }
}

/**
 * Initialize application when DOM is ready
 */
