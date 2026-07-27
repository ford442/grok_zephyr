/**
 * Per-eye / per-camera view payload shared by WebGPU uniforms, WebGL frames,
 * and (later) WebXR stereo paths. Decouples view/projection from the swapchain.
 */

import type { CameraState } from '@/camera/cameraTypes.js';
import type { Vec3 } from '@/types/index.js';
import { extractFrustum, mat4lookAt, mat4mul, mat4persp } from '@/utils/math.js';

/** Frustum plane as [nx, ny, nz, d] (normalized). */
export type FrustumPlane = Float32Array;

export interface ViewDescriptor {
  /** Column-major view × projection. */
  viewProjection: Float32Array;
  /** Column-major view matrix. */
  view: Float32Array;
  /** Column-major projection matrix. */
  projection: Float32Array;
  cameraPos: Vec3;
  cameraRight: Vec3;
  cameraUp: Vec3;
  frustum: FrustumPlane[];
  screenWidth: number;
  screenHeight: number;
  /** Optional stereo eye index (0 = left, 1 = right). */
  eyeIndex?: 0 | 1;
}

export interface ViewAxes {
  right: Vec3;
  up: Vec3;
}

/** Extract camera right/up from a column-major view matrix (matches CameraController). */
export function axesFromViewMatrix(viewMatrix: Float32Array): ViewAxes {
  return {
    right: [viewMatrix[0], viewMatrix[4], viewMatrix[8]],
    up: [viewMatrix[1], viewMatrix[5], viewMatrix[9]],
  };
}

/** Column-major view × projection product (same convention as CameraController). */
export function mulViewProjection(view: Float32Array, projection: Float32Array): Float32Array {
  return mat4mul(projection, view);
}

/**
 * Build a mono view descriptor from a CameraState (lookAt + symmetric perspective).
 * Matches CameraController.buildViewProjection + getCameraAxes + extractFrustum.
 */
export function viewDescriptorFromCameraState(
  camera: CameraState,
  screenWidth: number,
  screenHeight: number,
  eyeIndex?: 0 | 1,
): ViewDescriptor {
  const aspect = screenHeight > 0 ? screenWidth / screenHeight : 1;
  const view = mat4lookAt(camera.position, camera.target, camera.up);
  const projection = mat4persp(camera.fov, aspect, camera.near, camera.far);
  return viewDescriptorFromMatrices(
    view,
    projection,
    camera.position,
    screenWidth,
    screenHeight,
    eyeIndex,
  );
}

/**
 * Build a view descriptor from explicit view/projection matrices (WebXR path).
 * Projection should be the asymmetric FOV matrix from XRView when in VR.
 */
export function viewDescriptorFromMatrices(
  view: Float32Array,
  projection: Float32Array,
  cameraPos: Vec3,
  screenWidth: number,
  screenHeight: number,
  eyeIndex?: 0 | 1,
): ViewDescriptor {
  const viewProjection = mulViewProjection(view, projection);
  const { right, up } = axesFromViewMatrix(view);
  const frustum = extractFrustum(viewProjection);
  return {
    viewProjection,
    view,
    projection,
    cameraPos: [cameraPos[0], cameraPos[1], cameraPos[2]],
    cameraRight: right,
    cameraUp: up,
    frustum,
    screenWidth,
    screenHeight,
    eyeIndex,
  };
}
