import type { Vec3 } from '@/types/index.js';
import { CONSTANTS, CAMERA, MATH } from '@/types/constants.js';
import { HORIZON_FRAMING } from '@/camera/HorizonLimb.js';
import { v3add, v3scale, v3norm, v3sub, v3cross, v3dot } from '@/utils/math.js';
import type { CameraAngles, CameraState, FleetPOVState, FocusTransition } from './cameraTypes.js';

export function calculateHorizonView(
  cameraAngles: CameraAngles,
  horizonDriftYawDeg: number,
): CameraState {
  const yaw = (cameraAngles.yaw + horizonDriftYawDeg) * MATH.DEG_TO_RAD;
  const pitch = (cameraAngles.pitch + HORIZON_FRAMING.BASE_PITCH_DEG) * MATH.DEG_TO_RAD;

  const baseRadius = CONSTANTS.CAMERA_RADIUS_KM;
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);

  const position: Vec3 = [baseRadius * cosY, baseRadius * sinY, 0];

  const tangential = HORIZON_FRAMING.TANGENTIAL_LOOK_KM;
  const upward = HORIZON_FRAMING.BASE_UPWARD_LOOK_KM;
  const target: Vec3 = [
    baseRadius * cosY + tangential * cosP * cosY,
    baseRadius * sinY + tangential * cosP * sinY,
    tangential * sinP + upward,
  ];

  const radial = v3norm(position);
  const forward = v3norm(v3sub(target, position));
  const right = v3norm(v3cross(forward, radial));
  const roll = HORIZON_FRAMING.ROLL_DEG * MATH.DEG_TO_RAD;
  const up = v3norm(v3add(v3scale(radial, Math.cos(roll)), v3scale(right, Math.sin(roll))));

  return {
    position,
    target,
    up,
    fov: CAMERA.DEFAULT_FOV * 0.97,
    near: CAMERA.NEAR_PLANE,
    far: CAMERA.FAR_PLANE,
  };
}

export function calculateGodView(cameraAngles: CameraAngles, godIdleYawDeg: number): CameraState {
  const yaw = (cameraAngles.yaw + godIdleYawDeg) * MATH.DEG_TO_RAD;
  const pitch = cameraAngles.pitch * MATH.DEG_TO_RAD;
  const distance = cameraAngles.distance;

  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);

  const position: Vec3 = [cosP * cosY * distance, cosP * sinY * distance, sinP * distance];

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

export interface FleetPOVOptions {
  moveSpeed: number;
  fastMultiplier: number;
  slowMultiplier: number;
}

