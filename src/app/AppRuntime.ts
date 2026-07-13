import type { QualityLevel, VolumetricBeamQualitySettings } from '@/core/QualityPresets.js';
import type { ExposureRuntimeSettings } from '@/core/ExposureRuntime.js';
import type { WebGPUContext } from '@/core/WebGPUContext.js';
import type { SatelliteGPUBuffer } from '@/core/SatelliteGPUBuffer.js';
import type { RenderPipeline } from '@/render/RenderPipeline.js';
import type { PostProcessStack } from '@/render/PostProcessStack.js';
import type { VolumetricBeamRenderer } from '@/render/VolumetricBeamRenderer.js';
import type { TrailRenderer } from '@/render/TrailRenderer.js';
import type { ConstellationGuides } from '@/render/ConstellationGuides.js';
import type { MoonRingGuide } from '@/render/MoonRingGuide.js';
import type { SkylineCity } from '@/render/SkylineCity.js';
import type { CameraController, CameraState } from '@/camera/CameraController.js';
import type { FocusSelection } from '@/focus.js';
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
import type { SimulationState } from '@/app/SimulationState.js';
import type { ViewModeState } from '@/app/ViewModeCoordinator.js';
import type { FrameLoopState } from '@/app/FrameLoop.js';

/**
 * Shared runtime dependencies and mutable application state accessed by
 * extracted app modules. App owns and satisfies this interface.
 */
export interface AppRuntime {
  readonly canvas: HTMLCanvasElement;
  readonly backend: RendererBackend;
  readonly isMobileDevice: boolean;
  readonly mobileDefaultQuality: QualityLevel;
  readonly demoIdleTimeoutSeconds: number;

  readonly simulation: SimulationState;
  readonly view: ViewModeState;
  readonly loop: FrameLoopState;

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

  trailSamplePhase: number;
  trailToggleOverride: boolean | null;
  trailLengthMode: 'short' | 'medium' | 'long';
  exposureSettings: ExposureRuntimeSettings;
  patternNameDisplay: HTMLElement | null;
  selectedSatelliteIndex: number;
  dataSourceLabel: string;
  lastVisibleCount: number;
  moonScaleHudEnabled: boolean;
  volumetricBeamQuality: VolumetricBeamQualitySettings | null;
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
  recordTrailSamplesForCamera(time: number, cameraState: CameraState): void;
  writeUniforms(time: number, deltaTime: number, camera?: CameraState | null): void;
  handleFocusSelectionChange(selection: FocusSelection | null): void;
  focusSatelliteAtScreenPoint(clientX: number, clientY: number): void;
  syncVolumetricBeamConfig(): void;
  getQualityLevel(): QualityLevel;
  setTimeScale(scale: number): void;
  getTimeScale(): number;
}
