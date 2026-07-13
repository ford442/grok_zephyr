/**
 * Grok Zephyr - Camera Controller
 *
 * Manages camera poses for different view modes with smooth transitions
 * and mouse controls for God view.
 */

import type { Vec3, ViewMode } from '@/types/index.js';
import { CAMERA, MATH, VIEW_MODES } from '@/types/constants.js';
import { HORIZON_FRAMING } from '@/camera/HorizonLimb.js';
import { GOD_FRAMING } from '@/camera/GodFraming.js';
import { mat4lookAt, mat4persp } from '@/utils/math.js';
import { blendCameraState, getTransitionDuration, smoothstep } from './cameraBlend.js';
import { CameraCinematic } from './CameraCinematic.js';
import { CameraInput, type CameraInputDelegate } from './CameraInput.js';
import { CameraPan } from './CameraPan.js';
import type {
  CameraAngles,
  CameraState,
  FleetPOVState,
  FocusTransition,
  GodViewParams,
  ModeTransition,
} from './cameraTypes.js';
import {
  calculateFleetPOV,
  calculateFocusedView,
  calculateGodView,
  calculateGroundView,
  calculateHorizonView,
  calculateMoonView,
  calculateSkylineView,
} from './viewPoses.js';

export type { CameraState, GodViewParams, CameraAngles, MouseState } from './cameraTypes.js';

export class CameraController implements CameraInputDelegate {
  private currentMode: ViewMode = 'horizon-720';
  private modeIndex = 0;

  private godView: GodViewParams = {
    yaw: GOD_FRAMING.HERO_YAW_DEG * MATH.DEG_TO_RAD,
    pitch: GOD_FRAMING.HERO_PITCH_DEG * MATH.DEG_TO_RAD,
    distance: GOD_FRAMING.HERO_DISTANCE_KM,
  };

  private cameraAngles: CameraAngles = {
    yaw: 0,
    pitch: 0,
    distance: 25000,
  };

  private readonly PITCH_LIMIT = 89;
  private readonly FLEET_MOVE_SPEED = 0.08;
  private readonly FLEET_FAST_MULTIPLIER = 3.0;
  private readonly FLEET_SLOW_MULTIPLIER = 0.25;
  private readonly GOD_INERTIA_DAMPING = 0.88;

  private fleetState: FleetPOVState = {
    fleetOffset: [0, 0, 0],
    fleetRoll: 0,
    fleetTouchRoll: 0,
    lastFleetYaw: 0,
    fleetIdleTime: 0,
    lastFleetTime: 0,
  };

  private godVelocity: { yaw: number; pitch: number } = { yaw: 0, pitch: 0 };

  private focusSatelliteIndex: number | null = null;
  private focusDistance = 70000;
  private focusTransition: FocusTransition | null = null;
  private orbitLockActive = false;
  private orbitLockSpeed = 8;

  private modeChangeCallback: ((mode: ViewMode, name: string, altitude: string) => void) | null =
    null;
  private angleChangeCallback: ((yaw: number, pitch: number) => void) | null = null;
  private userInteractionCallback: (() => void) | null = null;
  private touchDoubleTapCallback: ((x: number, y: number) => void) | null = null;

  private lastVisualState: CameraState | null = null;
  private modeTransition: ModeTransition | null = null;

  private horizonDriftYawDeg = 0;
  private horizonInteractionUntil = 0;

  private godIdleYawDeg = 0;
  private godInteractionUntil = 0;
  private godIdleOrbitEnabled = true;

  private readonly input: CameraInput;
  private readonly pan = new CameraPan();
  private readonly cinematic = new CameraCinematic();

  constructor() {
    this.input = new CameraInput(this);
  }

  // --- CameraInputDelegate ---

  getCurrentMode(): ViewMode {
    return this.currentMode;
  }

  getPitchLimit(): number {
    return this.PITCH_LIMIT;
  }

  hasFocus(): boolean {
    return this.focusSatelliteIndex !== null;
  }

