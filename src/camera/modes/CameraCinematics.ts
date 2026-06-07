
import { CameraController } from '../CameraController.js';
import { type CameraState } from '../CameraController.js';
import { v3add, v3scale, v3norm, v3sub, v3cross } from '@/utils/math.js';
import { CAMERA } from '@/types/constants.js';

/**
   * Calculate camera state for current frame
   */
  calculateCamera(
    satellitePosition: (index: number, time: number) => Vec3,
    satelliteVelocity: (index: number, time: number) => Vec3,
    time: number
  ): CameraState {
    const manualState = controller.applyPanOffset(
      controller.calculateManualCamera(satellitePosition, satelliteVelocity, time)
    );

    if (controller.cinematicActive) {
      const cinematic = controller.calculateCinematicCamera(satellitePosition, satelliteVelocity, time);
      controller.lastCinematicState = cinematic;
      controller.lastVisualState = cinematic;
      return cinematic;
    }

    if (controller.cinematicBlendOut) {
      const elapsed = Math.max(0, time - controller.cinematicBlendOut.startTime);
      const tLinear = Math.min(1, elapsed / controller.cinematicBlendOut.duration);
      const t = controller.smoothstep(tLinear);
      const blended = controller.blendCameraState(controller.cinematicBlendOut.from, manualState, t);
      if (tLinear >= 1) {
        controller.cinematicBlendOut = null;
      }
      controller.lastVisualState = blended;
      return blended;
    }

    // Smooth mode-switch transition: blend from the captured pre-switch pose to the new one
    if (controller.modeTransition) {
      const elapsed = Math.max(0, time - controller.modeTransition.startTime);
      const tLinear = Math.min(1, elapsed / controller.modeTransition.duration);
      const t = controller.smoothstep(tLinear);
      const blended = controller.blendCameraState(controller.modeTransition.from, manualState, t);
      if (tLinear >= 1) {
        controller.modeTransition = null;
      }
      controller.lastVisualState = blended;
      return blended;
    }

    controller.lastVisualState = manualState;
    return manualState;
  }

  export function calculateManualCamera(
    satellitePosition: (index: number, time: number) => Vec3,
    satelliteVelocity: (index: number, time: number) => Vec3,
    time: number
  ): CameraState {
    if (controller.focusSatelliteIndex !== null) {
      return Modes.calculateFocusedView(this, satellitePosition, time);
    }

    switch (controller.currentMode) {
      case 'horizon-720':
        return Modes.calculateHorizonView(this, );
      case 'god':
        return Modes.calculateGodView(this, );
      case 'sat-pov':
        return Modes.calculateFleetPOV(this, satellitePosition, satelliteVelocity, time);
      case 'ground':
        return Modes.calculateGroundView(this, );
      case 'moon':
        return Modes.calculateMoonView(this, );
      default:
        return Modes.calculateHorizonView(this, );
    }
  }

  export function calculateCinematicCamera(
    getPosition: (index: number, time: number) => Vec3,
    getVelocity: (index: number, time: number) => Vec3,
    time: number
  ): CameraState {
    const step = controller.cinematicSteps[controller.cinematicStepIndex];
    let elapsed = Math.max(0, time - controller.cinematicStepStartTime);

    if (elapsed >= step.duration) {
      controller.cinematicStepIndex = (controller.cinematicStepIndex + 1) % controller.cinematicSteps.length;
      controller.cinematicStepStartTime = time;
      elapsed = 0;
    }

    const current = controller.cinematicSteps[controller.cinematicStepIndex];
    const t = Math.min(1, elapsed / current.duration);

    switch (current.id) {
      case 'horizon-drift':
        return controller.calculateCinematicHorizonDrift(t, time);
      case 'god-spiral':
        return controller.calculateCinematicGodSpiral(t, getPosition, time);
      case 'fleet-fly':
      default:
        return controller.calculateCinematicFleetFly(t, getPosition, getVelocity, time);
    }
  }

  export function calculateCinematicHorizonDrift(t: number, time: number): CameraState {
    const eased = controller.smoothstep(t);
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
/**
   * Get the currently focused satellite index, or null if none.
   */
  getFocusSatelliteIndex(): number | null {
    return controller.focusSatelliteIndex;
  }



  export function calculateCinematicGodSpiral(
    t: number,
    getPosition: (index: number, time: number) => Vec3,
    time: number
  ): CameraState {
    const eased = controller.smoothstep(t);
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

    const center = controller.sampleConstellationCenter(getPosition, time);
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
/**
   * Returns true when the camera is locked to a focused satellite.
   */
  hasFocus(): boolean {
    return controller.focusSatelliteIndex !== null;
  }



  export function calculateCinematicFleetFly(
    t: number,
    getPosition: (index: number, time: number) => Vec3,
    getVelocity: (index: number, time: number) => Vec3,
    time: number
  ): CameraState {
    // Switch formation anchor every few seconds to keep motion varied but readable.
    const segment = time / controller.fleetFlySatelliteSwitchSeconds;
    const step = Math.floor(segment);
    const mix = controller.smoothstep(segment - step);
    // Prime multiplier gives deterministic pseudo-random coverage across the constellation.
    const idxA = (step * controller.fleetFlySamplePrime) % CONSTANTS.NUM_SATELLITES;
    const idxB = ((step + 1) * controller.fleetFlySamplePrime) % CONSTANTS.NUM_SATELLITES;

    const posA = getPosition(idxA, time);
    const posB = getPosition(idxB, time);
    const velA = getVelocity(idxA, time);
    const velB = getVelocity(idxB, time);

    const satPos = controller.lerpVec3(posA, posB, mix);
    const satVel = controller.lerpVec3(velA, velB, mix);

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

/**
   * Clear active satellite focus.
   */
  clearFocus(): void {
    controller.focusSatelliteIndex = null;
    controller.focusTransition = null;
    controller.orbitLockActive = false;
  }



  export function sampleConstellationCenter(getPosition: (index: number, time: number) => Vec3, time: number): Vec3 {
    // Broad, deterministic coverage across the 2^20 Walker slots using a powers-of-two-ish
    // spread (2^13-1 through 2^20-1 plus endpoints) for stable constellation centering.
    let sum: Vec3 = [0, 0, 0];
    for (const index of controller.constellationCenterSampleIndices) {
      const p = getPosition(index, time);
      sum = [sum[0] + p[0], sum[1] + p[1], sum[2] + p[2]];
    }
    return v3scale(sum, 1 / controller.constellationCenterSampleIndices.length);
  }
