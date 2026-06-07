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
import * as Modes from './modes/CameraModes.js';
import * as Inputs from './managers/CameraInputHandler.js';
import * as Modes from './modes/CameraModes.js';
import * as Cinematics from './modes/CameraCinematics.js';
import * as Inputs from './managers/CameraInputHandler.js';

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



  export class CameraController {
public setViewMode(index: number, time: number = performance.now() / 1000): void {
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

  onTouchDoubleTap(callback: (x: number, y: number) => void): void {
    this.touchDoubleTapCallback = callback;
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