  getMutableCameraAngles(): CameraAngles {
    return this.cameraAngles;
  }

  getGodView(): GodViewParams {
    return this.godView;
  }

  getGodVelocity(): { yaw: number; pitch: number } {
    return this.godVelocity;
  }

  getFleetTouchRoll(): number {
    return this.fleetState.fleetTouchRoll;
  }

  setFleetTouchRoll(value: number): void {
    this.fleetState.fleetTouchRoll = value;
  }

  handleUserInteraction(): void {
    if (this.currentMode === 'horizon-720') {
      this.horizonInteractionUntil = performance.now() * 0.001 + HORIZON_FRAMING.DRIFT_IDLE_SEC;
    }
    if (this.currentMode === 'god') {
      this.godInteractionUntil = performance.now() * 0.001 + GOD_FRAMING.IDLE_PAUSE_SEC;
    }
    this.userInteractionCallback?.();
    if (this.cinematic.isActive()) {
      this.stopCinematic();
    }
  }

  panBy(dx: number, dy: number): void {
    this.pan.panBy(dx, dy, this.currentMode, this.cameraAngles);
  }

  resetCameraAngle(): void {
    if (this.currentMode === 'god') {
      this.applyGodHeroPose();
      this.modeTransition = null;
      console.log('🔄 God View — hero pose');
      return;
    }

    this.cameraAngles.yaw = 0;
    this.cameraAngles.pitch = 0;
    this.cameraAngles.distance = 25000;

    this.pan.reset();
    this.godView.yaw = GOD_FRAMING.HERO_YAW_DEG * MATH.DEG_TO_RAD;
    this.godView.pitch = GOD_FRAMING.HERO_PITCH_DEG * MATH.DEG_TO_RAD;
    this.godView.distance = CAMERA.GOD_VIEW_DISTANCE;
    this.fleetState.fleetRoll = 0;
    this.fleetState.fleetTouchRoll = 0;
    this.godVelocity.yaw = 0;
    this.godVelocity.pitch = 0;
    this.modeTransition = null;

    console.log('🔄 Camera angle reset');
    this.angleChangeCallback?.(0, 0);
  }

  toggleOrbitLock(): void {
    if (this.focusSatelliteIndex === null) return;
    this.orbitLockActive = !this.orbitLockActive;
  }

  notifyAngleChange(yaw: number, pitch: number): void {
    this.angleChangeCallback?.(yaw, pitch);
  }

  handleTouchDoubleTap(x: number, y: number): void {
    if (this.touchDoubleTapCallback) {
      this.touchDoubleTapCallback(x, y);
    } else {
      this.resetCameraAngle();
    }
  }

  syncGodViewFromAngles(): void {
    this.godView.yaw = this.cameraAngles.yaw * MATH.DEG_TO_RAD;
    this.godView.pitch = this.cameraAngles.pitch * MATH.DEG_TO_RAD;
  }

  seedGodVelocity(yaw: number, pitch: number): void {
    this.godVelocity.yaw = yaw;
    this.godVelocity.pitch = pitch;
  }

  applyZoomSteps(steps: number): void {
    const zoomFactor = Math.pow(1.08, steps);
    this.cameraAngles.distance = Math.max(
      500,
      Math.min(180000, this.cameraAngles.distance * zoomFactor),
    );
    if (this.currentMode === 'god') {
      this.godView.distance = this.cameraAngles.distance;
    }
  }

  // --- Public API ---

  attachToCanvas(canvas: HTMLCanvasElement): void {
    this.input.attachToCanvas(canvas);
  }

  update(deltaTime: number): void {
    this.applyGodInertia(deltaTime);
    this.pan.applyKeyboardPanning(deltaTime, this.input.keys, this.currentMode, this.cameraAngles);
    if (this.orbitLockActive && this.focusSatelliteIndex !== null) {
      this.cameraAngles.yaw += this.orbitLockSpeed * deltaTime;
      this.cameraAngles.yaw = ((this.cameraAngles.yaw % 360) + 360) % 360;
    }
  }

