/**
 * Compose WebXR viewer/eye poses with an ECI stage (anchor) matrix.
 *
 * Scene units are kilometers; XR local space is meters. Head translation is
 * scaled m→km; orientation is applied as-is. Projection is rebuilt from the
 * XR FOV with orbital near/far so Earth is not clipped.
 */

import type { ViewDescriptor } from '@/camera/ViewDescriptor.js';
import { viewDescriptorFromMatrices } from '@/camera/ViewDescriptor.js';
import type { Vec3 } from '@/types/index.js';
import { mat4inv, mat4mul, mat4persp } from '@/utils/math.js';
import { XR_FAR_KM, XR_NEAR_KM } from '@/xr/XrAnchors.js';

const M_TO_KM = 0.001;

/** Column-major identity. */
export function mat4Identity(): Float32Array {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

/**
 * Scale the translation of a rigid transform from meters to kilometers (in place copy).
 * Rotation block is unchanged.
 */
export function scaleTranslationMToKm(m: Float32Array): Float32Array {
  const out = new Float32Array(m);
  out[12] *= M_TO_KM;
  out[13] *= M_TO_KM;
  out[14] *= M_TO_KM;
  return out;
}

/**
 * XR view matrix (XR-world meters → eye) + stage (XR-local → ECI km)
 * → view matrix (ECI km → eye).
 *
 * eyeWorld_ECI = stage * scaleTrans(inv(viewXr))
 * view_ECI = inv(eyeWorld_ECI)
 */
export function composeViewEci(stageEci: Float32Array, viewXr: Float32Array): Float32Array {
  const eyeWorldXr = mat4inv(viewXr);
  const eyeWorldKm = scaleTranslationMToKm(eyeWorldXr);
  const eyeWorldEci = mat4mul(stageEci, eyeWorldKm);
  return mat4inv(eyeWorldEci);
}

/**
 * Camera position in ECI km from a view matrix.
 * For orthonormal view (lookAt): pos = -R^T * t (more stable than full inverse).
 */
export function cameraPosFromView(view: Float32Array): Vec3 {
  // Column-major view: columns 0..2 are right, up, -forward (or similar), column 3 is translation t.
  const r0 = view[0];
  const r1 = view[4];
  const r2 = view[8];
  const u0 = view[1];
  const u1 = view[5];
  const u2 = view[9];
  const f0 = view[2];
  const f1 = view[6];
  const f2 = view[10];
  const tx = view[12];
  const ty = view[13];
  const tz = view[14];
  return [
    -(r0 * tx + u0 * ty + f0 * tz),
    -(r1 * tx + u1 * ty + f1 * tz),
    -(r2 * tx + u2 * ty + f2 * tz),
  ];
}

/**
 * Rebuild a symmetric perspective from an XR projection matrix diagonal,
 * using orbital near/far in kilometers. Asymmetric FOV is approximated.
 */
export function projectionFromXrFov(
  xrProjection: Float32Array,
  nearKm: number = XR_NEAR_KM,
  farKm: number = XR_FAR_KM,
): Float32Array {
  const m00 = xrProjection[0];
  const m11 = xrProjection[5];
  // Guard degenerate / infinite projections.
  if (!Number.isFinite(m00) || !Number.isFinite(m11) || Math.abs(m00) < 1e-8 || Math.abs(m11) < 1e-8) {
    return mat4persp((70 * Math.PI) / 180, 1, nearKm, farKm);
  }
  const fovY = 2 * Math.atan(1 / Math.abs(m11));
  const aspect = Math.abs(m11 / m00);
  return mat4persp(fovY, aspect > 1e-4 ? aspect : 1, nearKm, farKm);
}

export interface XrEyePoseInput {
  /** Column-major view matrix from XRView.transform.inverse.matrix */
  viewMatrix: Float32Array;
  /** Column-major projection from XRView.projectionMatrix */
  projectionMatrix: Float32Array;
  viewportWidth: number;
  viewportHeight: number;
  eyeIndex: 0 | 1;
}

/** Build a ViewDescriptor for one XR eye. */
export function viewDescriptorForXrEye(
  stageEci: Float32Array,
  eye: XrEyePoseInput,
): ViewDescriptor {
  const view = composeViewEci(stageEci, eye.viewMatrix);
  const projection = projectionFromXrFov(eye.projectionMatrix);
  const cameraPos = cameraPosFromView(view);
  return viewDescriptorFromMatrices(
    view,
    projection,
    cameraPos,
    eye.viewportWidth,
    eye.viewportHeight,
    eye.eyeIndex,
  );
}
