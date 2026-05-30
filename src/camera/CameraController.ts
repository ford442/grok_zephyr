/**
 * Grok Zephyr - Camera Controller
 * 
 * Manages camera poses for different view modes:
 * - 720km Horizon View
 * - God View (orbiting free camera)
 * - Fleet POV (first-person satellite view)
 * - Surface View (ground perspective)
 */

import type { Vec3, ViewMode } from '@/types/index.js';
import { CONSTANTS, CAMERA, MATH, VIEW_MODES } from '@/types/constants.js';
import { v3add, v3scale, v3norm, v3sub, v3cross, v3dot, mat4lookAt, mat4persp } from '@/utils/math.js';

/** Camera state for each view mode */
export interface CameraState {
  position: Vec3;
  target: Vec3;
  up: Vec3;
  fov: number;
  near: number;
  far: number;
}

/** God view orbit parameters */
export interface GodViewParams {
  yaw: number;
  pitch: number;
  distance: number;
}

/** Camera angle state for all modes */
export interface CameraAngles {
  yaw: number;      // degrees, left/right
  pitch: number;    // degrees, up/down  
  distance: number; // km, for zoom
}

/** Mouse input state */
export interface MouseState {
  down: boolean;
  lastX: number;
  lastY: number;
}

type CinematicPathId = 'horizon-drift' | 'god-spiral' | 'fleet-fly';

interface CinematicStep {
  id: CinematicPathId;
  duration: number;
}

/**
 * Camera Controller
 * 
 * Handles camera positioning for all view modes with smooth transitions
 * and mouse controls for God view.
 */
export class CameraController {
  private currentMode: ViewMode = 'horizon-720';
  private modeIndex = 0;
  
  // God view state
  private godView: GodViewParams = {
    yaw: 0,
    pitch: 0.35,
    distance: CAMERA.GOD_VIEW_DISTANCE,
  };
  
  // Camera angles for ALL modes (yaw/pitch in degrees)
  private cameraAngles: CameraAngles = {
    yaw: 0,
    pitch: 0,
    distance: 25000, // km
  };
  
  // Constants
  private readonly PITCH_LIMIT = 89;
  private readonly MOUSE_SENSITIVITY = 0.25;
  
  // Mouse state
  private mouse: MouseState = {
    down: false,
    lastX: 0,
    lastY: 0,
  };
  
  // Canvas reference for pointer lock
  private canvas: HTMLCanvasElement | null = null;
  
  // Fleet POV micro-movement speed (km per frame)
  private readonly FLEET_MOVE_SPEED = 0.08;
  private readonly FLEET_FAST_MULTIPLIER = 3.0;
  private readonly FLEET_SLOW_MULTIPLIER = 0.25;
  
  // Keyboard state for Fleet POV movement
  private keys: Record<string, boolean> = {};
  
  // Fleet POV local offset (for WASD micro-movement)
  private fleetOffset: Vec3 = [0, 0, 0];

  // Fleet POV roll state (induced by yaw rate)
  private fleetRoll = 0;
  private lastFleetYaw = 0;

  // Fleet POV orbital breathing (gentle idle sway)
  private fleetIdleTime = 0;
  private lastFleetTime = 0;
  
  // Camera panning state
  private panOffset: Vec3 = [0, 0, 0];
  private mouseMode: 'rotate' | 'pan' | null = null;
  private panSensitivity = 1.0;

  // Focus orbit state
  private focusSatelliteIndex: number | null = null;
  private focusDistance = 70000;
  private focusTransition: { startTime: number; duration: number; fromDistance: number } | null = null;

  // Orbit Lock: auto-orbit around focused satellite
  private orbitLockActive = false;
  private orbitLockSpeed = 8; // degrees per second
  
  // Callbacks
  private modeChangeCallback: ((mode: ViewMode, name: string, altitude: string) => void) | null = null;
  private angleChangeCallback: ((yaw: number, pitch: number) => void) | null = null;
  private cinematicChangeCallback: ((active: boolean) => void) | null = null;
  private userInteractionCallback: (() => void) | null = null;

  private readonly cinematicSteps: CinematicStep[] = [
    { id: 'horizon-drift', duration: 52 },
    { id: 'god-spiral', duration: 44 },
    { id: 'fleet-fly', duration: 36 },
  ];
  private cinematicActive = false;
  private cinematicStepIndex = 0;
  private cinematicStepStartTime = 0;
  private lastCinematicState: CameraState | null = null;
  private readonly cinematicBlendOutDuration = 0.45;
  private readonly fleetFlySatelliteSwitchSeconds = 9;
  private readonly fleetFlySamplePrime = 7919;
  private readonly constellationCenterSampleIndices = [0, 8191, 65535, 131071, 262143, 524287, 786431, 1048575];
  private cinematicBlendOut: { startTime: number; duration: number; from: CameraState } | null = null;

  // God View inertia: velocity accumulated from drag deltas, decays after release
  private godVelocity: { yaw: number; pitch: number } = { yaw: 0, pitch: 0 };
  private readonly GOD_INERTIA_DAMPING = 0.88; // per-frame decay factor (~60 fps baseline)

  // Smooth mode-switch transitions: blend from the last visual pose to the new one
  private lastVisualState: CameraState | null = null;
  private modeTransition: { from: CameraState; startTime: number; duration: number } | null = null;

  constructor() {
    // Event listeners are attached lazily via attachToCanvas()
  }

