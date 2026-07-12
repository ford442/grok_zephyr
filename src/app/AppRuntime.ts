import type { QualityLevel, VolumetricBeamQualitySettings } from '@/core/QualityPresets.js';
import type { ExposureRuntimeSettings } from '@/core/ExposureRuntime.js';
import type { ImageTuningSettings } from '@/core/ImageTuning.js';
import type { WebGPUContext } from '@/core/WebGPUContext.js';
import type { SatelliteGPUBuffer } from '@/core/SatelliteGPUBuffer.js';
import type { RenderPipeline } from '@/render/RenderPipeline.js';
import type { PostProcessStack } from '@/render/PostProcessStack.js';
import type { VolumetricBeamRenderer } from '@/render/VolumetricBeamRenderer.js';
import type { TrailRenderer } from '@/render/TrailRenderer.js';
import type { ConstellationGuides } from '@/render/ConstellationGuides.js';
import type { MoonRingGuide } from '@/render/MoonRingGuide.js';
import type { SkylineCity } from '@/render/SkylineCity.js';
import type { CameraController } from '@/camera/CameraController.js';
import type { GroundObserverCamera } from '@/camera/GroundObserverCamera.js';
import type { UIManager } from '@/ui/UIManager.js';
import type { PerformanceProfiler } from '@/utils/PerformanceProfiler.js';
import type { AudioEngine } from '@/audio/AudioEngine.js';
import type { FocusManager } from '@/focus.js';
import type { EarthAtmosphereRenderer } from '@/earth.js';
import type { OrbitalElements } from '@/core/OrbitalElements.js';
import type { WebGLRenderer } from '@/webgl/WebGLRenderer.js';
import type { WebGLDebugOverlay } from '@/webgl/WebGLDebug.js';
import type { RendererBackend } from '@/webgl/rendererSelection.js';
import type { CaptureManager } from '@/capture/CaptureManager.js';

/**
 * Shared runtime dependencies and mutable application state accessed by
 * extracted app modules. GrokZephyrApp owns and satisfies this interface.
 */
export interface AppRuntime {
  readonly canvas: HTMLCanvasElement;
  readonly backend: RendererBackend;
  readonly isMobileDevice: boolean;
  readonly mobileDefaultQuality: QualityLevel;
  readonly demoIdleTimeoutSeconds: number;

  context: WebGPUContext | null;
  buffers: SatelliteGPUBuffer | null;
  pipeline: RenderPipeline | null;
  postProcessStack: PostProcessStack | null;
  volumetricBeamRenderer: VolumetricBeamRenderer | null;
  camera: CameraController;
  groundObserver: GroundObserverCamera;
  ui: UIManager;
  profiler: PerformanceProfiler;
  audio: AudioEngine;
  focusManager: FocusManager | null;
  trailRenderer: TrailRenderer | null;
  constellationGuides: ConstellationGuides | null;
  moonRingGuide: MoonRingGuide | null;
  earthAtmosphereRenderer: EarthAtmosphereRenderer | null;
  skyline: SkylineCity;
  webglRenderer: WebGLRenderer | null;
  webglOrbital: OrbitalElements | null;
  webglDebugOverlay: WebGLDebugOverlay | null;
  captureManager: CaptureManager | null;

  earthVertexBuffer: GPUBuffer | null;
  earthIndexBuffer: GPUBuffer | null;
  earthIndexCount: number;

  animationId: number;
  isRunning: boolean;
  lastTime: number;
  trailSamplePhase: number;
  trailToggleOverride: boolean | null;
  trailLengthMode: 'short' | 'medium' | 'long';
  exposureSettings: ExposureRuntimeSettings;
  imageTuning: ImageTuningSettings;
  imageTuningManualOverride: boolean;
  animationMasterIntensity: number;
  patternSeed: number;
  patternAnimationStart: number;
  patternNameDisplay: HTMLElement | null;
  selectedSatelliteIndex: number;
  dataSourceLabel: string;
  lastVisibleCount: number;
  moonScaleHudEnabled: boolean;
  currentPatternMode: number;
  volumetricBeamQuality: VolumetricBeamQualitySettings | null;
  currentAnimationPattern: number;
  currentPhysicsMode: number;
  currentQualityLevel: QualityLevel;
  qualityAtmosphereHaze: number;
  qualityAtmosphereScatteringEnabled: boolean;
  baseViewBloomIntensity: number;
  horizonLensActive: boolean;
  fleetLensActive: boolean;
  taaEnabled: boolean;
  timeScale: number;
  simTime: number;
  demoAutoEnabled: boolean;
  lastUserActivityTime: number;
  orientationLockAttempted: boolean;

  handleResize(): void;
  getDrawableSize(): { width: number; height: number } | null;
  setPatternMode(mode: number): void;
  setAnimationPattern(mode: number): void;
  setPhysicsMode(mode: number): void;
  applyQualityPreset(level: QualityLevel): void;
  applyExposureSettings(): void;
  applyViewTuning(time: number): void;
  applyGroundPresetEffects(deltaTime: number): void;
  applyGroundOverlayClass(overlayClass: string): void;
  updateGroundObserverOverlay(): void;
  registerUserActivity(interruptCinematic: boolean): void;
  updateMobileViewportPresentation(): void;
  setupMobileOrientationSupport(): void;
  writePatternParamsBuffer(): void;
  recordTrailSamplesForCamera(time: number, cameraState: import('@/camera/CameraController.js').CameraState): void;
  writeUniforms(time: number, deltaTime: number, camera?: import('@/camera/CameraController.js').CameraState | null): void;
  handleFocusSelectionChange(selection: import('@/focus.js').FocusSelection | null): void;
  focusSatelliteAtScreenPoint(clientX: number, clientY: number): void;
  syncVolumetricBeamConfig(): void;
}
