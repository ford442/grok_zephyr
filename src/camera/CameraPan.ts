import type { Vec3, ViewMode } from '@/types/index.js';
import { CONSTANTS } from '@/types/constants.js';
import { MATH } from '@/types/constants.js';
import { v3add, v3scale, v3norm, v3cross } from '@/utils/math.js';
import type { CameraAngles, CameraState } from './cameraTypes.js';

export class CameraPan {
  panOffset: Vec3 = [0, 0, 0];
  panSensitivity = 1.0;

  setPanSensitivity(value: number): void {
    this.panSensitivity = Math.max(0.2, Math.min(4.0, value));
  }

  reset(): void {
    this.panOffset = [0, 0, 0];
  }

  applyKeyboardPanning(
    deltaTime: number,
    keys: Record<string, boolean>,
    currentMode: ViewMode,
    cameraAngles: CameraAngles,
  ): void {
    const right = (keys['arrowright'] ? 1 : 0) - (keys['arrowleft'] ? 1 : 0);
    const up = (keys['arrowup'] ? 1 : 0) - (keys['arrowdown'] ? 1 : 0);
    const useShiftPan = keys['shift'] && currentMode !== 'sat-pov';
    const shiftRight = useShiftPan ? ((keys['d'] ? 1 : 0) - (keys['a'] ? 1 : 0)) : 0;
    const shiftUp = useShiftPan ? ((keys['w'] ? 1 : 0) - (keys['s'] ? 1 : 0)) : 0;

    const panX = right + shiftRight;
    const panY = up + shiftUp;

    if (panX !== 0 || panY !== 0) {
      const keyboardScale = 180 * deltaTime;
      this.panBy(panX * keyboardScale, panY * keyboardScale, currentMode, cameraAngles);
    }
  }

  panBy(dx: number, dy: number, currentMode: ViewMode, cameraAngles: CameraAngles): void {
    const basis = this.getPanBasis(currentMode, cameraAngles);
    const distance = Math.max(500, cameraAngles.distance);
    const scale = this.panSensitivity * Math.max(0.000005, distance * 0.000009);

    const worldOffset = v3add(
      v3scale(basis.right, dx * scale),
      v3scale(basis.up, dy * scale),
    );

    this.panOffset = v3add(this.panOffset, worldOffset);
  }

  getPanBasis(currentMode: ViewMode, cameraAngles: CameraAngles): { right: Vec3; up: Vec3 } {
    const yaw = cameraAngles.yaw * MATH.DEG_TO_RAD;
    const pitch = cameraAngles.pitch * MATH.DEG_TO_RAD;
    const forward: Vec3 = [
      Math.cos(pitch) * Math.cos(yaw),
      Math.cos(pitch) * Math.sin(yaw),
      Math.sin(pitch),
    ];

    const worldUp: Vec3 = currentMode === 'ground' || currentMode === 'skyline'
      ? [Math.cos(yaw), Math.sin(yaw), 0]
      : [0, 0, 1];

    let right = v3norm(v3cross(forward, worldUp));
    if (Math.abs(right[0]) + Math.abs(right[1]) + Math.abs(right[2]) < 1e-4) {
      right = [1, 0, 0];
    }
    const up = v3norm(v3cross(right, forward));
    return { right, up };
  }

  applyPanOffset(
    camera: CameraState,
    currentMode: ViewMode,
    cameraAngles: CameraAngles,
  ): CameraState {
    if (this.panOffset[0] === 0 && this.panOffset[1] === 0 && this.panOffset[2] === 0) {
      return camera;
    }

    if (currentMode === 'ground' || currentMode === 'skyline') {
      const surfaceRadius = currentMode === 'skyline'
        ? CONSTANTS.EARTH_RADIUS_KM + 0.18
        : CONSTANTS.EARTH_RADIUS_KM + 0.1;
      const pannedPosition = v3add(camera.position, this.panOffset);
      const newPosition = v3scale(v3norm(pannedPosition), surfaceRadius);

      const yaw = cameraAngles.yaw * MATH.DEG_TO_RAD;
      const pitch = cameraAngles.pitch * MATH.DEG_TO_RAD;
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
}