  private applyGodInertia(deltaTime: number): void {
    if (this.currentMode !== 'god' || this.input.isMouseDown()) return;

    const minV = 0.0005;
    if (Math.abs(this.godVelocity.yaw) < minV && Math.abs(this.godVelocity.pitch) < minV) return;

    const frames = deltaTime * 60;

    this.cameraAngles.yaw -= this.godVelocity.yaw * frames;
    this.cameraAngles.yaw = ((this.cameraAngles.yaw % 360) + 360) % 360;
    this.cameraAngles.pitch += this.godVelocity.pitch * frames;
    this.cameraAngles.pitch = Math.max(
      -this.PITCH_LIMIT,
      Math.min(this.PITCH_LIMIT, this.cameraAngles.pitch),
    );

    this.syncGodViewFromAngles();

    const decay = Math.pow(this.GOD_INERTIA_DAMPING, frames);
    this.godVelocity.yaw *= decay;
    this.godVelocity.pitch *= decay;

    if (Math.abs(this.godVelocity.yaw) < minV) this.godVelocity.yaw = 0;
    if (Math.abs(this.godVelocity.pitch) < minV) this.godVelocity.pitch = 0;
  }

  setPanSensitivity(value: number): void {
    this.pan.setPanSensitivity(value);
  }

  setViewMode(index: number, time: number = performance.now() / 1000): void {
    if (this.cinematic.isActive()) {
      this.stopCinematic();
    }

    const fromIndex = this.modeIndex;
    const fromMode = this.currentMode;
    this.modeIndex = index;
    this.fleetState.fleetOffset = [0, 0, 0];

    switch (index) {
      case 0:
        this.currentMode = 'horizon-720';
        break;
      case 1:
        this.currentMode = 'god';
        this.applyGodHeroPose();
        break;
      case 2:
        this.currentMode = 'sat-pov';
        this.cameraAngles.pitch = -20;
        this.cameraAngles.yaw = 0;
        break;
      case 3:
        this.currentMode = 'ground';
        this.cameraAngles.pitch = 18;
        this.cameraAngles.yaw = 0;
        break;
      case 4:
        this.currentMode = 'moon';
        break;
      case 5:
        this.currentMode = 'skyline';
        this.cameraAngles.pitch = 0;
        this.cameraAngles.yaw = 0;
        break;
      default:
        this.currentMode = 'horizon-720';
    }

    if (this.lastVisualState && fromMode !== this.currentMode) {
      this.modeTransition = {
        from: this.lastVisualState,
        startTime: time,
        duration: getTransitionDuration(fromMode, this.currentMode),
        fromModeIndex: fromIndex,
        toModeIndex: index,
      };
    }

    const config = VIEW_MODES[index] || VIEW_MODES[0];
    this.modeChangeCallback?.(this.currentMode, config.name, config.altitude);

    if (this.currentMode === 'sat-pov' && this.angleChangeCallback) {
      this.angleChangeCallback(this.cameraAngles.yaw, this.cameraAngles.pitch);
    }
  }

  getViewTuningBlend(time: number): { fromIndex: number; toIndex: number; t: number } {
    if (this.modeTransition) {
      const elapsed = Math.max(0, time - this.modeTransition.startTime);
      const tLinear = Math.min(1, elapsed / this.modeTransition.duration);
      return {
        fromIndex: this.modeTransition.fromModeIndex,
        toIndex: this.modeTransition.toModeIndex,
        t: smoothstep(tLinear),
      };
    }
    const idx = this.modeIndex;
    return { fromIndex: idx, toIndex: idx, t: 1 };
  }

  getViewMode(): ViewMode {
    return this.currentMode;
  }

  getViewModeIndex(): number {
    return this.modeIndex;
  }