  /**
   * Attach to canvas for mouse input
   * Enhanced: All camera modes support pitch/yaw drag + zoom
   */
  attachToCanvas(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    
    // Mouse down - start dragging
    canvas.addEventListener('mousedown', (e) => {
      this.handleUserInteraction();
      if (e.button === 0 && !e.altKey) {
        this.mouseMode = 'rotate';
      } else if (e.button === 2 || e.button === 1 || (e.button === 0 && e.altKey)) {
        this.mouseMode = 'pan';
      } else {
        return;
      }

      this.mouse.down = true;
      this.mouse.lastX = e.clientX;
      this.mouse.lastY = e.clientY;
      canvas.style.cursor = 'grabbing';
    });

    // Mouse up - stop dragging
    window.addEventListener('mouseup', () => {
      this.mouse.down = false;
      this.mouseMode = null;
      if (this.canvas) {
        this.canvas.style.cursor = 'grab';
      }
    });

    // Prevent right-click menu while panning
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    // Mouse move - update angles or pan depending on button
    window.addEventListener('mousemove', (e) => {
      if (!this.mouse.down || !this.mouseMode) return;
      
      const dx = e.movementX || (e.clientX - this.mouse.lastX);
      const dy = e.movementY || (e.clientY - this.mouse.lastY);

      if (this.mouseMode === 'rotate') {
        this.cameraAngles.yaw -= dx * this.MOUSE_SENSITIVITY;
        this.cameraAngles.yaw = ((this.cameraAngles.yaw % 360) + 360) % 360;

        this.cameraAngles.pitch += dy * this.MOUSE_SENSITIVITY;
        const pitchLimit = this.currentMode === 'sat-pov' ? 89 : this.PITCH_LIMIT;
        this.cameraAngles.pitch = Math.max(
          -pitchLimit,
          Math.min(pitchLimit, this.cameraAngles.pitch)
        );

        if (this.currentMode === 'god') {
          this.godView.yaw = this.cameraAngles.yaw * Math.PI / 180;
          this.godView.pitch = this.cameraAngles.pitch * Math.PI / 180;
          // Record the most-recent drag delta as the post-release inertia seed
          this.godVelocity.yaw = dx * this.MOUSE_SENSITIVITY;
          this.godVelocity.pitch = dy * this.MOUSE_SENSITIVITY;
        }

        if (this.angleChangeCallback) {
          this.angleChangeCallback(this.cameraAngles.yaw, this.cameraAngles.pitch);
        }
      } else {
        this.panBy(-dx, dy);
      }
      
      this.mouse.lastX = e.clientX;
      this.mouse.lastY = e.clientY;
    });

    // Wheel - zoom distance (works in all modes)
    // God View uses exponential curve for comfortable close/far zoom
    canvas.addEventListener('wheel', (e) => {
      this.handleUserInteraction();
      e.preventDefault();
      if (this.currentMode === 'god' || this.focusSatelliteIndex !== null) {
        // Exponential zoom: multiply distance by a factor per scroll tick
        const zoomFactor = 1 + Math.sign(e.deltaY) * 0.08;
        this.cameraAngles.distance = Math.max(
          500,
          Math.min(180000, this.cameraAngles.distance * zoomFactor)
        );
      } else {
        const zoomSpeed = 40;
        this.cameraAngles.distance = Math.max(
          500,
          Math.min(180000, this.cameraAngles.distance + e.deltaY * zoomSpeed)
        );
      }
      
      // Also update godView distance
      if (this.currentMode === 'god') {
        this.godView.distance = this.cameraAngles.distance;
      }
    });
    
    // Double-click to reset
    canvas.addEventListener('dblclick', () => {
      this.resetCameraAngle();
    });
    
    // Set initial cursor
    canvas.style.cursor = 'grab';
    
    // Keyboard input for Fleet POV micro-movement and hotkeys
    window.addEventListener('keydown', (e) => {
      this.handleUserInteraction();
      this.keys[e.key.toLowerCase()] = true;
      // 'O' hotkey toggles orbit lock on focused satellite
      if (e.key.toLowerCase() === 'o') {
        this.toggleOrbitLock();
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false;
    });
  }
  
  /**
   * Reset camera angle to default
   */
  resetCameraAngle(): void {
    this.cameraAngles.yaw = 0;
    this.cameraAngles.pitch = 0;
    this.cameraAngles.distance = 25000;

    this.panOffset = [0, 0, 0];
    this.godView.yaw = 0;
    this.godView.pitch = 0.35;
    this.godView.distance = CAMERA.GOD_VIEW_DISTANCE;

    // Clear inertia and any active transition so the reset is crisp
    this.godVelocity.yaw = 0;
    this.godVelocity.pitch = 0;
    this.modeTransition = null;

    console.log('🔄 Camera angle reset');

    if (this.angleChangeCallback) {
      this.angleChangeCallback(0, 0);
    }
  }

  update(deltaTime: number): void {
    this.applyGodInertia(deltaTime);
    this.applyKeyboardPanning(deltaTime);
    // Orbit Lock: slowly orbit the focused satellite
    if (this.orbitLockActive && this.focusSatelliteIndex !== null) {
      this.cameraAngles.yaw += this.orbitLockSpeed * deltaTime;
      this.cameraAngles.yaw = ((this.cameraAngles.yaw % 360) + 360) % 360;
    }
  }

  /**
   * Apply post-drag inertia to God View yaw/pitch with exponential decay.
   * Only active after the mouse button is released.
   */
  private applyGodInertia(deltaTime: number): void {
    if (this.currentMode !== 'god' || this.mouse.down) return;

    // Stop applying below this threshold to avoid floating-point drift
    const minV = 0.0005; // degrees per 60-fps frame equivalent
    if (Math.abs(this.godVelocity.yaw) < minV && Math.abs(this.godVelocity.pitch) < minV) return;

    // `frames` normalises velocity (stored as degrees/reference-frame) to actual elapsed time.
    // The GOD_INERTIA_DAMPING constant was tuned at 60 fps; Math.pow makes decay frame-rate independent.
    const frames = deltaTime * 60; // reference frame rate: 60 fps

    // Signs mirror the drag handler: yaw decreases with rightward dx, pitch increases with downward dy.
    this.cameraAngles.yaw -= this.godVelocity.yaw * frames;
    this.cameraAngles.yaw = ((this.cameraAngles.yaw % 360) + 360) % 360;

    this.cameraAngles.pitch += this.godVelocity.pitch * frames;
    this.cameraAngles.pitch = Math.max(-this.PITCH_LIMIT, Math.min(this.PITCH_LIMIT, this.cameraAngles.pitch));

    this.godView.yaw = this.cameraAngles.yaw * MATH.DEG_TO_RAD;
    this.godView.pitch = this.cameraAngles.pitch * MATH.DEG_TO_RAD;

    // Exponential decay (frame-rate independent)
    const decay = Math.pow(this.GOD_INERTIA_DAMPING, frames);
    this.godVelocity.yaw *= decay;
    this.godVelocity.pitch *= decay;

    if (Math.abs(this.godVelocity.yaw) < minV) this.godVelocity.yaw = 0;
    if (Math.abs(this.godVelocity.pitch) < minV) this.godVelocity.pitch = 0;
  }

  setPanSensitivity(value: number): void {
    this.panSensitivity = Math.max(0.2, Math.min(4.0, value));
  }

  private applyKeyboardPanning(deltaTime: number): void {
    // Skip Shift+WASD panning in Fleet POV (Shift is speed modifier there)
    const right = (this.keys['arrowright'] ? 1 : 0) - (this.keys['arrowleft'] ? 1 : 0);
    const up = (this.keys['arrowup'] ? 1 : 0) - (this.keys['arrowdown'] ? 1 : 0);
    const useShiftPan = this.keys['shift'] && this.currentMode !== 'sat-pov';
    const shiftRight = useShiftPan ? ((this.keys['d'] ? 1 : 0) - (this.keys['a'] ? 1 : 0)) : 0;
    const shiftUp = useShiftPan ? ((this.keys['w'] ? 1 : 0) - (this.keys['s'] ? 1 : 0)) : 0;

    const panX = right + shiftRight;
    const panY = up + shiftUp;

    if (panX !== 0 || panY !== 0) {
      const keyboardScale = 180 * deltaTime;
      this.panBy(panX * keyboardScale, panY * keyboardScale);
    }
  }

  private panBy(dx: number, dy: number): void {
    const basis = this.getPanBasis();
    const distance = Math.max(500, this.cameraAngles.distance);
    const scale = this.panSensitivity * Math.max(0.000005, distance * 0.000009);

    const worldOffset = v3add(
      v3scale(basis.right, dx * scale),
      v3scale(basis.up, dy * scale)
    );

    this.panOffset = v3add(this.panOffset, worldOffset);
  }

  private getPanBasis(): { right: Vec3; up: Vec3 } {
    const yaw = this.cameraAngles.yaw * MATH.DEG_TO_RAD;
    const pitch = this.cameraAngles.pitch * MATH.DEG_TO_RAD;
    const forward: Vec3 = [
      Math.cos(pitch) * Math.cos(yaw),
      Math.cos(pitch) * Math.sin(yaw),
      Math.sin(pitch),
    ];

    const worldUp: Vec3 = this.currentMode === 'ground'
      ? [Math.cos(yaw), Math.sin(yaw), 0]
      : [0, 0, 1];

    let right = v3norm(v3cross(forward, worldUp));
    if (Math.abs(right[0]) + Math.abs(right[1]) + Math.abs(right[2]) < 1e-4) {
      right = [1, 0, 0];
    }
    const up = v3norm(v3cross(right, forward));
    return { right, up };
  }

  private applyPanOffset(camera: CameraState): CameraState {
    if (this.panOffset[0] === 0 && this.panOffset[1] === 0 && this.panOffset[2] === 0) {
      return camera;
    }

    if (this.currentMode === 'ground') {
      const surfaceRadius = CONSTANTS.EARTH_RADIUS_KM + 0.1;
      const pannedPosition = v3add(camera.position, this.panOffset);
      const newPosition = v3scale(v3norm(pannedPosition), surfaceRadius);

      const yaw = this.cameraAngles.yaw * MATH.DEG_TO_RAD;
      const pitch = this.cameraAngles.pitch * MATH.DEG_TO_RAD;
      const lookPitch = -pitch;
      const cosP = Math.cos(lookPitch);
      const sinP = Math.sin(lookPitch);

      const newTarget: Vec3 = [
        newPosition[0] + Math.cos(yaw) * cosP * 10000,
        newPosition[1] + Math.sin(yaw) * cosP * 10000,
        newPosition[2] + sinP * 10000,
      ];

      return {
        ...camera,
        position: newPosition,
        target: newTarget,
        up: v3norm(newPosition),
      };
    }

    return {
      ...camera,
      position: v3add(camera.position, this.panOffset),
      target: v3add(camera.target, this.panOffset),
    };
  }

  setViewMode(index: number, time: number = performance.now() / 1000): void {
    if (this.cinematicActive) {
      this.stopCinematic();
    }

    const fromMode = this.currentMode;
    this.modeIndex = index;
    
    // Reset fleet offset when switching modes
    this.fleetOffset = [0, 0, 0];
    
    switch (index) {
      case 0:
        this.currentMode = 'horizon-720';
        break;
      case 1:
        this.currentMode = 'god';
        break;
      case 2:
        this.currentMode = 'sat-pov';
        // Relaxed downward pitch to pair with the higher altitude
        this.cameraAngles.pitch = -20; 
        this.cameraAngles.yaw = 0;
        break;
      case 3:
        this.currentMode = 'ground';
        this.cameraAngles.pitch = 18; // look slightly above the horizon for an immersive surface feel
        this.cameraAngles.yaw = 0;
        break;
      case 4:
        this.currentMode = 'moon';
        break;
      default:
        this.currentMode = 'horizon-720';
    }

    // Start a smooth cinematic blend from the last rendered pose to the new one.
    // Guard: only create a transition when the mode actually changed to avoid a zero-duration blend.
    if (this.lastVisualState && fromMode !== this.currentMode) {
      this.modeTransition = {
        from: this.lastVisualState,
        startTime: time,
        duration: this.getTransitionDuration(fromMode, this.currentMode),
      };
    }
    
    const config = VIEW_MODES[index] || VIEW_MODES[0];
    
    if (this.modeChangeCallback) {
      this.modeChangeCallback(this.currentMode, config.name, config.altitude);
    }
    
    // Notify UI of angle change if switching to Fleet POV
    if (this.currentMode === 'sat-pov' && this.angleChangeCallback) {
      this.angleChangeCallback(this.cameraAngles.yaw, this.cameraAngles.pitch);
    }
  }

  /**
   * Return the transition duration (seconds) for a given mode pair.
   * Longer transitions for large spatial jumps (e.g. anything ↔ moon).
   * Callers must ensure `from !== to` before calling this method.
   */
  private getTransitionDuration(from: ViewMode, to: ViewMode): number {
    // Moon transitions are the longest because the distance change is huge
    if (from === 'moon' || to === 'moon') return 1.4;
    // Fleet POV ↔ ground: close spatial distance, short transition
    if ((from === 'sat-pov' && to === 'ground') || (from === 'ground' && to === 'sat-pov')) return 0.7;
    // God ↔ horizon: medium arc
    if ((from === 'god' && to === 'horizon-720') || (from === 'horizon-720' && to === 'god')) return 0.8;
    // Any remaining pair
    return 1.0;
  }

  /**
   * Get current view mode
   */
  getViewMode(): ViewMode {
    return this.currentMode;
  }

  /**
   * Get current view mode index
   */
  getViewModeIndex(): number {
    return this.modeIndex;
  }

  /**
   * Focus camera on a satellite while preserving the previous mode.
   */
  setFocusSatellite(index: number, distance: number, time: number = performance.now() / 1000): void {
    if (this.focusSatelliteIndex === index) return;
    this.focusSatelliteIndex = index;
    this.focusDistance = distance;
    this.focusTransition = {
      startTime: time,
      duration: 1.4,
      fromDistance: this.cameraAngles.distance,
    };
  }

  /**
   * Toggle Orbit Lock mode: camera slowly orbits the focused satellite.
   * If no satellite is focused, this is a no-op.
   */
  toggleOrbitLock(): void {
    if (this.focusSatelliteIndex === null) return;
    this.orbitLockActive = !this.orbitLockActive;
  }

  /**
   * Check if orbit lock is currently active.
   */
  isOrbitLocked(): boolean {
    return this.orbitLockActive;
  }

  /**
   * Set orbit lock speed in degrees per second.
   */
  setOrbitLockSpeed(degreesPerSecond: number): void {
    this.orbitLockSpeed = degreesPerSecond;
  }

  /**
   * Clear active satellite focus.
   */
  clearFocus(): void {
    this.focusSatelliteIndex = null;
    this.focusTransition = null;
    this.orbitLockActive = false;
  }

  /**
   * Returns true when the camera is locked to a focused satellite.
   */
  hasFocus(): boolean {
    return this.focusSatelliteIndex !== null;
  }

  /**
   * Get the currently focused satellite index, or null if none.
   */
  getFocusSatelliteIndex(): number | null {
    return this.focusSatelliteIndex;
  }

  /**
   * Calculate camera state for current frame
   */
  calculateCamera(
    satellitePosition: (index: number, time: number) => Vec3,
    satelliteVelocity: (index: number, time: number) => Vec3,
    time: number
  ): CameraState {
    const manualState = this.applyPanOffset(
      this.calculateManualCamera(satellitePosition, satelliteVelocity, time)
    );

    if (this.cinematicActive) {
      const cinematic = this.calculateCinematicCamera(satellitePosition, satelliteVelocity, time);
      this.lastCinematicState = cinematic;
      this.lastVisualState = cinematic;
      return cinematic;
    }

    if (this.cinematicBlendOut) {
      const elapsed = Math.max(0, time - this.cinematicBlendOut.startTime);
      const tLinear = Math.min(1, elapsed / this.cinematicBlendOut.duration);
      const t = this.smoothstep(tLinear);
      const blended = this.blendCameraState(this.cinematicBlendOut.from, manualState, t);
      if (tLinear >= 1) {
        this.cinematicBlendOut = null;
      }
      this.lastVisualState = blended;
      return blended;
    }

    // Smooth mode-switch transition: blend from the captured pre-switch pose to the new one
    if (this.modeTransition) {
      const elapsed = Math.max(0, time - this.modeTransition.startTime);
      const tLinear = Math.min(1, elapsed / this.modeTransition.duration);
      const t = this.smoothstep(tLinear);
      const blended = this.blendCameraState(this.modeTransition.from, manualState, t);
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
    time: number
  ): CameraState {
    if (this.focusSatelliteIndex !== null) {
      return this.calculateFocusedView(satellitePosition, time);
    }

    switch (this.currentMode) {
      case 'horizon-720':
        return this.calculateHorizonView();
      case 'god':
        return this.calculateGodView();
      case 'sat-pov':
        return this.calculateFleetPOV(satellitePosition, satelliteVelocity, time);
      case 'ground':
        return this.calculateGroundView();
      case 'moon':
        return this.calculateMoonView();
      default:
        return this.calculateHorizonView();
    }
  }

  private calculateCinematicCamera(
    getPosition: (index: number, time: number) => Vec3,
    getVelocity: (index: number, time: number) => Vec3,
    time: number
  ): CameraState {
    const step = this.cinematicSteps[this.cinematicStepIndex];
    let elapsed = Math.max(0, time - this.cinematicStepStartTime);

    if (elapsed >= step.duration) {
      this.cinematicStepIndex = (this.cinematicStepIndex + 1) % this.cinematicSteps.length;
      this.cinematicStepStartTime = time;
      elapsed = 0;
    }

    const current = this.cinematicSteps[this.cinematicStepIndex];
    const t = Math.min(1, elapsed / current.duration);

    switch (current.id) {
      case 'horizon-drift':
        return this.calculateCinematicHorizonDrift(t, time);
      case 'god-spiral':
        return this.calculateCinematicGodSpiral(t, getPosition, time);
      case 'fleet-fly':
      default:
        return this.calculateCinematicFleetFly(t, getPosition, getVelocity, time);
    }
  }

  private calculateCinematicHorizonDrift(t: number, time: number): CameraState {
    const eased = this.smoothstep(t);
    const yaw = eased * MATH.TWO_PI * 1.2 + Math.sin(time * 0.12) * 0.06;
    const radius = CONSTANTS.CAMERA_RADIUS_KM + Math.sin(time * 0.08) * 10;

    const position: Vec3 = [
      radius * Math.cos(yaw),
      radius * Math.sin(yaw),
      0,
    ];

    const radial = v3norm(position);
    const tangent = v3norm([-Math.sin(yaw), Math.cos(yaw), 0]);
    const pitchVec: Vec3 = [0, 0, Math.sin(eased * MATH.TWO_PI) * 0.15 + Math.sin(time * 0.18) * 0.03];
    const lookDir = v3norm(v3add(v3add(v3scale(tangent, 0.92), v3scale(radial, 0.22)), pitchVec));
    const target = v3add(position, v3scale(lookDir, 9000));

    return {
      position,
      target,
      up: radial,
      fov: CAMERA.DEFAULT_FOV * 0.94,
      near: CAMERA.NEAR_PLANE,
      far: CAMERA.FAR_PLANE,
    };
  }

  private calculateCinematicGodSpiral(
    t: number,
    getPosition: (index: number, time: number) => Vec3,
    time: number
  ): CameraState {
    const eased = this.smoothstep(t);
    const yaw = eased * MATH.TWO_PI * 2.3;
    const pitch = 0.78 + (0.3 - 0.78) * eased + Math.sin(time * 0.2) * 0.05;
    const distance = 48000 + (14000 - 48000) * eased;

    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    const position: Vec3 = [
      cosP * Math.cos(yaw) * distance,
      cosP * Math.sin(yaw) * distance,
      sinP * distance,
    ];

    const center = this.sampleConstellationCenter(getPosition, time);
    const centerBias = 0.15 + 0.25 * (1 - eased);
    const target: Vec3 = [
      center[0] * centerBias,
      center[1] * centerBias,
      center[2] * centerBias + Math.sin(time * 0.25) * 1200,
    ];

    let up: Vec3 = [0, 0, 1];
    if (Math.abs(sinP) > 0.95) {
      up = [Math.cos(yaw), Math.sin(yaw), 0];
    }

    return {
      position,
      target,
      up,
      fov: CAMERA.DEFAULT_FOV * 0.88,
      near: CAMERA.NEAR_PLANE,
      far: CAMERA.FAR_PLANE,
    };
  }

  private calculateCinematicFleetFly(
    t: number,
    getPosition: (index: number, time: number) => Vec3,
    getVelocity: (index: number, time: number) => Vec3,
    time: number
  ): CameraState {
    // Switch formation anchor every few seconds to keep motion varied but readable.
    const segment = time / this.fleetFlySatelliteSwitchSeconds;
    const step = Math.floor(segment);
    const mix = this.smoothstep(segment - step);
    // Prime multiplier gives deterministic pseudo-random coverage across the constellation.
    const idxA = (step * this.fleetFlySamplePrime) % CONSTANTS.NUM_SATELLITES;
    const idxB = ((step + 1) * this.fleetFlySamplePrime) % CONSTANTS.NUM_SATELLITES;

    const posA = getPosition(idxA, time);
    const posB = getPosition(idxB, time);
    const velA = getVelocity(idxA, time);
    const velB = getVelocity(idxB, time);

    const satPos = this.lerpVec3(posA, posB, mix);
    const satVel = this.lerpVec3(velA, velB, mix);

    const radial = v3norm(satPos);
    const forward = v3norm(satVel);
    const right = v3norm(v3cross(forward, radial));
    const localUp = v3norm(v3cross(right, forward));

    const bank = Math.sin(time * 0.9) * 0.2;
    const bob = Math.sin(time * 1.6) * 1.2;
    const position = v3add(
      satPos,
      v3add(
        v3add(v3scale(localUp, 65 + bob), v3scale(right, 20 * bank)),
        v3scale(forward, 18)
      )
    );

    const lead = 1500 + 900 * (0.5 + 0.5 * Math.sin(t * MATH.TWO_PI));
    const target = v3add(
      position,
      v3add(v3scale(forward, lead), v3scale(localUp, 80 * Math.sin(time * 0.4)))
    );
    const up = v3norm(v3add(localUp, v3scale(right, bank * 0.25)));

    return {
      position,
      target,
      up,
      fov: CAMERA.DEFAULT_FOV * 0.86,
      near: 1,
      far: CAMERA.FAR_PLANE,
    };
  }

  private sampleConstellationCenter(getPosition: (index: number, time: number) => Vec3, time: number): Vec3 {
    // Broad, deterministic coverage across the 2^20 Walker slots using a powers-of-two-ish
    // spread (2^13-1 through 2^20-1 plus endpoints) for stable constellation centering.
    let sum: Vec3 = [0, 0, 0];
    for (const index of this.constellationCenterSampleIndices) {
      const p = getPosition(index, time);
      sum = [sum[0] + p[0], sum[1] + p[1], sum[2] + p[2]];
    }
    return v3scale(sum, 1 / this.constellationCenterSampleIndices.length);
  }

  /**
   * Smoothly maps arbitrary input to [0, 1] by clamping first, then applying smoothstep.
   */
  private smoothstep(t: number): number {
    const clamped = Math.max(0, Math.min(1, t));
    return clamped * clamped * (3 - 2 * clamped);
  }

  private lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ];
  }

