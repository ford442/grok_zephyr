import { describe, expect, it } from 'vitest';
import {
  cameraStateForAnchor,
  GEO_OVERVIEW_RADIUS_KM,
  nextAnchorId,
  previousAnchorId,
  stageMatrixFromCameraState,
} from '@/xr/XrAnchors.js';
import { CONSTANTS } from '@/types/constants.js';
import { mat4lookAt, mat4inv } from '@/utils/math.js';

describe('XrAnchors', () => {
  it('horizon-720 sits near the 720km camera radius', () => {
    const cam = cameraStateForAnchor('horizon-720', {
      groundStation: null,
      groundStationUtcMs: 0,
    });
    const r = Math.hypot(cam.position[0], cam.position[1], cam.position[2]);
    expect(r).toBeCloseTo(CONSTANTS.CAMERA_RADIUS_KM, 0);
  });

  it('geo-overview sits near GEO radius', () => {
    const cam = cameraStateForAnchor('geo-overview', {
      groundStation: null,
      groundStationUtcMs: 0,
    });
    const r = Math.hypot(cam.position[0], cam.position[1], cam.position[2]);
    expect(r).toBeCloseTo(GEO_OVERVIEW_RADIUS_KM, 0);
  });

  it('cycles anchors', () => {
    expect(nextAnchorId('horizon-720')).toBe('geo-overview');
    expect(nextAnchorId('ground-station')).toBe('horizon-720');
    expect(previousAnchorId('horizon-720')).toBe('ground-station');
  });

  it('stage matrix is inv(lookAt)', () => {
    const cam = cameraStateForAnchor('horizon-720', {
      groundStation: null,
      groundStationUtcMs: 0,
    });
    const stage = stageMatrixFromCameraState(cam);
    const expected = mat4inv(mat4lookAt(cam.position, cam.target, cam.up));
    for (let i = 0; i < 16; i++) {
      expect(stage[i]).toBeCloseTo(expected[i], 5);
    }
  });
});