  setFocusSatellite(
    index: number,
    distance: number,
    time: number = performance.now() / 1000,
  ): void {
    if (this.focusSatelliteIndex === index) return;
    this.focusSatelliteIndex = index;
    this.focusDistance = distance;
    this.focusTransition = {
      startTime: time,
      duration: 1.4,
      fromDistance: this.cameraAngles.distance,
    };
  }

  isOrbitLocked(): boolean {
    return this.orbitLockActive;
  }

  setOrbitLockSpeed(degreesPerSecond: number): void {
    this.orbitLockSpeed = degreesPerSecond;
  }

  clearFocus(): void {
    this.focusSatelliteIndex = null;
    this.focusTransition = null;
    this.orbitLockActive = false;
  }

  getFocusSatelliteIndex(): number | null {
    return this.focusSatelliteIndex;
  }

  calculateCamera(
    satellitePosition: (index: number, time: number) => Vec3,
    satelliteVelocity: (index: number, time: number) => Vec3,
    time: number,
  ): CameraState {
    const manualState = this.pan.applyPanOffset(
      this.calculateManualCamera(satellitePosition, satelliteVelocity, time),
      this.currentMode,
      this.cameraAngles,
    );

    if (this.cinematic.isActive()) {
      const cinematic = this.cinematic.calculateCamera(satellitePosition, satelliteVelocity, time);
      this.lastVisualState = cinematic;
      return cinematic;
    }

    const cinematicBlendOut = this.cinematic.getBlendOut();
    if (cinematicBlendOut) {
      const elapsed = Math.max(0, time - cinematicBlendOut.startTime);
      const tLinear = Math.min(1, elapsed / cinematicBlendOut.duration);
      const t = smoothstep(tLinear);
      const blended = blendCameraState(cinematicBlendOut.from, manualState, t);
      if (tLinear >= 1) {
        this.cinematic.setBlendOut(null);
      }
      this.lastVisualState = blended;
      return blended;
    }

    if (this.modeTransition) {
      const elapsed = Math.max(0, time - this.modeTransition.startTime);
      const tLinear = Math.min(1, elapsed / this.modeTransition.duration);
      const t = smoothstep(tLinear);
      const blended = blendCameraState(this.modeTransition.from, manualState, t);
      if (tLinear >= 1) {
        this.modeTransition = null;
      }
      this.lastVisualState = blended;
      return blended;
    }

    this.lastVisualState = manualState;
    return manualState;
  }

  private calculateManualCamera(
    satellitePosition: (index: number, time: number) => Vec3,
    satelliteVelocity: (index: number, time: number) => Vec3,
    time: number,
  ): CameraState {
    if (this.focusSatelliteIndex !== null) {
      const result = calculateFocusedView(
        satellitePosition,
        time,
        this.focusSatelliteIndex,
        this.focusDistance,
        this.focusTransition,
        this.cameraAngles,
      );
      this.cameraAngles = result.cameraAngles;
      this.focusTransition = result.focusTransition;
      return result.camera;
    }

    switch (this.currentMode) {
      case 'horizon-720':
        return calculateHorizonView(this.cameraAngles, this.horizonDriftYawDeg);
      case 'god':
        return calculateGodView(this.cameraAngles, this.godIdleYawDeg);
      case 'sat-pov': {
        const result = calculateFleetPOV(
          satellitePosition,
          satelliteVelocity,
          time,
          this.cameraAngles,
          this.fleetState,
          this.input.keys,
          {
            moveSpeed: this.FLEET_MOVE_SPEED,
            fastMultiplier: this.FLEET_FAST_MULTIPLIER,
            slowMultiplier: this.FLEET_SLOW_MULTIPLIER,
          },
        );
        this.fleetState = result.state;
        return result.camera;
      }
      case 'ground':
        return calculateGroundView(this.cameraAngles);
      case 'moon':
        return calculateMoonView(this.cameraAngles);
      case 'skyline':
        return calculateSkylineView(this.cameraAngles);
      default:
        return calculateHorizonView(this.cameraAngles, this.horizonDriftYawDeg);
    }
  }

