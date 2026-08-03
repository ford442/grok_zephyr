import { describe, expect, it } from 'vitest';
import {
  cameraPosFromView,
  composeViewEci,
  mat4Identity,
  projectionFromXrFov,
  scaleTranslationMToKm,
} from '@/xr/XrPoseBridge.js';
import { stageMatrixFromCameraState } from '@/xr/XrAnchors.js';
import { mat4lookAt, mat4persp } from '@/utils/math.js';
import type { CameraState } from '@/camera/cameraTypes.js';

const anchor: CameraState = {
  position: [7091, 0, 0],
  target: [7200, 50, 20],
  up: [0, 0, 1],
  fov: (60 * Math.PI) / 180,
  near: 10,
  far: 500000,
};

describe('XrPoseBridge', () => {
  it('identity XR view recovers anchor lookAt view (within scale noise)', () => {
    const stage = stageMatrixFromCameraState(anchor);
    const viewXr = mat4Identity();
    const viewEci = composeViewEci(stage, viewXr);
    const expected = mat4lookAt(anchor.position, anchor.target, anchor.up);
    for (let i = 0; i < 16; i++) {
      expect(viewEci[i]).toBeCloseTo(expected[i], 2);
    }
    const pos = cameraPosFromView(viewEci);
    expect(pos[0]).toBeCloseTo(anchor.position[0], 2);
    expect(pos[1]).toBeCloseTo(anchor.position[1], 2);
    expect(pos[2]).toBeCloseTo(anchor.position[2], 2);
  });

  it('scaleTranslationMToKm only scales translation', () => {
    const m = mat4Identity();
    m[12] = 1000; // 1 km in meters
    m[13] = 2000;
    m[14] = 3000;
    const s = scaleTranslationMToKm(m);
    expect(s[12]).toBeCloseTo(1, 6);
    expect(s[13]).toBeCloseTo(2, 6);
    expect(s[14]).toBeCloseTo(3, 6);
    expect(s[0]).toBe(1);
  });

  it('projectionFromXrFov rebuilds a usable perspective', () => {
    const xrProj = mat4persp((90 * Math.PI) / 180, 1.0, 0.1, 1000);
    const rebuilt = projectionFromXrFov(xrProj, 1, 500000);
    expect(Number.isFinite(rebuilt[0])).toBe(true);
    expect(Number.isFinite(rebuilt[5])).toBe(true);
    // Same FOV diagonal; depth coefficients differ when far plane is orbital-scale.
    expect(Math.abs(rebuilt[14])).not.toBeCloseTo(Math.abs(xrProj[14]), 3);
  });
});

/**
 * A headset eye frustum is off-axis: the lens axis sits away from the viewport
 * centre, so left != -right. These bounds are near-plane tangents in the shape
 * of a typical HMD's inner/outer asymmetry.
 */
function glEyeProjection(
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number,
): Float32Array {
  // WebXR runtimes emit GL-convention (z in [-1, 1]) projection matrices.
  const rl = 1 / (right - left);
  const tb = 1 / (top - bottom);
  const nf = 1 / (near - far);
  return new Float32Array([
    2 * near * rl, 0, 0, 0,
    0, 2 * near * tb, 0, 0,
    (right + left) * rl, (top + bottom) * tb, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

/** Project a view-space point and return NDC x/y (perspective divide). */
function ndcXY(projection: Float32Array, p: [number, number, number]): [number, number] {
  const [x, y, z] = p;
  const cx = projection[0] * x + projection[4] * y + projection[8] * z + projection[12];
  const cy = projection[1] * x + projection[5] * y + projection[9] * z + projection[13];
  const cw = projection[3] * x + projection[7] * y + projection[11] * z + projection[15];
  return [cx / cw, cy / cw];
}

describe('projectionFromXrFov preserves the headset frustum', () => {
  // Off-axis: wider toward the nose than the temple, and slightly taller above.
  const NEAR = 0.1;
  const xrProj = glEyeProjection(-0.965 * NEAR, 0.78 * NEAR, -0.92 * NEAR, 1.01 * NEAR, NEAR, 1000);

  it('keeps the frustum off-axis instead of symmetrising it', () => {
    const rebuilt = projectionFromXrFov(xrProj, 1, 500000);
    // A symmetric rebuild would zero these; they must survive.
    expect(rebuilt[8]).toBeCloseTo(xrProj[8], 6);
    expect(rebuilt[9]).toBeCloseTo(xrProj[9], 6);
    expect(Math.abs(rebuilt[8])).toBeGreaterThan(0.01);
  });

  it('maps view-space rays to exactly the same NDC x/y as the headset matrix', () => {
    const rebuilt = projectionFromXrFov(xrProj, 1, 500000);
    // Points spread across the frustum, all in front of the eye (-z forward).
    const samples: [number, number, number][] = [
      [0, 0, -10],
      [3, 2, -10],
      [-4, 1.5, -25],
      [2.5, -3, -7000],
      [-1200, 800, -42164],
    ];
    for (const p of samples) {
      const [ex, ey] = ndcXY(xrProj, p);
      const [ax, ay] = ndcXY(rebuilt, p);
      expect(ax).toBeCloseTo(ex, 5);
      expect(ay).toBeCloseTo(ey, 5);
    }
  });

  it('re-targets the depth range to orbital scale', () => {
    const rebuilt = projectionFromXrFov(xrProj, 1, 500000);
    const depth = (z: number): number => {
      const cz = rebuilt[10] * z + rebuilt[14];
      const cw = -z;
      return cz / cw;
    };
    // WebGPU-style z in [0, 1] across the orbital range.
    expect(depth(-1)).toBeCloseTo(0, 5);
    expect(depth(-500000)).toBeCloseTo(1, 5);
    // A GEO-distance satellite stays inside the frustum rather than clipping.
    expect(depth(-42164)).toBeGreaterThan(0);
    expect(depth(-42164)).toBeLessThan(1);
  });

  it('falls back to a symmetric perspective for degenerate input', () => {
    const zero = new Float32Array(16);
    expect(Number.isFinite(projectionFromXrFov(zero, 1, 500000)[0])).toBe(true);
    const nan = glEyeProjection(-0.1, 0.1, -0.1, 0.1, 0.1, 1000);
    nan[0] = Number.NaN;
    expect(Number.isFinite(projectionFromXrFov(nan, 1, 500000)[0])).toBe(true);
    // Mirrored bounds must not produce an inverted image.
    const mirrored = glEyeProjection(-0.1, 0.1, -0.1, 0.1, 0.1, 1000);
    mirrored[8] = 5; // pushes left past right
    const out = projectionFromXrFov(mirrored, 1, 500000);
    expect(Number.isFinite(out[0])).toBe(true);
    expect(out[0]).toBeGreaterThan(0);
  });
});
