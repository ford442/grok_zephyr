/**
 * Grok Zephyr - renderer backend selection.
 *
 * Resolves which renderer to boot: WebGPU (default, full pipeline) or the
 * WebGL2 fallback (debugging / CI / agent inspection / no-WebGPU machines).
 *
 * The fallback is never automatic: a failed WebGPU init shows an error, not a
 * silently degraded renderer. WebGL2 runs only when the user asks for it.
 *
 * Precedence:
 *   1. `?renderer=webgl|webgpu` — persisted in localStorage('zephyr.renderer').
 *   2. `?webgl2=1` (opt-in) / `?webgl2=0` — this page load only, never persisted.
 *   3. localStorage('zephyr.renderer').
 *   4. webgpu.
 *
 * HDR canvas overrides live in `@/core/HdrPresentation.js` (`?hdr=0|1`).
 */

import { parseSatsParam, FLEET_SIZE_MAX } from '@/core/FleetScale.js';

export { resolveHdrOverride } from '@/core/HdrPresentation.js';

export type RendererBackend = 'webgpu' | 'webgl';

/** How the backend was chosen — the fallback badge says so when it is not WebGPU. */
export type RendererSource = 'url-webgl2' | 'url-renderer' | 'stored' | 'default';

export interface RendererChoice {
  backend: RendererBackend;
  source: RendererSource;
}

const STORAGE_KEY = 'zephyr.renderer';

const TRUTHY = new Set(['1', 'true', 'on', 'yes']);
const FALSY = new Set(['0', 'false', 'off', 'no']);

/** Resolve the backend and how it was selected from URL + localStorage. */
export function resolveRendererChoice(
  search: string = window.location.search,
): RendererChoice {
  const params = new URLSearchParams(search);
  const urlValue = params.get('renderer')?.toLowerCase();

  if (urlValue === 'webgl' || urlValue === 'webgpu') {
    try {
      localStorage.setItem(STORAGE_KEY, urlValue);
    } catch {
      // localStorage may be unavailable; ignore persistence failures.
    }
    return { backend: urlValue, source: 'url-renderer' };
  }

  // Opt-in only, and deliberately not persisted: the next visit is WebGPU again
  // unless the link carries the flag.
  const webgl2 = params.get('webgl2')?.toLowerCase();
  if (webgl2 && TRUTHY.has(webgl2)) return { backend: 'webgl', source: 'url-webgl2' };
  if (webgl2 && FALSY.has(webgl2)) return { backend: 'webgpu', source: 'url-webgl2' };

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'webgl' || stored === 'webgpu') return { backend: stored, source: 'stored' };
  } catch {
    // ignore
  }

  return { backend: 'webgpu', source: 'default' };
}

/** Resolve the active renderer backend from URL + localStorage. */
export function resolveRendererBackend(search: string = window.location.search): RendererBackend {
  return resolveRendererChoice(search).backend;
}

/**
 * Link that opts into the WebGL2 renderer for one page load (`?webgl2=1`),
 * keeping every other query parameter.
 */
export function webgl2OptInHref(href: string = window.location.href): string {
  const url = new URL(href);
  url.searchParams.delete('renderer');
  url.searchParams.set('webgl2', '1');
  return url.toString();
}

/**
 * Link that goes back to WebGPU. `?renderer=webgpu` rather than dropping the
 * flag, so a previously persisted `zephyr.renderer=webgl` is overwritten too.
 */
export function webgpuHref(href: string = window.location.href): string {
  const url = new URL(href);
  url.searchParams.delete('webgl2');
  url.searchParams.set('renderer', 'webgpu');
  return url.toString();
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
