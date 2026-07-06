import { describe, expect, it } from 'vitest';
import { mat4lookAt, mat4mul, mat4persp } from '@/utils/math.js';
import {
  computeEarthLimbScreenYNormalized,
  HORIZON_FRAMING,
  ndcYToScreenY,
  projectWorldToNdc,
} from '@/camera/HorizonLimb.js';

describe('HorizonLimb', () => {
  it('projects NDC to screen Y with top = 0', () => {
    expect(ndcYToScreenY(-1, 1000)).toBe(0);
    expect(ndcYToScreenY(1, 1000)).toBe(1000);
    expect(ndcYToScreenY(0, 800)).toBe(400);
  });

  it('finds in-frustum Earth limb when the sphere is visible', () => {
    const position: [number, number, number] = [12000, 0, 3500];
    const target: [number, number, number] = [0, 0, 0];
    const view = mat4lookAt(position, target, [0, 0, 1]);
    const proj = mat4persp((60 * Math.PI) / 180, 16 / 9, 10, 500000);
    const viewProj = mat4mul(proj, view);

    const limbY = computeEarthLimbScreenYNormalized(viewProj, position, 1080);
    expect(limbY).not.toBeNull();
    expect(limbY!).toBeGreaterThan(-0.05);
    expect(limbY!).toBeLessThan(0.95);
  });

  it('matches flagship horizon framing constants', () => {
    expect(HORIZON_FRAMING.LIMB_TARGET_SCREEN_Y).toBeCloseTo(2 / 3, 5);
    expect(HORIZON_FRAMING.DRIFT_YAW_DEG_PER_SEC).toBe(0.02);
  });

  it('projectWorldToNdc rejects points behind the camera', () => {
    const view = mat4lookAt([0, 0, 10], [0, 0, 0], [0, 1, 0]);
    const proj = mat4persp(Math.PI / 4, 1, 0.1, 100);
    const viewProj = mat4mul(proj, view);
    expect(projectWorldToNdc([0, 0, 20], viewProj)).toBeNull();
  });
});
