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
import { v3, v3add, v3scale, v3norm, mat4lookAt, mat4persp } from '@/utils/math.js';

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

/** Mouse input state */
export interface MouseState {
  down: boolean;
  lastX: number;
  lastY: number;
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
  
  // Mouse state
  private mouse: MouseState = {
    down: false,
    lastX: 0,
    lastY: 0,
  };
  
  // Callbacks
  private modeChangeCallback: ((mode: ViewMode, name: string, altitude: string) => void) | null = null;

  constructor() {
    this.setupEventListeners();
  }

  /**
   * Setup mouse and wheel event listeners
   */
  private setupEventListeners(): void {
    // Will be attached to canvas in setViewTarget
  }

  /**
   * Attach to canvas for mouse input
   */
  attachToCanvas(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('mousedown', (e) => {
      this.mouse.down = true;
      this.mouse.lastX = e.clientX;
      this.mouse.lastY = e.clientY;
    });

    window.addEventListener('mouseup', () => {
      this.mouse.down = false;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.mouse.down || this.currentMode !== 'god') return;
      
      const dx = e.clientX - this.mouse.lastX;
      const dy = e.clientY - this.mouse.lastY;
      
      this.godView.yaw += dx * 0.004;
      this.godView.pitch = Math.max(
        -1.4,
        Math.min(1.4, this.godView.pitch - dy * 0.004)
      );
      
      this.mouse.lastX = e.clientX;
      this.mouse.lastY = e.clientY;
    });

    canvas.addEventListener('wheel', (e) => {
      if (this.currentMode !== 'god') return;
      
      this.godView.distance = Math.max(
        CAMERA.GOD_VIEW_MIN_DISTANCE,
        Math.min(CAMERA.GOD_VIEW_MAX_DISTANCE, this.godView.distance + e.deltaY * 10)
      );
    });
  }

  /**
   * Set view mode by index
   */
  setViewMode(index: number): void {
    this.modeIndex = index;
    
    switch (index) {
      case 0:
        this.currentMode = 'horizon-720';
        break;
      case 1:
        this.currentMode = 'god';
        break;
      case 2:
        this.currentMode = 'sat-pov';
        break;
      case 3:
        this.currentMode = 'ground';
        break;
      default:
        this.currentMode = 'horizon-720';
    }
    
    const config = VIEW_MODES[index] || VIEW_MODES[0];
    
    if (this.modeChangeCallback) {
      this.modeChangeCallback(this.currentMode, config.name, config.altitude);
    }
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
   * Calculate camera state for current frame
   */
  calculateCamera(
    satellitePosition: (index: number, time: number) => Vec3,
    satelliteVelocity: (index: number, time: number) => Vec3,
    time: number
  ): CameraState {
    switch (this.currentMode) {
      case 'horizon-720':
        return this.calculateHorizonView();
      case 'god':
        return this.calculateGodView();
      case 'sat-pov':
        return this.calculateFleetPOV(satellitePosition, satelliteVelocity, time);
      case 'ground':
        return this.calculateGroundView();
      default:
        return this.calculateHorizonView();
    }
  }

  /**
   * 720km Horizon View
   * 
   * Camera at 720km altitude looking along the constellation
   */
  private calculateHorizonView(): CameraState {
    return {
      position: [CONSTANTS.CAMERA_RADIUS_KM, 0, 0],
      target: [CONSTANTS.CAMERA_RADIUS_KM, 3000, 0],
      up: [1, 0, 0],
      fov: CAMERA.DEFAULT_FOV,
      near: CAMERA.NEAR_PLANE,
      far: CAMERA.FAR_PLANE,
    };
  }

  /**
   * God View
   * 
   * Orbiting camera with mouse controls
   */
  private calculateGodView(): CameraState {
    const { yaw, pitch, distance } = this.godView;
    
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
   * Follow satellite #0 in first-person
   */
  private calculateFleetPOV(
    getPosition: (index: number, time: number) => Vec3,
    getVelocity: (index: number, time: number) => Vec3,
    time: number
  ): CameraState {
    const satPos = getPosition(0, time);
    const satVel = getVelocity(0, time);
    
    // Camera slightly above satellite
    const radial = v3norm(satPos);
    const position = v3add(satPos, v3scale(radial, 15));
    const target = v3add(position, satVel);
    
    return {
      position,
      target,
      up: radial,
      fov: CAMERA.DEFAULT_FOV,
      near: 1.0,
      far: CAMERA.FAR_PLANE,
    };
  }

  /**
   * Ground View
   *
   * Camera on Earth's surface looking upward at the night sky.
   * Position: surface of Earth on +X axis (altitude 0 km).
   * Target: orbit altitude along +X (pointing radially outward toward zenith).
   * Up: +Z so the horizon aligns naturally.
   */
  private calculateGroundView(): CameraState {
    return {
      position: [CONSTANTS.EARTH_RADIUS_KM, 0, 0],
      target: [CONSTANTS.ORBIT_RADIUS_KM, 0, 0],
      up: [0, 0, 1],
      fov: CAMERA.DEFAULT_FOV,
      near: 1.0,
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
