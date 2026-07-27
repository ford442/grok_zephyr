/**
 * WebXR capability detection (no session lifecycle).
 */

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
