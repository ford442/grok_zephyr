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
  
  // Callbacks
  private modeChangeCallback: ((mode: ViewMode, name: string, altitude: string) => void) | null = null;
  private angleChangeCallback: ((yaw: number, pitch: number) => void) | null = null;

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
   * Enhanced: All camera modes support pitch/yaw drag + zoom
   */
  attachToCanvas(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    
    // Mouse down - start dragging
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { // Left click only
        this.mouse.down = true;
        this.mouse.lastX = e.clientX;
        this.mouse.lastY = e.clientY;
        canvas.style.cursor = 'grabbing';
      }
    });

    // Mouse up - stop dragging
    window.addEventListener('mouseup', () => {
      this.mouse.down = false;
      if (this.canvas) {
        this.canvas.style.cursor = 'grab';
      }
    });

    // Mouse move - update angles for ALL modes
    window.addEventListener('mousemove', (e) => {
      if (!this.mouse.down) return;
      
      const dx = e.movementX || (e.clientX - this.mouse.lastX);
      const dy = e.movementY || (e.clientY - this.mouse.lastY);
      
      // Update yaw (left/right)
      this.cameraAngles.yaw -= dx * this.MOUSE_SENSITIVITY;
      this.cameraAngles.yaw = ((this.cameraAngles.yaw % 360) + 360) % 360;
      
      // Update pitch (up/down) - inverted so dragging up looks up
      this.cameraAngles.pitch += dy * this.MOUSE_SENSITIVITY;
      this.cameraAngles.pitch = Math.max(
        -this.PITCH_LIMIT,
        Math.min(this.PITCH_LIMIT, this.cameraAngles.pitch)
      );
      
      // Also update godView for backwards compatibility
      if (this.currentMode === 'god') {
        this.godView.yaw = this.cameraAngles.yaw * Math.PI / 180;
        this.godView.pitch = this.cameraAngles.pitch * Math.PI / 180;
      }
      
      this.mouse.lastX = e.clientX;
      this.mouse.lastY = e.clientY;
      
      // Notify UI of angle change
      if (this.angleChangeCallback) {
        this.angleChangeCallback(this.cameraAngles.yaw, this.cameraAngles.pitch);
      }
    });

    // Wheel - zoom distance (works in all modes)
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomSpeed = 40;
      this.cameraAngles.distance = Math.max(
        500,
        Math.min(180000, this.cameraAngles.distance + e.deltaY * zoomSpeed)
      );
      
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
  }
  
  /**
   * Reset camera angle to default
   */
  resetCameraAngle(): void {
    this.cameraAngles.yaw = 0;
    this.cameraAngles.pitch = 0;
    this.cameraAngles.distance = 25000;
    
    this.godView.yaw = 0;
    this.godView.pitch = 0.35;
    this.godView.distance = CAMERA.GOD_VIEW_DISTANCE;
    
    console.log('🔄 Camera angle reset');
    
    if (this.angleChangeCallback) {
      this.angleChangeCallback(0, 0);
    }
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
   * Follow satellite #0 in first-person with head-look control
   * Drag to look around while flying with the fleet
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
    
    // Base forward direction (satellite velocity)
    const forward = v3norm(satVel);
    
    // Apply pitch/yaw head look
    const yaw = this.cameraAngles.yaw * MATH.DEG_TO_RAD * 0.6;  // Reduced sensitivity
    const pitch = this.cameraAngles.pitch * MATH.DEG_TO_RAD * 0.6;
    
    // Create rotation for head look
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    
    // Rotate forward vector by pitch and yaw
    // Simplified: apply yaw around radial axis, pitch perpendicular
    const right = v3norm([radial[1], -radial[0], 0]); // Perpendicular to radial in XY
    const up = v3norm([0, 0, 1]);
    
    // Apply rotations to forward vector
    let lookDir = forward;
    // Yaw (left/right)
    lookDir = [
      lookDir[0] * cosY - lookDir[1] * sinY,
      lookDir[0] * sinY + lookDir[1] * cosY,
      lookDir[2]
    ];
    // Pitch (up/down)
    lookDir = [
      lookDir[0] * cosP - lookDir[2] * sinP,
      lookDir[1],
      lookDir[0] * sinP + lookDir[2] * cosP
    ];
    
    const target: Vec3 = [
      position[0] + lookDir[0] * 100,
      position[1] + lookDir[1] * 100,
      position[2] + lookDir[2] * 100
    ];
    
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
    // Horizon direction is tangent to surface (perpendicular to radial)
    const cosP = Math.cos(lookPitch);
    const sinP = Math.sin(lookPitch);
    
    // Target: look out from surface
    const target: Vec3 = [
      position[0] + (Math.cos(yaw) * cosP - Math.sin(yaw) * 0) * 10000,
      position[1] + (Math.sin(yaw) * cosP + Math.cos(yaw) * 0) * 10000,
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
