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
import { v3, v3add, v3sub, v3scale, v3norm, v3cross, v3dot, mat4lookAt, mat4persp } from '@/utils/math.js';

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
  
  // Fleet POV micro-movement speed (km per frame)
  private readonly FLEET_MOVE_SPEED = 0.08;
  
  // Keyboard state for Fleet POV movement
  private keys: Record<string, boolean> = {};
  
  // Fleet POV local offset (for WASD micro-movement)
  private fleetOffset: Vec3 = [0, 0, 0];
  
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
      // Fleet POV allows wider pitch range for full head look
      const pitchLimit = this.currentMode === 'sat-pov' ? 89 : this.PITCH_LIMIT;
      this.cameraAngles.pitch = Math.max(
        -pitchLimit,
        Math.min(pitchLimit, this.cameraAngles.pitch)
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
    
    // Keyboard input for Fleet POV micro-movement
    window.addEventListener('keydown', (e) => {
      this.keys[e.key.toLowerCase()] = true;
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
   * True first-person experience riding satellite #0.
   * Full 360° yaw + pitch head look using a proper local coordinate frame
   * derived from the satellite's radial and velocity vectors.
   * WASD for micro-movement, QE for roll-like lateral drift.
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
    
    // Apply WASD micro-movement in local frame
    const moveSpeed = this.FLEET_MOVE_SPEED;
    if (this.keys['w']) this.fleetOffset = v3add(this.fleetOffset, v3scale(forward, moveSpeed));
    if (this.keys['s']) this.fleetOffset = v3add(this.fleetOffset, v3scale(forward, -moveSpeed));
    if (this.keys['a'] || this.keys['q']) this.fleetOffset = v3add(this.fleetOffset, v3scale(right, -moveSpeed));
    if (this.keys['d'] || this.keys['e']) this.fleetOffset = v3add(this.fleetOffset, v3scale(right, moveSpeed));
    if (this.keys[' ']) this.fleetOffset = v3add(this.fleetOffset, v3scale(localUp, moveSpeed));
    if (this.keys['shift']) this.fleetOffset = v3add(this.fleetOffset, v3scale(localUp, -moveSpeed));
    
    // Dampen offset back toward zero (keeps pilot anchored)
    this.fleetOffset = v3scale(this.fleetOffset, 0.98);
    
    // Camera position: slightly above satellite + local offset
    const position = v3add(v3add(satPos, v3scale(radial, 12)), this.fleetOffset);
    
    // Full 360° yaw + wide pitch for head look
    const yaw = this.cameraAngles.yaw * MATH.DEG_TO_RAD;
    const pitch = this.cameraAngles.pitch * MATH.DEG_TO_RAD;
    
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
    const sinP = Math.sin(pitch);
    lookDir = [
      lookDir[0] * cosP + v3cross(lookRight, lookDir)[0] * sinP + lookRight[0] * v3dot(lookRight, lookDir) * (1 - cosP),
      lookDir[1] * cosP + v3cross(lookRight, lookDir)[1] * sinP + lookRight[1] * v3dot(lookRight, lookDir) * (1 - cosP),
      lookDir[2] * cosP + v3cross(lookRight, lookDir)[2] * sinP + lookRight[2] * v3dot(lookRight, lookDir) * (1 - cosP),
    ];
    lookDir = v3norm(lookDir);
    
    const target: Vec3 = v3add(position, v3scale(lookDir, 100));
    
    // Compute actual up for the view (perpendicular to lookDir in the plane of localUp)
    const viewRight = v3norm(v3cross(lookDir, localUp));
    const viewUp = v3norm(v3cross(viewRight, lookDir));
    
    // Subtle head bob based on orbital motion
    const bob = Math.sin(time * 1.7) * 0.3;
    const bobbedPos: Vec3 = v3add(position, v3scale(localUp, bob));
    
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
