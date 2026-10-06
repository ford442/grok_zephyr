/**
 * WebXR capability detection (no session lifecycle).
 */

import type { RendererBackend } from '@/webgl/rendererSelection.js';

export type XrSessionMode = 'immersive-vr' | 'inline';

/** Minimal navigator.xr surface so tests can mock without full DOM XR types. */
export interface XrSystemLike {
  isSessionSupported(mode: XrSessionMode): Promise<boolean>;
  requestSession(mode: XrSessionMode, options?: XRSessionInit): Promise<XRSession>;
}

export function getXrSystem(): XrSystemLike | null {
  if (typeof navigator === 'undefined') return null;
  const xr = (navigator as Navigator & { xr?: XrSystemLike }).xr;
  return xr ?? null;
}

/** True when the UA reports immersive-vr support (may still fail on requestSession). */
export async function isImmersiveVrSupported(): Promise<boolean> {
  const xr = getXrSystem();
  if (!xr) return false;
  try {
    return await xr.isSessionSupported('immersive-vr');
  } catch {
    return false;
  }
}

/**
 * True when the UA exposes WebXR and the WebXR/WebGPU binding (`XRGPUBinding`).
 * Synchronous so boot can request an `xrCompatible` adapter before the device exists.
 */
export function hasXrGpuBinding(): boolean {
  if (getXrSystem() === null) return false;
  return typeof (globalThis as { XRGPUBinding?: unknown }).XRGPUBinding === 'function';
}

export type XrPresentBackend = 'webgpu' | 'webgl';

/**
 * Which renderer presents to the headset: WebGPU when the binding exists and the
 * device was created xrCompatible, WebGL (Stage 2) on the WebGL backend, else none.
 */
export function resolveXrBackend(
  backend: RendererBackend,
  gpuBindingReady: boolean,
): XrPresentBackend | null {
  if (backend === 'webgl') return 'webgl';
  return gpuBindingReady ? 'webgpu' : null;
}
