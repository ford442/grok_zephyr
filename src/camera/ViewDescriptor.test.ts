import { describe, expect, it } from 'vitest';
import {
  axesFromViewMatrix,
  mulViewProjection,
  viewDescriptorFromCameraState,
  viewDescriptorFromMatrices,
} from '@/camera/ViewDescriptor.js';
import { mat4lookAt, mat4persp } from '@/utils/math.js';
import type { CameraState } from '@/camera/cameraTypes.js';

const sampleCamera: CameraState = {
  position: [7091, 0, 0],
  target: [7200, 100, 50],
  up: [0, 0, 1],
  fov: (60 * Math.PI) / 180,
  near: 10,
  far: 500000,
};

describe('ViewDescriptor', () => {
  it('viewDescriptorFromCameraState matches lookAt × perspective', () => {
    const w = 1920;
    const h = 1080;
    const desc = viewDescriptorFromCameraState(sampleCamera, w, h);
    const view = mat4lookAt(sampleCamera.position, sampleCamera.target, sampleCamera.up);
    const projection = mat4persp(sampleCamera.fov, w / h, sampleCamera.near, sampleCamera.far);
    const vp = mulViewProjection(view, projection);

    expect(desc.screenWidth).toBe(w);
    expect(desc.screenHeight).toBe(h);
    expect(desc.cameraPos).toEqual(sampleCamera.position);
    for (let i = 0; i < 16; i++) {
      expect(desc.view[i]).toBeCloseTo(view[i], 5);
      expect(desc.projection[i]).toBeCloseTo(projection[i], 5);
      expect(desc.viewProjection[i]).toBeCloseTo(vp[i], 5);
    }
  });

  it('axesFromViewMatrix matches view matrix columns', () => {
    const view = mat4lookAt(sampleCamera.position, sampleCamera.target, sampleCamera.up);
    const axes = axesFromViewMatrix(view);
    expect(axes.right[0]).toBeCloseTo(view[0], 5);
    expect(axes.up[1]).toBeCloseTo(view[5], 5);
  });

  it('viewDescriptorFromMatrices preserves eye index and frustum count', () => {
    const view = mat4lookAt(sampleCamera.position, sampleCamera.target, sampleCamera.up);
    const projection = mat4persp(sampleCamera.fov, 16 / 9, sampleCamera.near, sampleCamera.far);
    const desc = viewDescriptorFromMatrices(view, projection, sampleCamera.position, 800, 450, 1);
    expect(desc.eyeIndex).toBe(1);
    expect(desc.frustum).toHaveLength(6);
  });
});