  private blendCameraState(a: CameraState, b: CameraState, t: number): CameraState {
    return {
      position: this.lerpVec3(a.position, b.position, t),
      target: this.lerpVec3(a.target, b.target, t),
      up: v3norm(this.lerpVec3(a.up, b.up, t)),
      fov: a.fov + (b.fov - a.fov) * t,
      near: a.near + (b.near - a.near) * t,
      far: a.far + (b.far - a.far) * t,
    };
  }

  private handleUserInteraction(): void {
    if (this.userInteractionCallback) {
      this.userInteractionCallback();
    }
    if (this.cinematicActive) {
      this.stopCinematic();
    }
  }

  startCinematic(time: number = performance.now() / 1000): void {
    this.cinematicStepStartTime = time;
    this.cinematicBlendOut = null;
    this.cinematicActive = true;
    if (this.cinematicChangeCallback) {
      this.cinematicChangeCallback(true);
    }
  }

  stopCinematic(time: number = performance.now() / 1000): void {
    if (!this.cinematicActive) return;
    this.cinematicActive = false;
    if (this.lastCinematicState) {
      this.cinematicBlendOut = {
        startTime: time,
        duration: this.cinematicBlendOutDuration,
        from: this.lastCinematicState,
      };
    }
    if (this.cinematicChangeCallback) {
      this.cinematicChangeCallback(false);
    }
  }

