/**
 * Grok Zephyr - Main Entry Point
 * 
 * WebGPU-powered orbital simulation with 1M+ satellites.
 */

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
import {
  type QualityLevel,
  QUALITY_PRESETS,
  saveQualityLevel,
  parseQualityParam,
} from '@/core/QualityPresets.js';
import { OnboardingManager } from '@/ui/OnboardingManager.js';
import { WebGPUCompatibilityManager } from '@/ui/WebGPUCompatibilityManager.js';
import type { TrailConfig } from '@/types/animation.js';

import './styles.css';
import './styles/onboarding.css';

/**
 * Known CelesTrak group names for the ?tle= query param shorthand.
 * Usage: ?tle=starlink or ?tle=https://example.com/my-tles.txt
 */
const CELESTRAK_GROUPS: Record<string, string> = {
  starlink: 'starlink',
  oneweb: 'oneweb',
  iridium: 'iridium',
  'iridium-next': 'iridium-NEXT',
  gps: 'gps-ops',
  galileo: 'galileo',
  stations: 'stations',
  active: 'active',
};

/**
 * Performance timing estimation constants (milliseconds)
 * 
 * These values are used to provide realistic timing breakdowns when GPU timestamp
 * queries are unavailable or not supported by the device. They represent heuristic
 * estimates based on typical pass complexity and are adjusted by multipliers that
 * depend on quality preset settings (e.g., whether trails or atmosphere effects
 * are enabled). When GPU timestamp queries are available (on supported devices),
 * these estimates are replaced by actual measured GPU timing data.
 */
const TIMING_ESTIMATES = {
  BASE_COMPUTE: 1.5,        // Base compute time for orbital calculations
  BASE_SCENE: 3.0,          // Base scene rendering time
  BASE_BLOOM: 2.0,          // Base bloom effect time (trails enabled)
  BASE_POST: 1.5,           // Post-process (TAA, grain, grading) time
  COMPUTE_NO_TRAIL_MULT: 1.0, // Multiplier when trails are disabled
  COMPUTE_TRAIL_MULT: 1.2,  // Multiplier when trails are enabled
  SCENE_ATMOSPHERE_MULT: 1.3, // Multiplier when atmosphere is enabled
  BLOOM_DISABLED: 0.5,      // Bloom time when trails are disabled
  POST_DISABLED: 0.5,       // Post-process time when disabled
};

type ExposureMode = 'auto' | 'manual';

interface ExposureRuntimeSettings {
  mode: ExposureMode;
  manualExposure: number;
  adaptationSpeed: number;
  tonemapMode: TonemapMode;
}

const EXPOSURE_STORAGE_KEY = 'grokzephyr-exposure';

