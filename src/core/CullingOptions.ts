/**
 * GPU culling toggle — `?culling=0` disables compaction + indirect draw.
 */

const STORAGE_KEY = 'zephyr.culling';

/** Resolve whether GPU satellite/beam culling is enabled (default: on). */
export function resolveGpuCullingEnabled(search: string = window.location.search): boolean {
  const params = new URLSearchParams(search);
  const urlValue = params.get('culling')?.toLowerCase();

  if (urlValue === '0' || urlValue === 'false' || urlValue === 'off') {
    try {
      localStorage.setItem(STORAGE_KEY, '0');
    } catch {
      // ignore
    }
    return false;
  }

  if (urlValue === '1' || urlValue === 'true' || urlValue === 'on') {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // ignore
    }
    return true;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === '0') return false;
    if (stored === '1') return true;
  } catch {
    // ignore
  }

  return true;
}

/** Persist culling preference (debug/UI toggle). */
export function setGpuCullingEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // ignore
  }
}

/** Optional `?bench=cull` — cycle view modes and log GPU cull/scene timings. */
export function resolveCullBenchmarkMode(search: string = window.location.search): boolean {
  const params = new URLSearchParams(search);
  return params.get('bench')?.toLowerCase() === 'cull';
}