  isCinematicActive(): boolean {
    return this.cinematicActive;
  }

  /**
   * 720km Horizon View
   * 
   * Camera at 720km altitude with full pitch/yaw control
   * Now supports looking up/down and around the constellation wall
   */
  private calculateHorizonView(): CameraState {
    const yaw = this.cameraAngles.yaw * MATH.DEG_TO_RAD;
    const pitch = this.cameraAngles.pitch * MATH.DEG_TO_RAD;
    
    // Base position at 720km on X axis
    const baseRadius = CONSTANTS.CAMERA_RADIUS_KM;
    
    // Apply yaw rotation around Z axis (look left/right along orbit)
    // Apply pitch to look up/down at the constellation
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    
    // Position: fixed radius, rotated by yaw
    const position: Vec3 = [
      baseRadius * cosY,
      baseRadius * sinY,
      0
    ];
    
    // Target: look outward + pitch offset
    // Pitch looks up/down relative to the orbital plane
    const target: Vec3 = [
      baseRadius * cosY + 1000 * cosP * cosY,
      baseRadius * sinY + 1000 * cosP * sinY,
      1000 * sinP + 5000  // Base upward look + pitch
    ];
    
    // Up vector: radial outward from Earth center
    const up: Vec3 = v3norm(position);
    
    return {
      position,
      target,
      up,
      fov: CAMERA.DEFAULT_FOV,
      near: CAMERA.NEAR_PLANE,
      far: CAMERA.FAR_PLANE,
    };
  }