export function calculateFleetPOV(
  getPosition: (index: number, time: number) => Vec3,
  getVelocity: (index: number, time: number) => Vec3,
  time: number,
  cameraAngles: CameraAngles,
  state: FleetPOVState,
  keys: Record<string, boolean>,
  options: FleetPOVOptions,
): { camera: CameraState; state: FleetPOVState } {
  const satPos = getPosition(0, time);
  const satVel = getVelocity(0, time);

  const radial = v3norm(satPos);
  const forward = v3norm(satVel);
  const right = v3norm(v3cross(forward, radial));
  const localUp = v3norm(v3cross(right, forward));

  let moveSpeed = options.moveSpeed;
  if (keys['shift']) moveSpeed *= options.fastMultiplier;
  if (keys['control']) moveSpeed *= options.slowMultiplier;

  const isMoving =
    keys['w'] ||
    keys['s'] ||
    keys['a'] ||
    keys['q'] ||
    keys['d'] ||
    keys['e'] ||
    keys[' '] ||
    keys['x'];

  let fleetOffset = state.fleetOffset;
  if (keys['w']) fleetOffset = v3add(fleetOffset, v3scale(forward, moveSpeed));
  if (keys['s']) fleetOffset = v3add(fleetOffset, v3scale(forward, -moveSpeed));
  if (keys['a'] || keys['q']) fleetOffset = v3add(fleetOffset, v3scale(right, -moveSpeed));
  if (keys['d'] || keys['e']) fleetOffset = v3add(fleetOffset, v3scale(right, moveSpeed));
  if (keys[' ']) fleetOffset = v3add(fleetOffset, v3scale(localUp, moveSpeed));
  if (keys['x']) fleetOffset = v3add(fleetOffset, v3scale(localUp, -moveSpeed));

  fleetOffset = v3scale(fleetOffset, 0.98);

  const position = v3add(v3add(satPos, v3scale(radial, 80)), fleetOffset);

  const yaw = cameraAngles.yaw * MATH.DEG_TO_RAD;
  const pitch = cameraAngles.pitch * MATH.DEG_TO_RAD;

  const yawDelta = cameraAngles.yaw - state.lastFleetYaw;
  const targetRoll = Math.max(-8, Math.min(8, -yawDelta * 1.5)) * MATH.DEG_TO_RAD;
  let fleetRoll = state.fleetRoll + (targetRoll - state.fleetRoll) * 0.08;
  fleetRoll *= 0.95;
  const fleetTouchRoll = state.fleetTouchRoll * 0.985;

  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);

  let lookDir: Vec3 = [
    forward[0] * cosY +
      v3cross(localUp, forward)[0] * sinY +
      localUp[0] * v3dot(localUp, forward) * (1 - cosY),
    forward[1] * cosY +
      v3cross(localUp, forward)[1] * sinY +
      localUp[1] * v3dot(localUp, forward) * (1 - cosY),
    forward[2] * cosY +
      v3cross(localUp, forward)[2] * sinY +
      localUp[2] * v3dot(localUp, forward) * (1 - cosY),
  ];
  lookDir = v3norm(lookDir);

  const lookRight = v3norm(v3cross(lookDir, localUp));

  const cosP = Math.cos(pitch);
  const sinP = Math.sin(-pitch);
  lookDir = [
    lookDir[0] * cosP +
      v3cross(lookRight, lookDir)[0] * sinP +
      lookRight[0] * v3dot(lookRight, lookDir) * (1 - cosP),
    lookDir[1] * cosP +
      v3cross(lookRight, lookDir)[1] * sinP +
      lookRight[1] * v3dot(lookRight, lookDir) * (1 - cosP),
    lookDir[2] * cosP +
      v3cross(lookRight, lookDir)[2] * sinP +
      lookRight[2] * v3dot(lookRight, lookDir) * (1 - cosP),
  ];
  lookDir = v3norm(lookDir);

  const target: Vec3 = v3add(position, v3scale(lookDir, 100));

  const viewRight = v3norm(v3cross(lookDir, localUp));
  let viewUp = v3norm(v3cross(viewRight, lookDir));

  const effectiveRoll = fleetRoll + fleetTouchRoll;
  if (Math.abs(effectiveRoll) > 0.0001) {
    const cosR = Math.cos(effectiveRoll);
    const sinR = Math.sin(effectiveRoll);
    viewUp = v3norm(v3add(v3scale(viewUp, cosR), v3scale(viewRight, sinR)));
  }

  const frameDt = state.lastFleetTime > 0 ? Math.min(0.1, time - state.lastFleetTime) : 0.016;
  let fleetIdleTime = state.fleetIdleTime;
  if (!isMoving) {
    fleetIdleTime += frameDt;
  } else {
    fleetIdleTime = 0;
  }
  const breathIntensity = Math.min(1.0, fleetIdleTime * 0.5);
  const breathX = Math.sin(time * 0.4) * 0.15 * breathIntensity;
  const breathY = Math.cos(time * 0.3) * 0.1 * breathIntensity;

  const bob = Math.sin(time * 1.7) * 0.3 + breathY;
  const bobbedPos: Vec3 = v3add(v3add(position, v3scale(localUp, bob)), v3scale(right, breathX));

  return {
    camera: {
      position: bobbedPos,
      target,
      up: viewUp,
      fov: CAMERA.DEFAULT_FOV,
      near: 1.0,
      far: CAMERA.FAR_PLANE,
    },
    state: {
      fleetOffset,
      fleetRoll,
      fleetTouchRoll,
      lastFleetYaw: cameraAngles.yaw,
      fleetIdleTime,
      lastFleetTime: time,
    },
  };
}

