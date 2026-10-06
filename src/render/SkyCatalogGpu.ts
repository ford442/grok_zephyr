/**
 * Hipparcos catalog GPU resources — fetch, decode, storage-buffer upload and
 * the `SkyCatalogSettings` uniform.
 *
 * Loaded once, before the scene bind groups are built (same reason as the Earth
 * plates: the cached scene render bundle never needs invalidating). With
 * `?sky=proc`, or if anything fails, a one-star placeholder is bound and the
 * bundle keeps drawing the procedural sky.
 *
 * The buffer (~139 KB) is not part of the satellite storage ledger
 * (`calculateSatelliteBufferBudget`).
 */

import type { WebGPUContext } from '@/core/WebGPUContext.js';
import type { Mat3 } from '@/physics/frames.js';
import {
  SKY_CATALOG_ASSET,
  SKY_CATALOG_SETTINGS_BYTE_SIZE,
  decodeStarCatalog,
  packSkyCatalogSettings,
  type SkyMode,
  type StarCatalog,
} from './SkyCatalog.js';

export interface SkyCatalogResources {
  /** True only when the catalog loaded and `?sky=hip` is active. */
  active: boolean;
  count: number;
  magLimit: number;
  starBuffer: GPUBuffer;
  settingsBuffer: GPUBuffer;
  /** Re-write the ICRS → render frame rotation (sun / frame toggle, date drift). */
  writeFrame(frame: Mat3): void;
  destroy(): void;
}

/** Decoded once per page — device-loss recovery re-uploads without refetching. */
let catalogPromise: Promise<StarCatalog> | null = null;

function fetchCatalog(): Promise<StarCatalog> {
  catalogPromise ??= (async () => {
    const url = new URL(SKY_CATALOG_ASSET, window.location.href).href;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return decodeStarCatalog(await response.arrayBuffer());
  })();
  catalogPromise.catch(() => {
    catalogPromise = null;
  });
  return catalogPromise;
}

export async function loadSkyCatalog(
  context: WebGPUContext,
  mode: SkyMode,
): Promise<SkyCatalogResources> {
  const device = context.getDevice();

  let catalog: StarCatalog | null = null;
  if (mode === 'hip') {
    try {
      catalog = await fetchCatalog();
    } catch (err) {
      console.warn('[SkyCatalog] load failed, keeping procedural sky:', err);
    }
  }

  const data = catalog?.data ?? new Float32Array(4);
  const starBuffer = device.createBuffer({
    label: 'sky-catalog-stars',
    size: data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(starBuffer, 0, data.buffer, data.byteOffset, data.byteLength);

  const settingsBuffer = device.createBuffer({
    label: 'sky-catalog-settings',
    size: SKY_CATALOG_SETTINGS_BYTE_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const active = catalog !== null;
  const count = catalog?.count ?? 0;
  const magLimit = catalog?.magLimit ?? 0;

  const writeFrame = (frame: Mat3): void => {
    device.queue.writeBuffer(
      settingsBuffer,
      0,
      packSkyCatalogSettings({ frame, count, magLimit, enabled: active }),
    );
  };
  writeFrame([1, 0, 0, 0, 1, 0, 0, 0, 1]);

  if (active) {
    console.log(
      `[SkyCatalog] loaded ${count} stars (V ≤ ${magLimit}), ${(data.byteLength / 1024).toFixed(1)} KB`,
    );
  }

  return {
    active,
    count,
    magLimit,
    starBuffer,
    settingsBuffer,
    writeFrame,
    destroy() {
      starBuffer.destroy();
      settingsBuffer.destroy();
    },
  };
}