  updateHorizonDrift(time: number, deltaTime: number): void {
    if (this.currentMode !== 'horizon-720') return;
    if (this.input.isMouseDown() || time < this.horizonInteractionUntil) return;
    this.horizonDriftYawDeg += HORIZON_FRAMING.DRIFT_YAW_DEG_PER_SEC * deltaTime;
  }

  updateGodIdleOrbit(time: number, deltaTime: number): void {
    if (this.currentMode !== 'god' || !this.godIdleOrbitEnabled) return;
    if (this.input.isMouseDown() || time < this.godInteractionUntil) return;
    this.godIdleYawDeg += GOD_FRAMING.IDLE_YAW_DEG_PER_SEC * deltaTime;
  }

  setGodIdleOrbitEnabled(enabled: boolean): void {
    this.godIdleOrbitEnabled = enabled;
    if (!enabled) this.godIdleYawDeg = 0;
  }

  isGodIdleOrbitEnabled(): boolean {
    return this.godIdleOrbitEnabled;
  }

  applyGodHeroPose(): void {
    this.cameraAngles.yaw = GOD_FRAMING.HERO_YAW_DEG;
    this.cameraAngles.pitch = GOD_FRAMING.HERO_PITCH_DEG;
    this.cameraAngles.distance = GOD_FRAMING.HERO_DISTANCE_KM;
    this.godView.yaw = GOD_FRAMING.HERO_YAW_DEG * MATH.DEG_TO_RAD;
    this.godView.pitch = GOD_FRAMING.HERO_PITCH_DEG * MATH.DEG_TO_RAD;
    this.godView.distance = GOD_FRAMING.HERO_DISTANCE_KM;
    this.godIdleYawDeg = 0;
    this.godVelocity.yaw = 0;
    this.godVelocity.pitch = 0;
    this.pan.reset();
    this.angleChangeCallback?.(this.cameraAngles.yaw, this.cameraAngles.pitch);
  }

  startCinematic(time: number = performance.now() / 1000): void {
    this.cinematic.start(time);
  }

  stopCinematic(time: number = performance.now() / 1000): void {
    this.cinematic.stop(time);
  }

  isCinematicActive(): boolean {
    return this.cinematic.isActive();
  }

  buildViewProjection(
    camera: CameraState,
    aspect: number,
  ): {
    view: Float32Array;
    projection: Float32Array;
    viewProjection: Float32Array;
  } {
    const view = mat4lookAt(camera.position, camera.target, camera.up);
    const projection = mat4persp(camera.fov, aspect, camera.near, camera.far);

    const viewProjection = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          sum += projection[r + k * 4] * view[k + c * 4];
        }
        viewProjection[r + c * 4] = sum;
      }
    }

    return { view, projection, viewProjection };
  }

  getCameraAxes(viewMatrix: Float32Array): { right: Vec3; up: Vec3 } {
    return {
      right: [viewMatrix[0], viewMatrix[4], viewMatrix[8]],
      up: [viewMatrix[1], viewMatrix[5], viewMatrix[9]],
    };
  }

  onModeChange(callback: (mode: ViewMode, name: string, altitude: string) => void): void {
    this.modeChangeCallback = callback;
  }

  onAngleChange(callback: (yaw: number, pitch: number) => void): void {
    this.angleChangeCallback = callback;
  }

  onCinematicChange(callback: (active: boolean) => void): void {
    this.cinematic.onCinematicChange(callback);
  }

  onUserInteraction(callback: () => void): void {
    this.userInteractionCallback = callback;
  }

  onTouchDoubleTap(callback: (x: number, y: number) => void): void {
    this.touchDoubleTapCallback = callback;
  }

  getCameraAngles(): CameraAngles {
    return { ...this.cameraAngles };
  }

  resetGodView(): void {
    this.applyGodHeroPose();
  }

  getFleetDriftOffset(): Readonly<Vec3> {
    return this.fleetState.fleetOffset;
  }

  getViewModes(): typeof VIEW_MODES {
    return VIEW_MODES;
  }
}
