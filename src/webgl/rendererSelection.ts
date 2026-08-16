/**
 * Grok Zephyr - renderer backend selection.
 *
 * Resolves which renderer to boot: WebGPU (default, full pipeline) or the
 * WebGL2 fallback (debugging / CI / agent inspection).
 *
 * Precedence: `?renderer=webgl|webgpu` → localStorage('zephyr.renderer') → webgpu.
 * A value supplied via URL is persisted so a manual toggle survives reload.
 *
 * HDR canvas overrides live in `@/core/HdrPresentation.js` (`?hdr=0|1`).
 */

import { parseSatsParam, FLEET_SIZE_MAX } from '@/core/FleetScale.js';

export { resolveHdrOverride } from '@/core/HdrPresentation.js';

export type RendererBackend = 'webgpu' | 'webgl';

const STORAGE_KEY = 'zephyr.renderer';

/** Resolve the active renderer backend from URL + localStorage. */
export function resolveRendererBackend(search: string = window.location.search): RendererBackend {
  const params = new URLSearchParams(search);
  const urlValue = params.get('renderer')?.toLowerCase();

  if (urlValue === 'webgl' || urlValue === 'webgpu') {
    try {
      localStorage.setItem(STORAGE_KEY, urlValue);
    } catch {
      // localStorage may be unavailable; ignore persistence failures.
    }
    return urlValue;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'webgl' || stored === 'webgpu') return stored;
  } catch {
    // ignore
  }

  return 'webgpu';
}

/** Persist a backend choice (used by a debug/UI toggle). */
export function setRendererBackend(backend: RendererBackend): void {
  try {
    localStorage.setItem(STORAGE_KEY, backend);
  } catch {
    // ignore
  }
}

/**
 * Optional `?sats=<n>` override, clamped to [1, NUM_SATELLITES].
 * Used by WebGL and as the URL half of WebGPU fleet resolution.
 */
export function resolveSatelliteCount(search: string = window.location.search): number {
  return parseSatsParam(search) ?? FLEET_SIZE_MAX;
}
