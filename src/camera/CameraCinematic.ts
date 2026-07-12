import type { Vec3 } from '@/types/index.js';
import { CONSTANTS, CAMERA, MATH } from '@/types/constants.js';
import { v3add, v3scale, v3norm, v3cross } from '@/utils/math.js';
import { smoothstep, lerpVec3 } from './cameraBlend.js';
import type { CameraState, CinematicBlendOut, CinematicStep } from './cameraTypes.js';

const CINEMATIC_STEPS: CinematicStep[] = [
  { id: 'horizon-drift', duration: 52 },
  { id: 'god-spiral', duration: 44 },
  { id: 'fleet-fly', duration: 36 },
];

const CONSTELLATION_CENTER_SAMPLE_INDICES = [0, 8191, 65535, 131071, 262143, 524287, 786431, 1048575];

export class CameraCinematic {
  private readonly blendOutDuration = 0.45;
  private readonly fleetFlySatelliteSwitchSeconds = 9;
  private readonly fleetFlySamplePrime = 7919;

  private active = false;
  private stepIndex = 0;
  private stepStartTime = 0;
  private lastState: CameraState | null = null;
  private blendOut: CinematicBlendOut | null = null;
  private changeCallback: ((active: boolean) => void) | null = null;

  onCinematicChange(callback: (active: boolean) => void): void {
    this.changeCallback = callback;
  }

  isActive(): boolean {
    return this.active;
  }

  getBlendOut(): CinematicBlendOut | null {
    return this.blendOut;
  }

  setBlendOut(blendOut: CinematicBlendOut | null): void {
    this.blendOut = blendOut;
  }

  start(time: number = performance.now() / 1000): void {
    this.stepStartTime = time;
    this.blendOut = null;
    this.active = true;
    this.changeCallback?.(true);
  }

  stop(time: number = performance.now() / 1000): void {
    if (!this.active) return;
    this.active = false;
    if (this.lastState) {
      this.blendOut = {
        startTime: time,
        duration: this.blendOutDuration,
        from: this.lastState,
      };
    }
    this.changeCallback?.(false);
  }

  calculateCamera(
    getPosition: (index: number, time: number) => Vec3,
    getVelocity: (index: number, time: number) => Vec3,
    time: number,
  ): CameraState {
    const step = CINEMATIC_STEPS[this.stepIndex];
    let elapsed = Math.max(0, time - this.stepStartTime);

    if (elapsed >= step.duration) {
      this.stepIndex = (this.stepIndex + 1) % CINEMATIC_STEPS.length;
      this.stepStartTime = time;
      elapsed = 0;
    }

    const current = CINEMATIC_STEPS[this.stepIndex];
    const t = Math.min(1, elapsed / current.duration);

    let result: CameraState;
    switch (current.id) {
      case 'horizon-drift':
        result = this.calculateHorizonDrift(t, time);
        break;
      case 'god-spiral':
        result = this.calculateGodSpiral(t, getPosition, time);
        break;
      case 'fleet-fly':
      default:
        result = this.calculateFleetFly(t, getPosition, getVelocity, time);
        break;
    }

    this.lastState = result;
    return result;
  }

  private calculateHorizonDrift(t: number, time: number): CameraState {
    const eased = smoothstep(t);
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

  private calculateGodSpiral(
    t: number,
    getPosition: (index: number, time: number) => Vec3,
    time: number,
  ): CameraState {
    const eased = smoothstep(t);
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

  private calculateFleetFly(
    t: number,
    getPosition: (index: number, time: number) => Vec3,
    getVelocity: (index: number, time: number) => Vec3,
    time: number,
  ): CameraState {
    const segment = time / this.fleetFlySatelliteSwitchSeconds;
    const step = Math.floor(segment);
    const mix = smoothstep(segment - step);
    const idxA = (step * this.fleetFlySamplePrime) % CONSTANTS.NUM_SATELLITES;
    const idxB = ((step + 1) * this.fleetFlySamplePrime) % CONSTANTS.NUM_SATELLITES;

    const posA = getPosition(idxA, time);
    const posB = getPosition(idxB, time);
    const velA = getVelocity(idxA, time);
    const velB = getVelocity(idxB, time);

    const satPos = lerpVec3(posA, posB, mix);
    const satVel = lerpVec3(velA, velB, mix);

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
        v3scale(forward, 18),
      ),
    );

    const lead = 1500 + 900 * (0.5 + 0.5 * Math.sin(t * MATH.TWO_PI));
    const target = v3add(
      position,
      v3add(v3scale(forward, lead), v3scale(localUp, 80 * Math.sin(time * 0.4))),
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
    let sum: Vec3 = [0, 0, 0];
    for (const index of CONSTELLATION_CENTER_SAMPLE_INDICES) {
      const p = getPosition(index, time);
      sum = [sum[0] + p[0], sum[1] + p[1], sum[2] + p[2]];
    }
    return v3scale(sum, 1 / CONSTELLATION_CENTER_SAMPLE_INDICES.length);
  }
}
