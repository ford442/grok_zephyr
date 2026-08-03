/**
 * Keyframed camera tours for deterministic capture.
 *
 * `CameraCinematic` drives the live cinematic mode procedurally from the wall
 * clock, so it cannot be replayed frame-for-frame. Tours are the opposite: a
 * pure function of tour time, so rendering the same tour twice -- at any frame
 * rate, on any machine -- produces identical camera poses. That determinism is
 * what makes exact-framerate export possible.
 */

import type { Vec3 } from '@/types/index.js';
import type { CameraState } from '@/camera/cameraTypes.js';
import { CAMERA, CONSTANTS } from '@/types/constants.js';

export interface TourKeyframe {
  /** Seconds from tour start. Must be strictly increasing within a tour. */
  timeSec: number;
  position: Vec3;
  target: Vec3;
  /** Vertical field of view in radians. */
  fov: number;
}

export interface CameraTour {
  id: string;
  name: string;
  /** At least two keyframes, ordered by strictly increasing timeSec. */
  keyframes: readonly TourKeyframe[];
  up: Vec3;
}

export type CameraTourId = 'horizon-sweep' | 'god-pullback' | 'skyline-flyover';

/**
 * Uniform Catmull-Rom basis for one segment.
 *
 * Interpolating (not approximating): at u=0 it returns p1 exactly and at u=1
 * it returns p2 exactly, so the curve passes through every keyframe.
 */
function catmullRom(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * u +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * u3)
  );
}

function catmullRomVec3(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, u: number): Vec3 {
  return [
    catmullRom(p0[0], p1[0], p2[0], p3[0], u),
    catmullRom(p0[1], p1[1], p2[1], p3[1], u),
    catmullRom(p0[2], p1[2], p2[2], p3[2], u),
  ];
}

export function tourDuration(tour: CameraTour): number {
  const frames = tour.keyframes;
  return frames.length === 0 ? 0 : frames[frames.length - 1].timeSec - frames[0].timeSec;
}

/** Throws if the keyframes cannot define a well-formed curve. */
export function validateTour(tour: CameraTour): CameraTour {
  if (tour.keyframes.length < 2) {
    throw new RangeError(`Tour "${tour.id}" needs at least two keyframes.`);
  }
  for (let i = 0; i < tour.keyframes.length; i++) {
    const frame = tour.keyframes[i];
    if (!Number.isFinite(frame.timeSec)) {
      throw new RangeError(`Tour "${tour.id}" keyframe ${i} has a non-finite time.`);
    }
    if (i > 0 && frame.timeSec <= tour.keyframes[i - 1].timeSec) {
      throw new RangeError(`Tour "${tour.id}" keyframe times must strictly increase.`);
    }
    if (!(frame.fov > 0) || frame.fov >= Math.PI) {
      throw new RangeError(`Tour "${tour.id}" keyframe ${i} has an out-of-range fov.`);
    }
  }
  return tour;
}

/**
 * Camera pose at `timeSec` into the tour.
 *
 * Pure: depends only on the tour and the time, never on the wall clock or on
 * prior calls. Times outside the tour clamp to the first/last keyframe.
 */
export function sampleTour(tour: CameraTour, timeSec: number): CameraState {
  const frames = tour.keyframes;
  if (frames.length === 0) {
    throw new RangeError(`Tour "${tour.id}" has no keyframes.`);
  }

  const base = frames[0].timeSec;
  const t = Number.isFinite(timeSec) ? base + Math.max(0, Math.min(tourDuration(tour), timeSec)) : base;

  // Segment [i, i+1] containing t. Linear scan: tours have a handful of keys.
  let i = 0;
  while (i < frames.length - 2 && frames[i + 1].timeSec <= t) {
    i++;
  }
  const k1 = frames[i];
  const k2 = frames[i + 1] ?? frames[i];
  // Endpoints are duplicated so the curve is defined at the boundaries.
  const k0 = frames[i - 1] ?? k1;
  const k3 = frames[i + 2] ?? k2;

  const span = k2.timeSec - k1.timeSec;
  const u = span > 0 ? Math.max(0, Math.min(1, (t - k1.timeSec) / span)) : 0;

  return {
    position: catmullRomVec3(k0.position, k1.position, k2.position, k3.position, u),
    target: catmullRomVec3(k0.target, k1.target, k2.target, k3.target, u),
    up: tour.up,
    fov: catmullRom(k0.fov, k1.fov, k2.fov, k3.fov, u),
    near: CAMERA.NEAR_PLANE,
    far: CAMERA.FAR_PLANE,
  };
}

const R = CONSTANTS.CAMERA_RADIUS_KM;
const EARTH = CONSTANTS.EARTH_RADIUS_KM;
const FOV = CAMERA.DEFAULT_FOV;

/** Orbit the 720 km shell, looking along the limb. */
const HORIZON_SWEEP: CameraTour = {
  id: 'horizon-sweep',
  name: 'Horizon Sweep',
  up: [0, 0, 1],
  keyframes: [
    { timeSec: 0, position: [R, 0, 0], target: [0, R * 0.9, 0], fov: FOV * 0.94 },
    { timeSec: 3.5, position: [R * 0.72, R * 0.72, 0], target: [-R * 0.6, R * 0.7, 0], fov: FOV * 0.9 },
    { timeSec: 7, position: [0, R, 0], target: [-R * 0.9, 0, 0], fov: FOV * 0.88 },
    { timeSec: 10, position: [-R * 0.72, R * 0.72, 0], target: [-R * 0.6, -R * 0.7, 0], fov: FOV * 0.92 },
  ],
};

/** Pull back from low orbit to a whole-Earth vantage. */
const GOD_PULLBACK: CameraTour = {
  id: 'god-pullback',
  name: 'God Pull-Back',
  up: [0, 0, 1],
  keyframes: [
    { timeSec: 0, position: [R * 1.05, 0, R * 0.15], target: [0, 0, 0], fov: FOV * 0.9 },
    { timeSec: 3, position: [R * 1.9, R * 0.5, R * 0.8], target: [0, 0, 0], fov: FOV * 0.92 },
    { timeSec: 6.5, position: [R * 3.4, R * 1.2, R * 1.9], target: [0, 0, 0], fov: FOV * 0.95 },
    { timeSec: 10, position: [R * 5.6, R * 1.8, R * 3.0], target: [0, 0, 0], fov: FOV },
  ],
};

/** Skim the terminator just above the surface, looking out to the limb. */
const SKYLINE_FLYOVER: CameraTour = {
  id: 'skyline-flyover',
  name: 'Skyline Flyover',
  up: [0, 0, 1],
  keyframes: [
    { timeSec: 0, position: [EARTH + 120, -600, 180], target: [EARTH + 900, 900, 320], fov: FOV * 0.86 },
    { timeSec: 3.5, position: [EARTH + 150, -120, 210], target: [EARTH + 950, 1400, 380], fov: FOV * 0.88 },
    { timeSec: 7, position: [EARTH + 190, 420, 250], target: [EARTH + 1000, 1900, 440], fov: FOV * 0.9 },
    { timeSec: 10, position: [EARTH + 240, 980, 300], target: [EARTH + 1050, 2400, 500], fov: FOV * 0.92 },
  ],
};

export const CAMERA_TOURS: readonly CameraTour[] = [
  HORIZON_SWEEP,
  GOD_PULLBACK,
  SKYLINE_FLYOVER,
].map(validateTour);

export function getTour(id: CameraTourId): CameraTour {
  const tour = CAMERA_TOURS.find((candidate) => candidate.id === id);
  if (!tour) throw new RangeError(`Unknown camera tour: ${id}`);
  return tour;
}