  /**
   * God View
   * 
   * Full spherical orbit with pitch/yaw/distance control
   */
  private calculateGodView(): CameraState {
    // Use cameraAngles directly (in degrees, convert to radians)
    const yaw = this.cameraAngles.yaw * MATH.DEG_TO_RAD;
    const pitch = this.cameraAngles.pitch * MATH.DEG_TO_RAD;
    const distance = this.cameraAngles.distance;
    
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    
    const position: Vec3 = [
      cosP * cosY * distance,
      cosP * sinY * distance,
      sinP * distance,
    ];
    
    // Avoid gimbal lock near poles
    let up: Vec3 = [0, 0, 1];
    if (Math.abs(pitch) > 1.35) {
      up = [Math.cos(yaw), Math.sin(yaw), 0];
    }
    
    return {
      position,
      target: [0, 0, 0],
      up,
      fov: CAMERA.DEFAULT_FOV,
      near: CAMERA.NEAR_PLANE,
      far: CAMERA.FAR_PLANE,
    };
  }

  /**
   * Fleet POV
   * 
   * True first-person experience riding satellite #0.
   * Full 360° yaw + pitch head look using a proper local coordinate frame
   * derived from the satellite's radial and velocity vectors.
   * WASD for micro-movement, QE for roll-like lateral drift.
   *
   * Note: Animation patterns (Smile, Digital Rain, Heartbeat) only affect
   * satellite color/brightness in the shader, not orbital positions. Fleet POV
   * remains fully functional regardless of whether a pattern is active.
   */
  private calculateFleetPOV(
    getPosition: (index: number, time: number) => Vec3,
    getVelocity: (index: number, time: number) => Vec3,
    time: number
  ): CameraState {
    const satPos = getPosition(0, time);
    const satVel = getVelocity(0, time);
    
    // Build a proper local coordinate frame:
    // radial = outward from Earth center
    // forward = velocity direction (prograde)
    // right = cross(forward, radial)
    const radial = v3norm(satPos);
    const forward = v3norm(satVel);
    const right = v3norm(v3cross(forward, radial));
    // Re-orthogonalize up from right × forward
    const localUp = v3norm(v3cross(right, forward));
    
    // Apply WASD micro-movement in local frame with speed modifiers
    // Shift = fast (3x), Ctrl = slow (0.25x)
    let moveSpeed = this.FLEET_MOVE_SPEED;
    if (this.keys['shift']) moveSpeed *= this.FLEET_FAST_MULTIPLIER;
    if (this.keys['control']) moveSpeed *= this.FLEET_SLOW_MULTIPLIER;

    const isMoving = this.keys['w'] || this.keys['s'] || this.keys['a'] || this.keys['q'] || this.keys['d'] || this.keys['e'] || this.keys[' '] || this.keys['x'];

    if (this.keys['w']) this.fleetOffset = v3add(this.fleetOffset, v3scale(forward, moveSpeed));
    if (this.keys['s']) this.fleetOffset = v3add(this.fleetOffset, v3scale(forward, -moveSpeed));
    if (this.keys['a'] || this.keys['q']) this.fleetOffset = v3add(this.fleetOffset, v3scale(right, -moveSpeed));
    if (this.keys['d'] || this.keys['e']) this.fleetOffset = v3add(this.fleetOffset, v3scale(right, moveSpeed));
    if (this.keys[' ']) this.fleetOffset = v3add(this.fleetOffset, v3scale(localUp, moveSpeed));
    if (this.keys['x']) this.fleetOffset = v3add(this.fleetOffset, v3scale(localUp, -moveSpeed));
    
    // Dampen offset back toward zero (keeps pilot anchored)
    this.fleetOffset = v3scale(this.fleetOffset, 0.98);
    
    // Camera position: higher above satellite (80km instead of 12km) + local offset
    // This gives a "balcony view" and gets us out of the blinding lens flares
    const position = v3add(v3add(satPos, v3scale(radial, 80)), this.fleetOffset);
    
    // Full 360° yaw + wide pitch for head look
    const yaw = this.cameraAngles.yaw * MATH.DEG_TO_RAD;
    const pitch = this.cameraAngles.pitch * MATH.DEG_TO_RAD;

    // Subtle roll when yawing hard (immersion)
    const yawDelta = this.cameraAngles.yaw - this.lastFleetYaw;
    this.lastFleetYaw = this.cameraAngles.yaw;
    // Smoothly approach target roll based on yaw rate, max ±8 degrees
    const targetRoll = Math.max(-8, Math.min(8, -yawDelta * 1.5)) * MATH.DEG_TO_RAD;
    this.fleetRoll += (targetRoll - this.fleetRoll) * 0.08;
    // Decay roll back to zero
    this.fleetRoll *= 0.95;
    
    // Rotate the forward direction by yaw around localUp, then by pitch around right
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    
    // Yaw rotation around localUp axis (Rodrigues' rotation formula)
    let lookDir: Vec3 = [
      forward[0] * cosY + v3cross(localUp, forward)[0] * sinY + localUp[0] * v3dot(localUp, forward) * (1 - cosY),
      forward[1] * cosY + v3cross(localUp, forward)[1] * sinY + localUp[1] * v3dot(localUp, forward) * (1 - cosY),
      forward[2] * cosY + v3cross(localUp, forward)[2] * sinY + localUp[2] * v3dot(localUp, forward) * (1 - cosY),
    ];
    lookDir = v3norm(lookDir);
    
    // Compute the right vector after yaw
    const lookRight = v3norm(v3cross(lookDir, localUp));
    
    // Pitch rotation around lookRight axis
    const cosP = Math.cos(pitch);
    // INVERT the pitch sin component so negative pitch looks down
    const sinP = Math.sin(-pitch); 
    lookDir = [
      lookDir[0] * cosP + v3cross(lookRight, lookDir)[0] * sinP + lookRight[0] * v3dot(lookRight, lookDir) * (1 - cosP),
      lookDir[1] * cosP + v3cross(lookRight, lookDir)[1] * sinP + lookRight[1] * v3dot(lookRight, lookDir) * (1 - cosP),
      lookDir[2] * cosP + v3cross(lookRight, lookDir)[2] * sinP + lookRight[2] * v3dot(lookRight, lookDir) * (1 - cosP),
    ];
    lookDir = v3norm(lookDir);
    
    const target: Vec3 = v3add(position, v3scale(lookDir, 100));
    
    // Compute actual up for the view (perpendicular to lookDir in the plane of localUp)
    const viewRight = v3norm(v3cross(lookDir, localUp));
    let viewUp = v3norm(v3cross(viewRight, lookDir));

    // Apply roll to up vector for immersion during yaw
    if (Math.abs(this.fleetRoll) > 0.0001) {
      const cosR = Math.cos(this.fleetRoll);
      const sinR = Math.sin(this.fleetRoll);
      viewUp = v3norm(v3add(v3scale(viewUp, cosR), v3scale(viewRight, sinR)));
    }
    
    // Orbital breathing: gentle position sway when idle (no movement keys pressed)
    const frameDt = this.lastFleetTime > 0 ? Math.min(0.1, time - this.lastFleetTime) : 0.016;
    this.lastFleetTime = time;
    if (!isMoving) {
      this.fleetIdleTime += frameDt;
    } else {
      this.fleetIdleTime = 0;
    }
    const breathIntensity = Math.min(1.0, this.fleetIdleTime * 0.5); // ramp up over 2s
    const breathX = Math.sin(time * 0.4) * 0.15 * breathIntensity;
    const breathY = Math.cos(time * 0.3) * 0.1 * breathIntensity;

    // Subtle head bob based on orbital motion + breathing
    const bob = Math.sin(time * 1.7) * 0.3 + breathY;
    const bobbedPos: Vec3 = v3add(v3add(position, v3scale(localUp, bob)), v3scale(right, breathX));
    
    return {
      position: bobbedPos,
      target,
      up: viewUp,
      fov: CAMERA.DEFAULT_FOV,
      near: 1.0,
      far: CAMERA.FAR_PLANE,
    };
  }