const DEFAULT_EXPOSURE_SETTINGS: ExposureRuntimeSettings = {
  mode: 'auto',
  manualExposure: 1.0,
  adaptationSpeed: 1.8,
  tonemapMode: 0,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseSavedExposureSettings(): ExposureRuntimeSettings {
  try {
    const raw = localStorage.getItem(EXPOSURE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_EXPOSURE_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<ExposureRuntimeSettings>;
    const mode: ExposureMode = parsed.mode === 'manual' ? 'manual' : 'auto';
    const tonemapCandidate = Number(parsed.tonemapMode);
    const tonemapMode: TonemapMode = (tonemapCandidate >= 0 && tonemapCandidate <= 3 ? tonemapCandidate : 0) as TonemapMode;
    return {
      mode,
      manualExposure: clamp(Number(parsed.manualExposure) || 1.0, 0.1, 10.0),
      adaptationSpeed: clamp(Number(parsed.adaptationSpeed) || 1.8, 0.1, 5.0),
      tonemapMode,
    };
  } catch {
    return { ...DEFAULT_EXPOSURE_SETTINGS };
  }
}

function saveExposureSettings(settings: ExposureRuntimeSettings): void {
  try {
    localStorage.setItem(EXPOSURE_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage may be unavailable; ignore persistence failures.
  }
}

/**
 * Main Application Class
 */
class GrokZephyrApp {
  private static readonly CAPTURE_UI_HIDE_IDS = ['ui', 'controls', 'horizon-indicator', 'ground-preset-selector', 'capture-gallery'];
  private static readonly CAPTURE_GALLERY_LIMIT = 6;
  private static readonly PREFERRED_VIDEO_MIME_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

  private canvas: HTMLCanvasElement;
  private context: WebGPUContext | null = null;
  private buffers: SatelliteGPUBuffer | null = null;
  private pipeline: RenderPipeline | null = null;
  private postProcessStack: PostProcessStack | null = null;
  private volumetricBeamRenderer: VolumetricBeamRenderer | null = null;
  private camera: CameraController;
  private groundObserver: GroundObserverCamera;
  private ui: UIManager;
  private profiler: PerformanceProfiler;
  private audio: AudioEngine;
  private focusManager: FocusManager | null = null;
  private trailRenderer: TrailRenderer | null = null;
  private earthAtmosphereRenderer: EarthAtmosphereRenderer | null = null;
  private groundViewEnabled = true;
  private selectedSatelliteIndex = -1;
  private patternSeed = 0;
  private patternAnimationStart = 0;
  private patternNameDisplay: HTMLElement | null = null;
  private captureStatus: HTMLElement | null = null;
  private captureGallery: HTMLElement | null = null;
  private captureOverlayToggle: HTMLInputElement | null = null;
  private captureHideUIToggle: HTMLInputElement | null = null;
  private captureVideoLength: HTMLSelectElement | null = null;
  private captureVideoButton: HTMLButtonElement | null = null;
  private captureInProgress = false;
  private captureHideElements: HTMLElement[] = [];
  private dataSourceLabel = 'Procedural Walker';
  private lastVisibleCount = 0;
  
  // Earth geometry
  private earthVertexBuffer: GPUBuffer | null = null;
  private earthIndexBuffer: GPUBuffer | null = null;
  private earthIndexCount = 0;
  
  // Animation state
  private animationId = 0;
  private isRunning = false;
  private lastTime = 0;
  private readonly resizeListener = () => {
    this.handleResize();
  };
  private readonly orientationChangeListener = () => {
    this.updateMobileViewportPresentation();
    this.handleResize();
  };
  private readonly orientationLockGestureListener = () => {
    this.tryLockLandscapeOrientation();
  };
  private orientationLockAttempted = false;
  private trailSamplePhase = 0;
  private trailToggleOverride: boolean | null = null;
  private trailLengthMode: 'short' | 'medium' | 'long' = 'medium';
  private exposureSettings: ExposureRuntimeSettings = parseSavedExposureSettings();

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
  private readonly isMobileDevice = GrokZephyrApp.detectMobileDevice();
  private readonly mobileDefaultQuality: QualityLevel = GrokZephyrApp.detectMobileDefaultQuality();

  /** Current beam pattern mode (0=chaos, 1=GROK, 2=X logo) */
  private currentPatternMode = 1;

  /** Current animation pattern mode (0=none, 3=smile, 4=digital_rain, 5=heartbeat) */
  private currentAnimationPattern = 0;

  /** Current physics mode (0=simple, 1=keplerian, 2=J2) */
  private currentPhysicsMode = 0;

  /** Current quality preset level */
  private currentQualityLevel: QualityLevel = 'high';

  /** Whether TAA (Temporal Anti-Aliasing) is currently active */
  private taaEnabled = true;

  /** Time scale for simulation (1.0 = real-time) */
  private timeScale: number = 1.0;

  /** Scaled simulation time (accumulated based on timeScale) */
  private simTime: number = 0.0;

  /** Demo mode settings */
  private demoAutoEnabled = true;
  private readonly demoIdleTimeoutSeconds = UI_CONSTANTS.DEMO_IDLE_TIMEOUT_SECONDS;
  private lastUserActivityTime = performance.now() * 0.001;

  /**
   * Setup UI and camera callbacks
   */
  private setupCallbacks(): void {
    // Camera mode change updates UI + ground observer overlay
    this.camera.onModeChange((_mode, name, altitude) => {
      this.ui.setViewMode(name, altitude);
      this.ui.setActiveButton(this.camera.getViewModeIndex());
      this.updateGroundObserverOverlay();
      this.audio.setViewMode(_mode);
      this.audio.playModeWhoosh();
    });

    // UI view change updates camera
    this.ui.onViewModeChange((index) => {
      this.camera.setViewMode(index);
    });

    this.camera.onCinematicChange((active) => {
      this.ui.setDemoActive(active);
    });

    this.camera.onUserInteraction(() => {
      this.registerUserActivity(true);
      void this.audio.unlock();
    });

    this.ui.onDemoToggle(() => {
      this.registerUserActivity(false);
      if (this.camera.isCinematicActive()) {
        this.camera.stopCinematic();
      } else {
        this.camera.startCinematic(performance.now() * 0.001);
      }
    });

    this.ui.onDemoAutoToggle((enabled) => {
      this.demoAutoEnabled = enabled;
      this.registerUserActivity(false);
    });
    this.ui.onAudioToggle((muted) => {
      void this.audio.setMuted(muted);
    });
    this.ui.setAudioMuted(this.audio.isMuted());
    this.ui.onTrailsToggle((enabled) => {
      this.trailToggleOverride = enabled;
      this.applyQualityPreset(this.currentQualityLevel);
    });
    this.ui.onTrailLengthChange((mode) => {
      this.trailLengthMode = mode;
      this.applyQualityPreset(this.currentQualityLevel);
    });
    this.ui.onExposureModeChange((mode) => {
      this.exposureSettings.mode = mode;
      this.applyExposureSettings();
    });
    this.ui.onManualExposureChange((value) => {
      this.exposureSettings.manualExposure = clamp(value, 0.1, 10.0);
      this.applyExposureSettings();
    });
    this.ui.onExposureAdaptationSpeedChange((value) => {
      this.exposureSettings.adaptationSpeed = clamp(value, 0.1, 5.0);
      this.applyExposureSettings();
    });
    this.ui.onTonemapModeChange((mode) => {
      this.exposureSettings.tonemapMode = mode;
      this.applyExposureSettings();
    });

    this.ui.setDemoActive(false);
    this.ui.setDemoAutoEnabled(this.demoAutoEnabled);
    this.ui.setExposureControls(this.exposureSettings);

    // Stats update
    this.profiler.onStatsUpdate((stats) => {
      this.ui.updateStats(stats);
      this.lastVisibleCount = stats.visibleSatellites;
    });

    // Pattern button setup
    this.setupPatternButtons();
    
    // Animation pattern button setup
    this.setupAnimationPatternButtons();
    
    // Physics mode button setup
    this.setupPhysicsButtons();
    
    // Ground observer preset buttons
    this.setupGroundPresetButtons();
    
    // Time scale controls
    this.ui.createTimeScaleControl();
    this.ui.onTimeScaleChange((scale) => {
      this.setTimeScale(scale);
    });

    this.setupCaptureControls();
    
    // Quality preset buttons
    this.ui.onQualityChange((level) => {
      this.applyQualityPreset(level);
    });
    
    // TAA toggle button
    this.setupTAAToggle();
    
    // Camera angle change updates UI
    this.camera.onAngleChange((yaw, pitch) => {
      this.updateAngleDisplay(yaw, pitch);
    });
    this.camera.onTouchDoubleTap((x, y) => {
      this.focusSatelliteAtScreenPoint(x, y);
    });
    
    // Reset angle button
    const resetBtn = document.getElementById('resetAngle');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.camera.resetCameraAngle();
        this.updateAngleDisplay(0, 0);
      });
    }

    // Click to focus satellites
    this.canvas.addEventListener('click', (e) => this.handleCanvasClick(e));
    this.canvas.addEventListener('dblclick', () => {
      this.focusManager?.releaseFocus();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.focusManager?.releaseFocus();
      }
    });

    const controls = document.getElementById('controls');
    controls?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      const button = target?.closest('button') as HTMLButtonElement | null;
      if (!button) return;
      this.registerUserActivity(!button.hasAttribute('data-no-interrupt-demo'));
      if (this.shouldPlayButtonTick(button)) {
        this.audio.playButtonTick();
      }
    });
  }

  private shouldPlayButtonTick(button: HTMLButtonElement): boolean {
    if (/^btn[0-4]$/.test(button.id)) return false;
    if (button.id.startsWith('pbtn')) return false;
    if (button.id === 'capVideoStart') return false;
    return true;
  }

  private registerUserActivity(interruptCinematic: boolean): void {
    this.lastUserActivityTime = performance.now() * 0.001;
    void this.audio.unlock();
    if (interruptCinematic && this.camera.isCinematicActive()) {
      this.camera.stopCinematic();
    }
  }

  /**
   * Heuristically detect a mobile or tablet device.
   * Uses navigator.userAgentData when available (modern browsers), falls back to UA string.
   * Result is cached as `isMobileDevice` — do not call in hot paths.
   */
  private static detectMobileDevice(): boolean {
    if (navigator.maxTouchPoints > 1) {
      // userAgentData is more reliable than UA strings but not universally available
      if ('userAgentData' in navigator) {
        const data = (navigator as { userAgentData?: { mobile?: boolean } }).userAgentData;
        if (data && typeof data.mobile === 'boolean') return data.mobile;
      }
      return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    }
    return false;
  }

  /**
   * Choose a safer default quality level for mobile hardware.
   * Keeps desktop defaults untouched while preferring lower fill-rate on constrained devices.
   */
  private static detectMobileDefaultQuality(): QualityLevel {
    if (!GrokZephyrApp.detectMobileDevice()) {
      return 'high';
    }

    const nav = navigator as Navigator & { deviceMemory?: number };
    const deviceMemory = nav.deviceMemory ?? 0;
    const cores = navigator.hardwareConcurrency || 0;
    const isAndroid = /Android/i.test(navigator.userAgent);

    const lowMemory = deviceMemory > 0 && deviceMemory <= 4;
    const lowCoreCount = cores > 0 && cores <= 4;
    const constrainedAndroid = isAndroid && ((deviceMemory > 0 && deviceMemory <= 6) || (cores > 0 && cores <= 6));

    return (lowMemory || lowCoreCount || constrainedAndroid) ? 'low' : 'balanced';
  }

  /**
   * Setup TAA toggle button
   */
  private setupTAAToggle(): void {
    const btn = document.getElementById('taaToggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
      this.taaEnabled = !this.taaEnabled;
      this.postProcessStack?.enableTAA(this.taaEnabled);
      btn.textContent = this.taaEnabled ? 'TAA ON' : 'TAA OFF';
      btn.classList.toggle('active', this.taaEnabled);
      console.log(`🔲 TAA: ${this.taaEnabled ? 'enabled' : 'disabled'}`);
    });
    // Reflect initial state
    btn.textContent = this.taaEnabled ? 'TAA ON' : 'TAA OFF';
    btn.classList.toggle('active', this.taaEnabled);
  }

  /**
   * Setup ground observer preset selector buttons
   */
  private setupGroundPresetButtons(): void {
    const presetButtons = document.querySelectorAll('.preset-btn');
    presetButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.target as HTMLButtonElement;
        const preset = target.dataset.preset as GroundObserverPreset;
        if (!preset) return;

        this.groundObserver.setPreset(preset);

        // Update overlay class
        this.applyGroundOverlayClass(this.groundObserver.getOverlayClass());

        // Update active button
        presetButtons.forEach(b => b.classList.remove('active'));
        target.classList.add('active');
      });
    });
  }

  /**
   * Show or hide the ground observer overlay based on current camera mode
   */
  private updateGroundObserverOverlay(): void {
    const overlay = document.getElementById('ground-observer-overlay');
    const presetSelector = document.getElementById('ground-preset-selector');
    const isGround = this.camera.getViewMode() === 'ground';

    if (overlay) overlay.style.display = isGround ? 'block' : 'none';
    if (presetSelector) presetSelector.style.display = isGround ? 'flex' : 'none';

    if (isGround) {
      this.applyGroundOverlayClass(this.groundObserver.getOverlayClass());
    }
  }

  /**
   * Apply a preset's frame class to the overlay element
   */
  private applyGroundOverlayClass(overlayClass: string): void {
    const overlay = document.getElementById('ground-observer-overlay');
    if (!overlay) return;
    // Remove all frame-* classes then add the current one
    for (const cls of Array.from(overlay.classList)) {
      if (cls.startsWith('frame-')) overlay.classList.remove(cls);
    }
    overlay.classList.add(overlayClass);
  }

  private setupCaptureControls(): void {
    this.captureStatus = document.getElementById('captureStatus');
    this.captureGallery = document.getElementById('capture-gallery');
    this.captureOverlayToggle = document.getElementById('capOverlayToggle') as HTMLInputElement | null;
    this.captureHideUIToggle = document.getElementById('capHideUIToggle') as HTMLInputElement | null;
    this.captureVideoLength = document.getElementById('capVideoLength') as HTMLSelectElement | null;
    this.captureVideoButton = document.getElementById('capVideoStart') as HTMLButtonElement | null;
    this.captureHideElements = GrokZephyrApp.CAPTURE_UI_HIDE_IDS
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);

    const still1x = document.getElementById('capStill1x');
    const still2x = document.getElementById('capStill2x');

    still1x?.addEventListener('click', () => {
      void this.captureStillImage(1);
    });
    still2x?.addEventListener('click', () => {
      void this.captureStillImage(2);
    });
    this.captureVideoButton?.addEventListener('click', () => {
      const seconds = parseInt(this.captureVideoLength?.value ?? '5', 10) || 5;
      void this.captureVideoClip(seconds);
    });
  }

  private setCaptureStatus(text: string): void {
    if (this.captureStatus) {
      this.captureStatus.textContent = text;
    }
  }

  private getCurrentViewDisplayName(): string {
    switch (this.camera.getViewMode()) {
      case 'horizon-720': return '720km Horizon';
      case 'god': return 'God View';
      case 'sat-pov': return 'Fleet POV';
      case 'ground': return 'Ground View';
      case 'moon': return 'Moon View';
      default: return 'Unknown';
    }
  }

  private getCaptureMeta() {
    const modeName = this.getCurrentViewDisplayName();
    const patternName = this.patternNameDisplay?.textContent?.trim() || getBeamPatternTitle(this.currentPatternMode);
    const timestamp = new Date().toISOString().replace('T', ' ').replace(/\..+$/, ' UTC');
    return { modeName, patternName, timestamp };
  }

  private drawBrandOverlay(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const { modeName, patternName, timestamp } = this.getCaptureMeta();
    const pad = Math.max(12, Math.round(width * 0.012));
    const cardWidth = Math.min(width * 0.62, 480);
    const cardHeight = Math.max(78, Math.round(height * 0.16));

    ctx.fillStyle = 'rgba(0, 8, 20, 0.65)';
    ctx.strokeStyle = 'rgba(102, 204, 255, 0.75)';
    ctx.lineWidth = Math.max(1, Math.round(width * 0.0012));
    ctx.fillRect(pad, height - cardHeight - pad, cardWidth, cardHeight);
    ctx.strokeRect(pad, height - cardHeight - pad, cardWidth, cardHeight);

    ctx.fillStyle = '#ffffff';
    ctx.font = `${Math.max(12, Math.round(width * 0.015))}px "Courier New", monospace`;
    ctx.fillText('GROK ZEPHYR', pad + 10, height - cardHeight + 18 - pad);

    ctx.fillStyle = '#66ccff';
    ctx.font = `${Math.max(10, Math.round(width * 0.0115))}px "Courier New", monospace`;
    ctx.fillText(`View: ${modeName}`, pad + 10, height - cardHeight + 38 - pad);
    ctx.fillText(`Pattern: ${patternName}`, pad + 10, height - cardHeight + 56 - pad);
    ctx.fillText(timestamp, pad + 10, height - cardHeight + 72 - pad);
  }

  private drawGroundCaptureFrame(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.30)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.58)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(180, 210, 255, 0.45)';
    ctx.lineWidth = Math.max(3, Math.round(width * 0.005));
    const inset = Math.round(width * 0.02);
    ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
  }

  private drawCaptureFrame(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(this.canvas, 0, 0, width, height);

    const hideUI = this.captureHideUIToggle?.checked ?? false;
    if (!hideUI && this.camera.getViewMode() === 'ground') {
      this.drawGroundCaptureFrame(ctx, width, height);
    }

    if (this.captureOverlayToggle?.checked ?? true) {
      this.drawBrandOverlay(ctx, width, height);
    }
  }

  private async withCaptureUIVisibility<T>(fn: () => Promise<T>): Promise<T> {
    const hideUI = this.captureHideUIToggle?.checked ?? false;
    if (!hideUI) {
      return fn();
    }

    const affected = this.captureHideElements;
    const previous = affected.map((el) => el.style.visibility);

    affected.forEach((el) => {
      el.style.visibility = 'hidden';
    });

    try {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      return await fn();
    } finally {
      affected.forEach((el, idx) => {
        el.style.visibility = previous[idx];
      });
    }
  }

  private downloadUrl(url: string, filename: string): void {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  private addCaptureToGallery(url: string, type: 'image' | 'video', label: string): void {
    if (!this.captureGallery) return;

    const item = document.createElement('a');
    item.className = 'capture-gallery-item';
    item.href = url;
    item.download = label;
    item.title = label;
    item.dataset.captureUrl = url;
    item.setAttribute('aria-label', `Captured ${type} ${label}`);

    if (type === 'image') {
      const img = document.createElement('img');
      img.src = url;
      img.alt = label;
      item.appendChild(img);
    } else {
      const video = document.createElement('video');
      video.src = url;
      video.muted = true;
      video.loop = true;
      video.autoplay = true;
      video.playsInline = true;
      item.appendChild(video);
    }

    const meta = document.createElement('span');
    meta.textContent = label;
    item.appendChild(meta);

    this.captureGallery.prepend(item);
    while (this.captureGallery.children.length > GrokZephyrApp.CAPTURE_GALLERY_LIMIT) {
      const last = this.captureGallery.lastElementChild as HTMLAnchorElement | null;
      if (!last) break;
      const oldUrl = last.dataset.captureUrl;
      if (oldUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(oldUrl);
      }
      this.captureGallery.removeChild(last);
    }
  }

  private getCaptureFilename(prefix: string, ext: string): string {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
    return `grok-zephyr-${prefix}-${stamp}.${ext}`;
  }

  private toBlobUrl(canvas: HTMLCanvasElement, mimeType: string): Promise<string> {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Failed to encode capture'));
          return;
        }
        resolve(URL.createObjectURL(blob));
      }, mimeType);
    });
  }

  private async captureStillImage(scale: 1 | 2): Promise<void> {
    if (this.captureInProgress) return;
    this.captureInProgress = true;
    this.setCaptureStatus(`Capturing PNG ${scale}x...`);

    try {
      await this.withCaptureUIVisibility(async () => {
        const width = Math.floor(this.canvas.width * scale);
        const height = Math.floor(this.canvas.height * scale);
        const outCanvas = document.createElement('canvas');
        outCanvas.width = width;
        outCanvas.height = height;
        const ctx = outCanvas.getContext('2d');
        if (!ctx) throw new Error('2D capture context unavailable');

        this.drawCaptureFrame(ctx, width, height);
        const url = await this.toBlobUrl(outCanvas, 'image/png');
        const filename = this.getCaptureFilename(`${scale}x`, 'png');
        this.addCaptureToGallery(url, 'image', filename);
        this.downloadUrl(url, filename);
      });
      this.audio.playCaptureToggle(false);
      this.setCaptureStatus(`Saved PNG ${scale}x`);
    } catch (error) {
      console.error('Capture failed:', error);
      this.setCaptureStatus('Capture failed');
    } finally {
      this.captureInProgress = false;
    }
  }

  private getVideoMimeType(): string {
    for (const type of GrokZephyrApp.PREFERRED_VIDEO_MIME_TYPES) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return '';
  }

  private async captureVideoClip(durationSeconds: number): Promise<void> {
    if (this.captureInProgress || durationSeconds <= 0) return;
    if (!('MediaRecorder' in window)) {
      this.setCaptureStatus('MediaRecorder unsupported');
      return;
    }

    this.captureInProgress = true;
    if (this.captureVideoButton) this.captureVideoButton.disabled = true;
    this.setCaptureStatus(`Recording ${durationSeconds}s...`);
    this.audio.playCaptureToggle(true);

    try {
      await this.withCaptureUIVisibility(async () => {
        const width = this.canvas.width;
        const height = this.canvas.height;
        const recorderCanvas = document.createElement('canvas');
        recorderCanvas.width = width;
        recorderCanvas.height = height;
        const ctx = recorderCanvas.getContext('2d');
        if (!ctx) throw new Error('2D capture context unavailable');

        const stream = recorderCanvas.captureStream(30);
        const mimeType = this.getVideoMimeType();
        let recorder: MediaRecorder;
        try {
          recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        } catch {
          throw new Error(`Failed to initialize video recorder${mimeType ? ` (${mimeType})` : ''}`);
        }
        const chunks: BlobPart[] = [];
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };

        const started = performance.now();
        let rafId = 0;

        await new Promise<void>((resolve, reject) => {
          recorder.onerror = () => reject(new Error('Video recording failed'));
          recorder.onstop = () => resolve();
          recorder.start(250);

          const renderFrame = () => {
            const elapsed = (performance.now() - started) / 1000;
            this.drawCaptureFrame(ctx, width, height);
            const remaining = Math.max(0, durationSeconds - elapsed);
            this.setCaptureStatus(`Recording ${remaining.toFixed(1)}s...`);
            if (elapsed >= durationSeconds) {
              recorder.stop();
              return;
            }
            rafId = requestAnimationFrame(renderFrame);
          };
          rafId = requestAnimationFrame(renderFrame);
        }).finally(() => {
          cancelAnimationFrame(rafId);
          stream.getTracks().forEach((track) => track.stop());
        });

        const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
        const url = URL.createObjectURL(blob);
        const filename = this.getCaptureFilename(`${durationSeconds}s`, 'webm');
        this.addCaptureToGallery(url, 'video', filename);
        this.downloadUrl(url, filename);
      });
      this.audio.playCaptureToggle(false);
      this.setCaptureStatus('Saved video clip');
    } catch (error) {
      console.error('Video capture failed:', error);
      this.setCaptureStatus('Video capture failed');
    } finally {
      if (this.captureVideoButton) this.captureVideoButton.disabled = false;
      this.captureInProgress = false;
    }
  }
  
  /**
   * Update angle display in UI
   */
  private updateAngleDisplay(yaw: number, pitch: number): void {
    const angleInfo = document.getElementById('angleInfo');
    if (angleInfo) {
      angleInfo.textContent = `Yaw: ${yaw.toFixed(0)}° Pitch: ${pitch.toFixed(0)}°`;
    }
  }

  private handleCanvasClick(event: MouseEvent): void {
    this.focusSatelliteAtScreenPoint(event.clientX, event.clientY);
  }

  private focusSatelliteAtScreenPoint(clientX: number, clientY: number): void {
    if (!this.focusManager || !this.buffers || !this.context) return;
    const time = this.lastTime || performance.now() / 1000;
    const cameraState = this.camera.calculateCamera(
      (idx, t) => this.buffers!.calculateSatellitePosition(idx, t),
      (idx, t) => this.buffers!.calculateSatelliteVelocity(idx, t),
      time
    );

    const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    const { viewProjection } = this.camera.buildViewProjection(cameraState, aspect);
    const selection = this.focusManager.raycast(clientX, clientY, cameraState, viewProjection, time);
    if (selection) {
      this.focusManager.selectSatellite(selection);
    }
  }

  private setupMobileOrientationSupport(): void {
    if (!this.isMobileDevice) return;
    this.updateMobileViewportPresentation();
    window.addEventListener('orientationchange', this.orientationChangeListener);
    window.addEventListener('pointerdown', this.orientationLockGestureListener, { passive: true });
    window.addEventListener('touchstart', this.orientationLockGestureListener, { passive: true });
  }

  private tryLockLandscapeOrientation(): void {
    if (this.orientationLockAttempted) return;
    this.orientationLockAttempted = true;
    window.removeEventListener('pointerdown', this.orientationLockGestureListener);
    window.removeEventListener('touchstart', this.orientationLockGestureListener);

    if (!('orientation' in screen)) return;
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (orientation: 'any' | 'natural' | 'landscape' | 'portrait' | 'portrait-primary' | 'portrait-secondary' | 'landscape-primary' | 'landscape-secondary') => Promise<void>;
    };
    if (typeof orientation.lock !== 'function') return;

    orientation.lock('landscape').catch(() => {
      // Ignore lock errors (unsupported, denied, or unavailable without fullscreen).
    });
  }

  private updateMobileViewportPresentation(): void {
    if (!this.isMobileDevice) return;

    const portrait = window.innerHeight > window.innerWidth;
    document.body.classList.toggle('is-portrait-mobile', portrait);

    if (portrait) {
      const letterboxAspect = 16 / 9;
      const letterboxHeight = Math.max(1, Math.floor(window.innerWidth / letterboxAspect));
      const height = Math.min(window.innerHeight, letterboxHeight);
      const top = Math.max(0, Math.floor((window.innerHeight - height) * 0.5));
      this.canvas.style.width = '100vw';
      this.canvas.style.height = `${height}px`;
      this.canvas.style.top = `${top}px`;
      this.canvas.style.left = '0px';
    } else {
      this.canvas.style.width = '100vw';
      this.canvas.style.height = '100vh';
      this.canvas.style.top = '0px';
      this.canvas.style.left = '0px';
    }
  }

  /**
   * Setup pattern switcher buttons
   */
  private setupPatternButtons(): void {
    const patternButtons = document.querySelectorAll('.pbtn');
    patternButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.target as HTMLButtonElement;
        const mode = parseInt(target.dataset.pattern || '1');
        this.setPatternMode(mode);
        
        // Update active state
        patternButtons.forEach(b => b.classList.remove('active'));
        target.classList.add('active');
      });
    });
  }

  /**
   * Resolve the TLE data source from the query string.
   *
   * Supports:
   *   ?tle=starlink       → CelesTrak Starlink group
   *   ?tle=oneweb         → CelesTrak OneWeb group
   *   ?tle=https://...    → arbitrary URL returning 3-line TLE text
   *
   * Returns null if no ?tle param is present (uses default procedural mode).
   */
  private getTLESource(): string | null {
    const params = new URLSearchParams(window.location.search);
    const tleParam = params.get('tle');
    if (!tleParam) return null;

    const lower = tleParam.toLowerCase();
    if (CELESTRAK_GROUPS[lower]) {
      return `https://celestrak.org/NORAD/elements/gp.php?GROUP=${CELESTRAK_GROUPS[lower]}&FORMAT=tle`;
    }

    // Treat as a direct URL if it starts with http(s)
    if (tleParam.startsWith('http://') || tleParam.startsWith('https://')) {
      return tleParam;
    }

    // Otherwise treat as a CelesTrak group name (best-effort)
    return `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(tleParam)}&FORMAT=tle`;
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
  
  /**
   * Set animation pattern mode (3=smile, 4=digital_rain, 5=heartbeat)
   */
  setAnimationPattern(mode: number): void {
    if (!this.context || !this.buffers) return;

    // Toggle off if clicking the same pattern again
    if (this.currentAnimationPattern === mode) {
      mode = 0;
    }

    this.currentAnimationPattern = mode;
    this.patternAnimationStart = performance.now() / 1000;
    this.writePatternParamsBuffer();

    const modeNames = ['OFF', '', '', '😊 SMILE', '💧 DIGITAL RAIN', '💓 HEARTBEAT'];
    console.log(`🎭 Animation pattern: ${modeNames[mode]}`);
  }

  private updateSelectedSatelliteIndex(index: number): void {
    this.selectedSatelliteIndex = index;
    this.writePatternParamsBuffer();
  }

  private handleFocusSelectionChange(selection: FocusSelection | null): void {
    this.updateSelectedSatelliteIndex(selection?.index ?? -1);
    if (selection) {
      this.audio.playFocusChime(selection.altitude);
    }
  }

  setGroundViewEnabled(enabled: boolean): void {
    this.groundViewEnabled = enabled;
    this.earthAtmosphereRenderer?.setEnabled(enabled);
  }

  private writePatternParamsBuffer(): void {
    if (!this.context || !this.buffers) return;

    const patternParamsData = new ArrayBuffer(16);
    const f32 = new Float32Array(patternParamsData);
    const u32 = new Uint32Array(patternParamsData);

    u32[0] = this.currentAnimationPattern;
    f32[1] = this.patternAnimationStart || performance.now() / 1000;
    f32[2] = this.patternSeed;
    u32[3] = this.selectedSatelliteIndex >= 0 ? this.selectedSatelliteIndex : 0xFFFFFFFF;

    this.context.writeBuffer(this.buffers.getBuffers().patternParams, patternParamsData);
  }

  private updatePatternTitle(): void {
    if (this.patternNameDisplay) {
      this.patternNameDisplay.textContent = getBeamPatternTitle(this.currentPatternMode);
    }
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
   * Setup animation pattern buttons
   */
  private setupAnimationPatternButtons(): void {
    const animButtons = document.querySelectorAll('.anim-btn');
    animButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.target as HTMLButtonElement;
        const mode = parseInt(target.dataset.pattern || '3');
        this.setAnimationPattern(mode);
        
        // Update active state
        animButtons.forEach(b => b.classList.remove('active'));
        target.classList.add('active');
      });
    });
  }

  /**
   * Setup physics mode switcher buttons
   */
  private setupPhysicsButtons(): void {
    const physicsButtons = document.querySelectorAll('.physics-btn:not(.disabled)');
    physicsButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.target as HTMLButtonElement;
        const mode = parseInt(target.dataset.physics || '0');
        this.setPhysicsMode(mode);
        
        // Update active state
        physicsButtons.forEach(b => b.classList.remove('active'));
        target.classList.add('active');
      });
    });
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
   * Get current quality preset level.
   */
  getQualityLevel(): QualityLevel {
    return this.currentQualityLevel;
  }

  private applyExposureSettings(): void {
    this.exposureSettings.manualExposure = clamp(this.exposureSettings.manualExposure, 0.1, 10.0);
    this.exposureSettings.adaptationSpeed = clamp(this.exposureSettings.adaptationSpeed, 0.1, 5.0);
    this.pipeline?.setExposureSettings({
      autoEnabled: this.exposureSettings.mode === 'auto',
      manualExposure: this.exposureSettings.manualExposure,
      adaptationSpeed: this.exposureSettings.adaptationSpeed,
      tonemapMode: this.exposureSettings.tonemapMode,
    });
    this.ui.setExposureControls(this.exposureSettings);
    saveExposureSettings(this.exposureSettings);
  }

  /**
   * Apply a quality preset to all affected renderers.
   *
   * Quality levels control trail rendering, earth atmosphere, and other
   * visual settings without requiring shader recompilation.
   */
  applyQualityPreset(level: QualityLevel): void {
    const preset = QUALITY_PRESETS[level];
    this.currentQualityLevel = level;
    const effectiveTrail = this.getEffectiveTrailConfig(level);

    // Apply trail settings
    if (this.trailRenderer) {
      this.trailRenderer.setConfig(effectiveTrail);
    }

    // Apply atmosphere settings
    if (this.earthAtmosphereRenderer) {
      this.earthAtmosphereRenderer.setConfig({
        enabled: preset.atmosphere.enabled,
        cloudAlpha: preset.atmosphere.cloudAlpha,
        cloudSpeed: preset.atmosphere.cloudSpeed,
        cloudScale: preset.atmosphere.cloudScale,
        hazeStrength: preset.atmosphere.hazeStrength,
      });
    }
    this.pipeline?.setAtmosphereScatteringConfig(
      preset.atmosphere.scatteringLUT,
      preset.atmosphere.hazeStrength
    );

    // Apply TAA setting from quality preset
    if (this.postProcessStack) {
      const taaEnabled = preset.taaEnabled;
      this.taaEnabled = taaEnabled;
      this.postProcessStack.enableTAA(taaEnabled);
      // Sync the UI button label
      const btn = document.getElementById('taaToggle');
      if (btn) {
        btn.textContent = taaEnabled ? 'TAA ON' : 'TAA OFF';
        btn.classList.toggle('active', taaEnabled);
      }
    }

    // Apply volumetric beam settings
    this.applyVolumetricBeamPreset(preset.volumetricBeams.enabled, {
      maxSteps:     preset.volumetricBeams.maxSteps,
      density:      preset.volumetricBeams.density,
      intensity:    preset.volumetricBeams.intensity,
      mieG:         preset.volumetricBeams.mieG,
      beamRadius:   preset.volumetricBeams.beamRadius,
      ambientFactor:preset.volumetricBeams.ambientFactor,
      earthShadow:  preset.volumetricBeams.earthShadow,
    });

    this.pipeline?.setDepthOfFieldConfig(preset.depthOfField);
    this.pipeline?.setMotionBlurConfig(preset.motionBlur);

    // Update UI
    this.ui.setActiveQualityButton(level);
    this.ui.setTrailsEnabled(effectiveTrail.enabled);
    this.ui.setTrailLengthMode(this.trailLengthMode);
    saveQualityLevel(level);

    console.log(`🎨 Quality preset: ${preset.label} — ${preset.description}`);
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

  /**
   * Parse initial-state URL parameters for the application.
   *
   * Supported params:
   *   ?mode=0-4            view mode index
   *   ?preset=low|balanced|high|cinematic   quality preset
   *   ?physics=0-2         physics mode
   *   ?pattern=0-2         beam pattern mode
   */
  private parseInitialStateFromURL(): {
    viewMode: number | null;
    qualityLevel: QualityLevel | null;
    physicsMode: number | null;
    patternMode: number | null;
  } {
    const params = new URLSearchParams(window.location.search);

    const parseIntParam = (key: string, min: number, max: number): number | null => {
      const raw = params.get(key);
      if (!raw) return null;
      const val = parseInt(raw, 10);
      if (isNaN(val) || val < min || val > max) return null;
      return val;
    };

    return {
      viewMode:     parseIntParam('mode',    0, 4),
      qualityLevel: parseQualityParam(params.get('preset')),
      physicsMode:  parseIntParam('physics', 0, 2),
      patternMode:  parseIntParam('pattern', 0, 2),
    };
  }

  /**
   * Initialize the application
   */
  async initialize(): Promise<void> {
    try {
      console.log('[GrokZephyr] Initializing...');
      
      // Initialize WebGPU
      this.context = new WebGPUContext(this.canvas);
      const { device } = await this.context.initialize();
      
      // Initialize performance profiler
      await this.profiler.initialize(device);
      
      // Attach camera to canvas
      this.camera.attachToCanvas(this.canvas);
      this.setupMobileOrientationSupport();
      
      // Initialize buffers
      this.buffers = new SatelliteGPUBuffer(this.context);
      const bufferSet = this.buffers.initialize();
      
      // Focus manager for click-to-focus satellite selection
      this.focusManager = new FocusManager(
        this.canvas,
        this.camera,
        this.buffers,
        (selection) => this.handleFocusSelectionChange(selection)
      );

      // Load orbital data: TLE if requested via query param, else procedural Walker
      const tleSource = this.getTLESource();
      let dataSourceLabel = 'Procedural Walker';
      let realTLECount = 0;

      if (tleSource) {
        try {
          console.log(`[GrokZephyr] Loading TLE data from: ${tleSource}`);
          const tles = await TLELoader.fromFile(tleSource);
          if (tles.length > 0) {
            realTLECount = this.buffers.loadFromTLEData(tles);
            dataSourceLabel = `TLE (${realTLECount.toLocaleString()} real)`;
            console.log(`[GrokZephyr] Loaded ${realTLECount} TLE satellites, padded to ${CONSTANTS.NUM_SATELLITES.toLocaleString()}`);
          } else {
            console.warn('[GrokZephyr] TLE source returned 0 records, falling back to procedural');
            this.buffers.generateOrbitalElements();
          }
        } catch (err) {
          console.warn('[GrokZephyr] TLE fetch/parse failed, falling back to procedural generation:', err);
          this.buffers.generateOrbitalElements();
        }
      } else {
        this.buffers.generateOrbitalElements();
      }
      this.buffers.uploadOrbitalElements();
      
      // Create Earth geometry
      this.createEarthGeometry();
      
      // Initialize render pipeline
      this.pipeline = new RenderPipeline(this.context, bufferSet);
      
      // Set initial canvas size and initialize pipeline
      const rawDpr = window.devicePixelRatio || 1;
      const dpr = this.isMobileDevice ? Math.min(rawDpr, 1.5) : rawDpr;
      const width = Math.floor(this.canvas.clientWidth * dpr);
      const height = Math.floor(this.canvas.clientHeight * dpr);
      
      // Explicitly set canvas dimensions
      this.canvas.width = width;
      this.canvas.height = height;
      
      this.pipeline.initialize(width, height);
      this.buffers.updateBloomUniforms(width, height);
      window.addEventListener('resize', this.resizeListener);

      // Initialize PostProcessStack — operates in "skip-final-tonemap" mode so it
      // acts as a post-composite TAA + color-grading layer without double-tonemapping.
      this.postProcessStack = new PostProcessStack(
        this.context,
        {}, // PostProcessConfig — defaults apply (film grain, color grading, sharpness)
        { enabled: this.taaEnabled },
        /* skipFinalTonemap */ true
      );
      this.postProcessStack.initialize(width, height);

      this.trailRenderer = new TrailRenderer(this.context, {
        enabled: false,
        maxLength: 45,
        fadeOut: 45,
        colorByShell: true,
        ribbonWidth: 8.0,
      });
      this.trailRenderer.initialize();

      this.earthAtmosphereRenderer = new EarthAtmosphereRenderer(this.context, {
        enabled: true,
        cloudSpeed: 0.02,
        cloudAlpha: 0.38,
        cloudScale: 1.006,
        hazeStrength: 0.28,
      });
      this.earthAtmosphereRenderer.initialize(this.buffers.getBuffers().uniforms);
      
      // Update UI
      this.ui.setFleetCount(CONSTANTS.NUM_SATELLITES);
      this.ui.setDataSource(dataSourceLabel);
      this.dataSourceLabel = dataSourceLabel;
      this.ui.hideError();

      // Parse URL params for initial state
      const urlParams = this.parseInitialStateFromURL();

      // Determine initial quality level using the precedence:
      //   1. ?preset= URL parameter (highest priority — explicit user request)
      //   2. localStorage saved value (user's last session choice)
      //   3. hardware-safe default on mobile, 'high' on desktop
      let savedQuality: QualityLevel | null = null;
      try {
        const stored = localStorage.getItem('grokzephyr-quality') as QualityLevel | null;
        if (stored && stored in QUALITY_PRESETS) savedQuality = stored;
      } catch {
        // localStorage unavailable — proceed without saved value
      }

      const initialQuality: QualityLevel =
        urlParams.qualityLevel ??
        savedQuality ??
        (this.isMobileDevice ? this.mobileDefaultQuality : 'high');
      this.currentQualityLevel = initialQuality;

      // Apply initial quality preset (this also updates the UI buttons)
      this.applyQualityPreset(initialQuality);
      this.applyExposureSettings();

      // Apply URL param overrides for view mode, physics, and beam pattern
      const initialViewMode = urlParams.viewMode ?? 0;
      this.camera.setViewMode(initialViewMode);

      if (urlParams.physicsMode !== null) {
        this.setPhysicsMode(urlParams.physicsMode);
        this.ui.setActivePhysicsButton(urlParams.physicsMode);
      }

      if (urlParams.patternMode !== null) {
        this.setPatternMode(urlParams.patternMode);
      }
      
      // Initialize performance dashboard
      await this.ui.initializeDashboard(this.profiler);
      
      // Start render loop
      this.start();
      
      console.log('[GrokZephyr] Initialization complete');
      
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Create Earth sphere geometry
   */
  private createEarthGeometry(): void {
    if (!this.context) return;
    
    const sphere = genSphere(
      CONSTANTS.EARTH_RADIUS_KM,
      64, // rings
      64  // segments
    );
    
    this.earthIndexCount = sphere.indices.length;
    
    // Interleave position and normal data
    const vertexCount = sphere.vertices.length / 3;
    const interleaved = new Float32Array(vertexCount * 6);
    
    for (let i = 0; i < vertexCount; i++) {
      interleaved[i * 6 + 0] = sphere.vertices[i * 3 + 0];
      interleaved[i * 6 + 1] = sphere.vertices[i * 3 + 1];
      interleaved[i * 6 + 2] = sphere.vertices[i * 3 + 2];
      interleaved[i * 6 + 3] = sphere.normals[i * 3 + 0];
      interleaved[i * 6 + 4] = sphere.normals[i * 3 + 1];
      interleaved[i * 6 + 5] = sphere.normals[i * 3 + 2];
    }
    
    this.earthVertexBuffer = this.context.createVertexBuffer(interleaved.byteLength);
    this.context.writeBuffer(this.earthVertexBuffer, interleaved);
    
    this.earthIndexBuffer = this.context.createIndexBuffer(sphere.indices.byteLength);
    this.context.writeBuffer(this.earthIndexBuffer, sphere.indices);
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
  private handleResize(): void {
    this.updateMobileViewportPresentation();
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
   * Calculate sun position in ECI frame for eclipse shadow calculation.
   * Sun orbits at 1 AU in the XY plane.
   */
  private calculateSunPosition(simTime: number): [number, number, number] {
    // Sun at 1 AU, rotating in XY plane
    // Angular frequency: 2π / (365.25 days in seconds)
    const SUN_DISTANCE_KM = 149597870.0;
    const ORBITAL_PERIOD_SEC = 31557600.0; // 365.25 days
    const angle = (simTime / ORBITAL_PERIOD_SEC) * Math.PI * 2;
    return [
      Math.cos(angle) * SUN_DISTANCE_KM,
      Math.sin(angle) * SUN_DISTANCE_KM,
      0.0
    ];
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
   * Build the current ConstellationStats snapshot for the satellite inspector.
   */
  private buildConstellationStats(): ConstellationStats {
    const physicsNames = ['Simple', 'Keplerian', 'J2 Perturbed'];
    // Animation pattern IDs 1 and 2 are beam-pattern modes; IDs 3-5 are animation patterns.
    // These labels mirror those in UIManager.ts — if patterns are added there, update here too.
    const animNames: Record<number, string> = {
      0: 'None',
      3: 'Smile',
      4: 'Digital Rain',
      5: 'Heartbeat',
    };
    return {
      viewModeName: this.camera.getViewMode(),
      physicsModeName: physicsNames[this.currentPhysicsMode] ?? 'Simple',
      timeScale: this.timeScale,
      dataSource: this.dataSourceLabel,
      visibleCount: this.lastVisibleCount,
      animationPattern: animNames[this.currentAnimationPattern] ?? 'None',
    };
  }

  /**
   * Write uniform buffer data
   */
  private writeUniforms(time: number, deltaTime: number, camera: CameraState | null = null): void {
    if (!this.context || !this.buffers) return;
    
    const { width, height } = this.context.getCanvasSize();
    const aspect = width / height;
    
    const cameraState = camera ?? this.camera.calculateCamera(
      (idx, t) => this.buffers!.calculateSatellitePosition(idx, t),
      (idx, t) => this.buffers!.calculateSatelliteVelocity(idx, t),
      time
    );
    
    const { viewProjection, view } = this.camera.buildViewProjection(cameraState, aspect);
    const inverseViewProjection = mat4inv(viewProjection);
    const { right, up } = this.camera.getCameraAxes(view);
    
    // Extract frustum planes
    const frustum = extractFrustum(viewProjection);
    
    // Calculate camera radius for ground view detection
    const cameraRadius = Math.sqrt(
      cameraState.position[0] * cameraState.position[0] +
      cameraState.position[1] * cameraState.position[1] +
      cameraState.position[2] * cameraState.position[2]
    );
    
    // Pack view_flags: view_mode (bits 0-15), is_ground_view (bit 16), physics_mode (bits 17-19)
    const viewMode = this.camera.getViewModeIndex();
    const isGroundView = cameraRadius < CONSTANTS.EARTH_RADIUS_KM + 100.0 ? 1 : 0;
    const physicsMode = this.currentPhysicsMode;
    const viewFlags = (viewMode & 0xFFFF) | ((isGroundView & 0x1) << 16) | ((physicsMode & 0x7) << 17);
    
    // Calculate sun position based on scaled simulation time
    const sunPos = this.calculateSunPosition(this.simTime);
    
    // Build uniform buffer (256 bytes)
    const uniformData = new ArrayBuffer(BUFFER_SIZES.UNIFORM);
    const f32 = new Float32Array(uniformData);
    const u32 = new Uint32Array(uniformData);
    
    // View-projection matrix (0-63) - f32[0-15]
    f32.set(viewProjection, 0);
    
    // Camera position (64-79) - f32[16-19]
    f32[16] = cameraState.position[0];
    f32[17] = cameraState.position[1];
    f32[18] = cameraState.position[2];
    f32[19] = 1.0;
    
    // Camera right (80-95) - f32[20-23]
    f32[20] = right[0];
    f32[21] = right[1];
    f32[22] = right[2];
    f32[23] = 0.0;
    
    // Camera up (96-111) - f32[24-27]
    f32[24] = up[0];
    f32[25] = up[1];
    f32[26] = up[2];
    f32[27] = 0.0;
    
    // Time (112-115) - f32[28]
    f32[28] = time;
    // Delta time (116-119) - f32[29]
    f32[29] = deltaTime;
    // View flags (120-123) - u32[30]
    u32[30] = viewFlags;
    // sim_time (124-127) - f32[31]: scaled simulation time (is_ground_view is packed in viewFlags bit 16)
    f32[31] = this.simTime;
    
    // Frustum planes (128-223) - 6 planes * 4 floats each - f32[32-55]
    for (let p = 0; p < 6; p++) {
      f32[32 + p * 4 + 0] = frustum[p][0];
      f32[32 + p * 4 + 1] = frustum[p][1];
      f32[32 + p * 4 + 2] = frustum[p][2];
      f32[32 + p * 4 + 3] = frustum[p][3];
    }
    
    // Screen size (224-231) - f32[56-57]
    f32[56] = width;
    f32[57] = height;
    // Time scale (232-235) - f32[58]
    f32[58] = this.timeScale;
    // Background mode (236-239) - u32[59]
    u32[59] = getBackgroundModeIndex();
    
    // Sun position (240-255) - vec4f - f32[60-63]
    f32[60] = sunPos[0];
    f32[61] = sunPos[1];
    f32[62] = sunPos[2];
    f32[63] = 1.0; // w component
    
    // Write to GPU
    this.context.writeBuffer(this.buffers.getBuffers().uniforms, uniformData);
    this.pipeline?.setMotionBlurFrameData(viewProjection, inverseViewProjection, viewMode, deltaTime);
    
    // Update beam params time
    this.updateBeamParamsTime(time);
  }

  /**
   * Update beam params time for animation
   */
  private updateBeamParamsTime(time: number): void {
    if (!this.context || !this.buffers) return;
    
    const beamParamsData = new ArrayBuffer(16);
    const f32 = new Float32Array(beamParamsData);
    const u32 = new Uint32Array(beamParamsData);
    
    f32[0] = time;
    u32[1] = this.currentPatternMode;
    u32[2] = 65536;
    u32[3] = 0;
    
    this.context.writeBuffer(this.buffers.getBuffers().beamParams, beamParamsData);
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
      this.focusManager.setConstellationStats(this.buildConstellationStats());
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
    this.writeUniforms(time, deltaTime, cameraState);
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
    this.recordPassTimings();
    
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

  /**
   * Record estimated pass timings based on quality level
   */
  private recordPassTimings(): void {
    const preset = QUALITY_PRESETS[this.currentQualityLevel];
    const effectiveTrail = this.getEffectiveTrailConfig(this.currentQualityLevel);
    
    // Estimate pass timings based on quality settings using TIMING_ESTIMATES constants
    const computeMultiplier = effectiveTrail.enabled ? TIMING_ESTIMATES.COMPUTE_TRAIL_MULT : TIMING_ESTIMATES.COMPUTE_NO_TRAIL_MULT;
    const computeTime = TIMING_ESTIMATES.BASE_COMPUTE * computeMultiplier;
    const sceneMultiplier = preset.atmosphere.enabled ? TIMING_ESTIMATES.SCENE_ATMOSPHERE_MULT : 1.0;
    const sceneTime = TIMING_ESTIMATES.BASE_SCENE * sceneMultiplier;
    const bloomTime = effectiveTrail.enabled ? TIMING_ESTIMATES.BASE_BLOOM : TIMING_ESTIMATES.BLOOM_DISABLED;
    
    const postProcessTime = this.postProcessStack ? TIMING_ESTIMATES.BASE_POST : TIMING_ESTIMATES.POST_DISABLED;
    
    // Record the estimates
    this.profiler.recordComputeTime(computeTime);
    this.profiler.recordSceneTime(sceneTime);
    this.profiler.recordBloomTime(bloomTime);
    this.profiler.recordPostProcessTime(postProcessTime);
  }

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
   * Estimate visible satellites (simplified)
   */
  private estimateVisibleSatellites(): number {
    // This is a rough estimate based on view mode
    const mode = this.camera.getViewModeIndex();
    if (mode === 0) {
      // Horizon view - roughly 10-15% visible
      return Math.floor(CONSTANTS.NUM_SATELLITES * 0.12);
    } else if (mode === 2) {
      // Fleet POV - very few visible
      return Math.floor(CONSTANTS.NUM_SATELLITES * 0.001);
    } else if (mode === 3) {
      // Ground view - can see satellites above horizon
      return Math.floor(CONSTANTS.NUM_SATELLITES * 0.15);
    } else if (mode === 4) {
      // Moon view - can see most of the near-side constellation
      return Math.floor(CONSTANTS.NUM_SATELLITES * 0.45);
    } else {
      // God view - depends on distance
      return Math.floor(CONSTANTS.NUM_SATELLITES * 0.25);
    }
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
    window.removeEventListener('resize', this.resizeListener);
    window.removeEventListener('orientationchange', this.orientationChangeListener);
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
function main(): void {
  // Show onboarding if first time
  const onboarding = new OnboardingManager();
  onboarding.showIfNew();

  const app = new GrokZephyrApp();
  app.initialize().catch(console.error);
  
  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    app.destroy();
  });
  
  // Expose for debugging
  (window as unknown as { zephyr: GrokZephyrApp }).zephyr = app;
}

// Start
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}

export default GrokZephyrApp;
