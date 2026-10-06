/**
 * Snapshot / restore renderer quality while an XR session is active.
 * WebGL path: disable bloom for comfort FPS.
 * WebGPU path: clamp bloom to 2 pyramid levels. DoF, motion blur, TAA and the
 * post-process stack are skipped by the XR frame loop itself, so they need no
 * config change here.
 */

import type { WebGLDebugOptions, WebGLRenderer } from '@/webgl/WebGLRenderer.js';
import type { BloomConfig } from '@/types/animation.js';

/** Bloom pyramid levels in XR (two eyes per frame at headset resolution). */
export const XR_BLOOM_LEVELS = 2;

export interface XrQualitySnapshot {
  webglDebug: WebGLDebugOptions | null;
  gpuBloom?: BloomConfig | null;
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

/** Bloom surface of `RenderPipeline` (kept narrow so tests can stub it). */
export interface XrBloomTarget {
  getBloomConfig(): BloomConfig;
  setBloomConfig(config: Partial<BloomConfig>): void;
}

export function applyXrQualityGpu(pipeline: XrBloomTarget | null): XrQualitySnapshot {
  if (!pipeline) return { webglDebug: null, gpuBloom: null };
  const prev = pipeline.getBloomConfig();
  pipeline.setBloomConfig({ levels: Math.min(XR_BLOOM_LEVELS, prev.levels) });
  return { webglDebug: null, gpuBloom: prev };
}

export function restoreXrQualityGpu(
  pipeline: XrBloomTarget | null,
  snapshot: XrQualitySnapshot | null,
): void {
  if (!pipeline || !snapshot?.gpuBloom) return;
  pipeline.setBloomConfig(snapshot.gpuBloom);
}