  /**
   * Moon View
   *
   * View from the Moon's surface looking back at Earth with satellites visible.
   * Camera positioned at lunar distance with Earth as the primary target.
   * Shows the satellite constellation as a shimmering swarm around Earth.
   */
  private calculateFocusedView(satellitePosition: (index: number, time: number) => Vec3, time: number): CameraState {
    const satIndex = this.focusSatelliteIndex!;
    const satPos = satellitePosition(satIndex, time);

    if (this.focusTransition) {
      const elapsed = Math.max(0, time - this.focusTransition.startTime);
      const tLinear = Math.min(1.0, elapsed / this.focusTransition.duration);
      // Cubic smoothstep ease-in/out for a cinematic zoom feel
      const t = tLinear * tLinear * (3 - 2 * tLinear);
      this.cameraAngles.distance = this.focusTransition.fromDistance + (this.focusDistance - this.focusTransition.fromDistance) * t;
      if (tLinear >= 1.0) {
        this.focusTransition = null;
      }
    }

    const yaw = this.cameraAngles.yaw * MATH.DEG_TO_RAD;
    const pitch = this.cameraAngles.pitch * MATH.DEG_TO_RAD;
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);

    const distance = this.cameraAngles.distance;
    const orbitOffset: Vec3 = [
      cosP * cosY * distance,
      cosP * sinY * distance,
      sinP * distance,
    ];