export function calculateFocusedView(
  satellitePosition: (index: number, time: number) => Vec3,
  time: number,
  satIndex: number,
  focusDistance: number,
  focusTransition: FocusTransition | null,
  cameraAngles: CameraAngles,
): { camera: CameraState; cameraAngles: CameraAngles; focusTransition: FocusTransition | null } {
  const satPos = satellitePosition(satIndex, time);
  let distance = cameraAngles.distance;
  let transition = focusTransition;

  if (transition) {
    const elapsed = Math.max(0, time - transition.startTime);
    const tLinear = Math.min(1.0, elapsed / transition.duration);
    const t = tLinear * tLinear * (3 - 2 * tLinear);
    distance = transition.fromDistance + (focusDistance - transition.fromDistance) * t;
    if (tLinear >= 1.0) {
      transition = null;
    }
  }

  const yaw = cameraAngles.yaw * MATH.DEG_TO_RAD;
  const pitch = cameraAngles.pitch * MATH.DEG_TO_RAD;
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);

  const orbitOffset: Vec3 = [cosP * cosY * distance, cosP * sinY * distance, sinP * distance];

  const position = v3add(satPos, orbitOffset);
  const viewDir = v3norm(v3sub(satPos, position));
  let worldUp: Vec3 = [0, 0, 1];
  if (Math.abs(v3dot(viewDir, worldUp)) > 0.98) {
    worldUp = [1, 0, 0];
  }
  const right = v3norm(v3cross(worldUp, viewDir));
  const up = v3cross(viewDir, right);

  return {
    camera: {
      position,
      target: satPos,
      up,
      fov: CAMERA.DEFAULT_FOV,
      near: CAMERA.NEAR_PLANE,
      far: CAMERA.FAR_PLANE,
    },
    cameraAngles: { ...cameraAngles, distance },
    focusTransition: transition,
  };
}

export function calculateMoonView(cameraAngles: CameraAngles): CameraState {
  const yaw = cameraAngles.yaw * MATH.DEG_TO_RAD;
  const pitch = cameraAngles.pitch * MATH.DEG_TO_RAD;

  const moonRadius = CONSTANTS.MOON_DISTANCE_KM;

  const position: Vec3 = [moonRadius * Math.cos(yaw), moonRadius * Math.sin(yaw), 0];

  const toEarth = v3norm(v3scale(position, -1));
  const lookPitch = pitch * 0.5;

  const worldUp: Vec3 = [0, 0, 1];
  const right = v3norm(v3cross(toEarth, worldUp));
  const tangentUp = v3norm(v3cross(right, toEarth));

  const pitchOffset = Math.sin(lookPitch) * 60000;
  const target: Vec3 = [
    tangentUp[0] * pitchOffset,
    tangentUp[1] * pitchOffset,
    tangentUp[2] * pitchOffset,
  ];

  return {
    position,
    target,
    up: tangentUp,
    fov: CAMERA.DEFAULT_FOV * 0.85,
    near: 1000,
    far: CAMERA.FAR_PLANE,
  };
}

export function calculateGroundView(cameraAngles: CameraAngles): CameraState {
  const yaw = cameraAngles.yaw * MATH.DEG_TO_RAD;
  const pitch = cameraAngles.pitch * MATH.DEG_TO_RAD;

  const surfaceRadius = CONSTANTS.EARTH_RADIUS_KM + 0.1;

  const position: Vec3 = [surfaceRadius * Math.cos(yaw), surfaceRadius * Math.sin(yaw), 0];

  const lookPitch = -pitch;
  const cosP = Math.cos(lookPitch);
  const sinP = Math.sin(lookPitch);

  const target: Vec3 = [
    position[0] + Math.cos(yaw) * cosP * 10000,
    position[1] + Math.sin(yaw) * cosP * 10000,
    position[2] + sinP * 10000,
  ];

  return {
    position,
    target,
    up: v3norm(position),
    fov: CAMERA.DEFAULT_FOV,
    near: 0.1,
    far: CAMERA.FAR_PLANE,
  };
}

export function calculateSkylineView(cameraAngles: CameraAngles): CameraState {
  const yaw = cameraAngles.yaw * MATH.DEG_TO_RAD;
  const pitch = cameraAngles.pitch * MATH.DEG_TO_RAD;

  const liftKm = 0.18;
  const surfaceRadius = CONSTANTS.EARTH_RADIUS_KM + liftKm;

  const position: Vec3 = [surfaceRadius * Math.cos(yaw), surfaceRadius * Math.sin(yaw), 0];

  const downwardBiasRad = 8 * MATH.DEG_TO_RAD;
  const lookPitch = -(pitch + downwardBiasRad);

  const cosP = Math.cos(lookPitch);
  const sinP = Math.sin(lookPitch);

  const target: Vec3 = [
    position[0] + Math.cos(yaw) * cosP * 10000,
    position[1] + Math.sin(yaw) * cosP * 10000,
    position[2] + sinP * 10000,
  ];

  return {
    position,
    target,
    up: v3norm(position),
    fov: CAMERA.DEFAULT_FOV,
    near: 0.1,
    far: CAMERA.FAR_PLANE,
  };
}
