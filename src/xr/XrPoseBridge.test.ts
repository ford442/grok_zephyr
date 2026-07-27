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
