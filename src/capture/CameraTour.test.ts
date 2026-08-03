import { describe, expect, it } from 'vitest';
import {
  CAMERA_TOURS,
  getTour,
  sampleTour,
  tourDuration,
  validateTour,
  type CameraTour,
} from './CameraTour.js';
import { CAMERA } from '@/types/constants.js';
import type { Vec3 } from '@/types/index.js';

const simple: CameraTour = {
  id: 'test',
  name: 'Test',
  up: [0, 0, 1],
  keyframes: [
    { timeSec: 0, position: [0, 0, 0], target: [1, 0, 0], fov: 1 },
    { timeSec: 1, position: [10, 0, 0], target: [11, 0, 0], fov: 1.1 },
    { timeSec: 2, position: [10, 10, 0], target: [11, 10, 0], fov: 1.2 },
    { timeSec: 3, position: [0, 10, 5], target: [1, 10, 5], fov: 1.0 },
  ],
};

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

describe('sampleTour', () => {
  it('passes exactly through every keyframe', () => {
    // The defining property of Catmull-Rom: interpolating, not approximating.
    for (const key of simple.keyframes) {
      const state = sampleTour(simple, key.timeSec);
      expect(dist(state.position, key.position)).toBeCloseTo(0, 9);
      expect(dist(state.target, key.target)).toBeCloseTo(0, 9);
      expect(state.fov).toBeCloseTo(key.fov, 9);
    }
  });

  it('is deterministic and independent of call order', () => {
    const a = sampleTour(simple, 1.37);
    sampleTour(simple, 0);
    sampleTour(simple, 3);
    const b = sampleTour(simple, 1.37);
    expect(b.position).toEqual(a.position);
    expect(b.target).toEqual(a.target);
    expect(b.fov).toBe(a.fov);
  });

  it('is continuous across segment boundaries', () => {
    // A seam would show up as a visible jump in the exported video.
    for (const key of simple.keyframes.slice(1, -1)) {
      const before = sampleTour(simple, key.timeSec - 1e-4);
      const after = sampleTour(simple, key.timeSec + 1e-4);
      expect(dist(before.position, after.position)).toBeLessThan(0.05);
      expect(dist(before.target, after.target)).toBeLessThan(0.05);
      expect(Math.abs(before.fov - after.fov)).toBeLessThan(0.01);
    }
  });

  it('moves smoothly without wild excursions between keyframes', () => {
    let previous = sampleTour(simple, 0).position;
    let travelled = 0;
    for (let t = 0.01; t <= 3; t += 0.01) {
      const current = sampleTour(simple, t).position;
      travelled += dist(previous, current);
      previous = current;
    }
    // Straight-line keyframe distance is 10 + 10 + sqrt(125) ~= 31.2 km.
    // Catmull-Rom overshoots corners slightly but must not loop or blow up.
    expect(travelled).toBeGreaterThan(30);
    expect(travelled).toBeLessThan(50);
  });

  it('clamps outside the tour instead of extrapolating', () => {
    const first = simple.keyframes[0];
    const last = simple.keyframes[simple.keyframes.length - 1];
    expect(dist(sampleTour(simple, -5).position, first.position)).toBeCloseTo(0, 9);
    expect(dist(sampleTour(simple, 99).position, last.position)).toBeCloseTo(0, 9);
    expect(dist(sampleTour(simple, Number.NaN).position, first.position)).toBeCloseTo(0, 9);
  });

  it('carries the tour up vector and standard clip planes', () => {
    const state = sampleTour(simple, 1.5);
    expect(state.up).toEqual([0, 0, 1]);
    expect(state.near).toBe(CAMERA.NEAR_PLANE);
    expect(state.far).toBe(CAMERA.FAR_PLANE);
  });
});

describe('built-in tours', () => {
  it('ships the three tours from the brief, each 10 seconds', () => {
    expect(CAMERA_TOURS.map((tour) => tour.id)).toEqual([
      'horizon-sweep',
      'god-pullback',
      'skyline-flyover',
    ]);
    for (const tour of CAMERA_TOURS) {
      expect(tourDuration(tour)).toBeCloseTo(10, 6);
    }
  });

  it('keeps every sampled pose finite, off the ground, and looking somewhere', () => {
    for (const tour of CAMERA_TOURS) {
      for (let t = 0; t <= tourDuration(tour); t += 0.1) {
        const state = sampleTour(tour, t);
        for (const v of [...state.position, ...state.target, state.fov]) {
          expect(Number.isFinite(v)).toBe(true);
        }
        // Never inside the Earth, and target never coincident with the eye.
        expect(Math.hypot(...state.position)).toBeGreaterThan(6371);
        expect(dist(state.position, state.target)).toBeGreaterThan(1);
        expect(state.fov).toBeGreaterThan(0);
        expect(state.fov).toBeLessThan(Math.PI);
      }
    }
  });

  it('god-pullback monotonically retreats from Earth', () => {
    const tour = getTour('god-pullback');
    let previous = 0;
    for (let t = 0; t <= 10; t += 0.25) {
      const radius = Math.hypot(...sampleTour(tour, t).position);
      expect(radius).toBeGreaterThan(previous);
      previous = radius;
    }
  });

  it('rejects malformed tours', () => {
    expect(() => validateTour({ ...simple, keyframes: [simple.keyframes[0]] })).toThrow(/two keyframes/);
    expect(() =>
      validateTour({
        ...simple,
        keyframes: [simple.keyframes[1], simple.keyframes[0]],
      }),
    ).toThrow(/strictly increase/);
    expect(() =>
      validateTour({
        ...simple,
        keyframes: [simple.keyframes[0], { ...simple.keyframes[1], fov: 0 }],
      }),
    ).toThrow(/fov/);
    expect(() => getTour('nope' as 'horizon-sweep')).toThrow(/Unknown camera tour/);
  });
});
