/**
 * Worker-backed catalog generate / TLE load for SatelliteGPUBuffer.
 */

import type { TLEData } from '@/types/index.js';
import type { MergedCatalogSegment } from '@/core/OrbitalElements.js';
import type { OrbitalDataStore } from '@/core/orbital/OrbitalDataStore.js';
import type { Sgp4ReanchorService } from '@/core/orbital/Sgp4ReanchorService.js';

export interface CatalogLifecycleHost {
  store: OrbitalDataStore;
  sgp4: Sgp4ReanchorService;
  numSatellites: number;
}

export async function generateCatalogElements(host: CatalogLifecycleHost): Promise<Float32Array> {
  console.log(`[SatelliteGPUBuffer] Generating multi-shell orbital elements...`);
  const startTime = performance.now();
  host.sgp4.resetProcedural();
  await host.store.generateViaWorker();
  host.sgp4.rebuild(0);
  console.log(
    `[SatelliteGPUBuffer] Generated elements in ${(performance.now() - startTime).toFixed(2)}ms`,
  );
  return host.store.orbital.data;
}

export async function loadMergedCatalog(
  host: CatalogLifecycleHost,
  tles: TLEData[],
  segments: MergedCatalogSegment[],
  groupIdsBuffer: ArrayBuffer,
  anchorSimTime?: number,
): Promise<number> {
  const startTime = performance.now();
  console.log(
    `[SatelliteGPUBuffer] Loading merged catalog (${tles.length} TLE satellites across ${segments.length} groups)...`,
  );
  host.sgp4.attachCatalog(tles);
  const realCount = await host.store.loadMergedViaWorker(tles, segments, groupIdsBuffer);
  if (anchorSimTime !== undefined) {
    host.sgp4.simEpochMs = Date.now();
    host.sgp4.enableRealism(anchorSimTime);
  } else {
    host.sgp4.realismEnabled = false;
    host.sgp4.rebuild(0);
  }
  console.log(
    `[SatelliteGPUBuffer] Merged catalog load complete in ${(performance.now() - startTime).toFixed(2)}ms`,
  );
  return realCount;
}

export async function loadTleCatalog(host: CatalogLifecycleHost, tles: TLEData[]): Promise<number> {
  const startTime = performance.now();
  console.log(
    `[SatelliteGPUBuffer] Loading ${Math.min(tles.length, host.numSatellites)} TLE satellites...`,
  );
  host.sgp4.attachCatalog(tles);
  const count = await host.store.loadTleViaWorker(tles);
  host.sgp4.rebuild(0);
  console.log(
    `[SatelliteGPUBuffer] TLE load complete in ${(performance.now() - startTime).toFixed(2)}ms`,
  );
  return count;
}
