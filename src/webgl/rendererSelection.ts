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

import { CONSTANTS } from '@/types/constants.js';

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
 * Optional `?sats=<n>` override for the WebGL path, clamped to [1, NUM_SATELLITES].
 * Lets weak GPUs / CI run a reduced set; defaults to the full constellation.
 */
export function resolveSatelliteCount(search: string = window.location.search): number {
  const params = new URLSearchParams(search);
  const raw = params.get('sats');
  if (!raw) return CONSTANTS.NUM_SATELLITES;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < 1) return CONSTANTS.NUM_SATELLITES;
  return Math.min(n, CONSTANTS.NUM_SATELLITES);
}
