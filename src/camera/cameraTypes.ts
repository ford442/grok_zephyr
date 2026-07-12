import type { Vec3 } from '@/types/index.js';

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

export type CinematicPathId = 'horizon-drift' | 'god-spiral' | 'fleet-fly';

export interface CinematicStep {
  id: CinematicPathId;
  duration: number;
}

export interface FocusTransition {
  startTime: number;
  duration: number;
  fromDistance: number;
}

export interface ModeTransition {
  from: CameraState;
  startTime: number;
  duration: number;
  fromModeIndex: number;
  toModeIndex: number;
}

export interface CinematicBlendOut {
  startTime: number;
  duration: number;
  from: CameraState;
}

export interface FleetPOVState {
  fleetOffset: Vec3;
  fleetRoll: number;
  fleetTouchRoll: number;
  lastFleetYaw: number;
  fleetIdleTime: number;
  lastFleetTime: number;
}