    const position = v3add(satPos, orbitOffset);
    const viewDir = v3norm(v3sub(satPos, position));
    let worldUp: Vec3 = [0, 0, 1];
    if (Math.abs(v3dot(viewDir, worldUp)) > 0.98) {
      worldUp = [1, 0, 0];
    }
    const right = v3norm(v3cross(worldUp, viewDir));
    const up = v3cross(viewDir, right);

    return {
      position,
      target: satPos,
      up,
      fov: CAMERA.DEFAULT_FOV,
      near: CAMERA.NEAR_PLANE,
      far: CAMERA.FAR_PLANE,
    };
  }

  private calculateMoonView(): CameraState {
    const yaw = this.cameraAngles.yaw * MATH.DEG_TO_RAD;
    const pitch = this.cameraAngles.pitch * MATH.DEG_TO_RAD;
    
    // Moon distance from Earth center (Moon radius ~1737km + distance)
    const moonRadius = CONSTANTS.MOON_DISTANCE_KM;
    
    // Position: on the Moon's surface, rotated by yaw around Z axis
    // Base position: Moon on +X axis relative to Earth
    const position: Vec3 = [
      moonRadius * Math.cos(yaw),
      moonRadius * Math.sin(yaw),
      0
    ];
    
    // Look direction: pitch affects how high/low we look at Earth
    // By default, look directly at Earth center (0,0,0)
    const lookPitch = pitch * 0.5; // Reduced sensitivity for moon view
    
    // Calculate look direction from Moon to Earth
    // The vector from Moon to Earth is -position normalized
    const toEarth: Vec3 = [
      -position[0] / moonRadius,
      -position[1] / moonRadius,
      -position[2] / moonRadius
    ];
    
    // Apply pitch to look slightly above/below Earth
    // When pitch is positive, look "up" relative to the orbital plane

    // Target: Earth center with pitch offset
    // We create a target that's slightly offset by pitch
    const target: Vec3 = [
      position[0] + toEarth[0] * moonRadius * 0.5,
      position[1] + toEarth[1] * moonRadius * 0.5,
      position[2] + toEarth[2] * moonRadius * 0.5 + Math.sin(lookPitch) * 50000
    ];
    
    // Up vector: radial outward from Earth center (zenith direction from Moon)
    const up: Vec3 = v3norm(position);
    
    return {
      position,
      target,
      up,
      fov: CAMERA.DEFAULT_FOV * 0.8, // Slightly zoomed in for better Earth view
      near: 1000,
      far: CAMERA.FAR_PLANE,
    };
  }

  /**
   * Ground View
   *
   * Surface observer with free look - like standing on Earth looking at the sky.
   * Full pitch/yaw control to look around the horizon and up at satellites.
   */
  private calculateGroundView(): CameraState {
    const yaw = this.cameraAngles.yaw * MATH.DEG_TO_RAD;
    const pitch = this.cameraAngles.pitch * MATH.DEG_TO_RAD;
    
    // Position on Earth's surface (100m above to avoid z-fighting)
    const surfaceRadius = CONSTANTS.EARTH_RADIUS_KM + 0.1;
    
    // Apply yaw rotation around Z axis to position on different longitudes
    // Base position on +X axis, rotated by yaw
    const position: Vec3 = [
      surfaceRadius * Math.cos(yaw),
      surfaceRadius * Math.sin(yaw),
      0
    ];
    
    // Calculate look direction based on pitch
    // pitch = -90 (look down at ground), 0 (look at horizon), +90 (look up/zenith)
    // Invert pitch because dragging up should look up
    const lookPitch = -pitch;

    // Look direction: start at horizon, rotate by pitch
    const cosP = Math.cos(lookPitch);
    const sinP = Math.sin(lookPitch);

    // Target: look out from surface applying pitch
    const target: Vec3 = [
      position[0] + Math.cos(yaw) * cosP * 10000,
      position[1] + Math.sin(yaw) * cosP * 10000,
      position[2] + sinP * 10000
    ];
    
    // Up is radial from Earth center
    const up: Vec3 = v3norm(position);
    
    return {
      position,
      target,
      up,
      fov: CAMERA.DEFAULT_FOV,
      near: 0.1,
      far: CAMERA.FAR_PLANE,
    };
  }

  /**
   * Build view-projection matrix from camera state
   */
  buildViewProjection(camera: CameraState, aspect: number): {
    view: Float32Array;
    projection: Float32Array;
    viewProjection: Float32Array;
  } {
    const view = mat4lookAt(
      camera.position,
      camera.target,
      camera.up
    );
    
    const projection = mat4persp(
      camera.fov,
      aspect,
      camera.near,
      camera.far
    );
    
    const viewProjection = new Float32Array(16);
    // Manual matrix multiply
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

  /**
   * Get camera right and up vectors from view matrix
   */
  getCameraAxes(viewMatrix: Float32Array): {
    right: Vec3;
    up: Vec3;
  } {
    return {
      right: [viewMatrix[0], viewMatrix[4], viewMatrix[8]],
      up: [viewMatrix[1], viewMatrix[5], viewMatrix[9]],
    };
  }

  /**
   * Register mode change callback
   */
  onModeChange(callback: (mode: ViewMode, name: string, altitude: string) => void): void {
    this.modeChangeCallback = callback;
  }

  /**
   * Register angle change callback (for UI updates)
   */
  onAngleChange(callback: (yaw: number, pitch: number) => void): void {
    this.angleChangeCallback = callback;
  }

  onCinematicChange(callback: (active: boolean) => void): void {
    this.cinematicChangeCallback = callback;
  }

  onUserInteraction(callback: () => void): void {
    this.userInteractionCallback = callback;
  }

  /**
   * Get current camera angles
   */
  getCameraAngles(): CameraAngles {
    return { ...this.cameraAngles };
  }

  /**
   * Reset God view to default
   */
  resetGodView(): void {
    this.godView = {
      yaw: 0,
      pitch: 0.35,
      distance: CAMERA.GOD_VIEW_DISTANCE,
    };
  }

  /**
   * Get all available view modes
   */
  getViewModes(): typeof VIEW_MODES {
    return VIEW_MODES;
  }
}

export default CameraController;
