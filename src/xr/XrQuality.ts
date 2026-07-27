/**
 * Snapshot / restore renderer quality while an XR session is active.
 * WebGL path: disable bloom for comfort FPS. WebGPU path reserved for later.
 */

import type { WebGLDebugOptions, WebGLRenderer } from '@/webgl/WebGLRenderer.js';

export interface XrQualitySnapshot {
  webglDebug: WebGLDebugOptions | null;
}

export function applyXrQuality(webgl: WebGLRenderer | null): XrQualitySnapshot {
  if (!webgl) {
    return { webglDebug: null };
  }
  const prev = webgl.getDebug();
  webgl.setDebug({
    ...prev,
    showBloom: false,
  });
  return { webglDebug: { ...prev } };
}

export function restoreXrQuality(
  webgl: WebGLRenderer | null,
  snapshot: XrQualitySnapshot | null,
): void {
  if (!webgl || !snapshot?.webglDebug) return;
  webgl.setDebug(snapshot.webglDebug);
}
