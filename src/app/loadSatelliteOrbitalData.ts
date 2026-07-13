import {
  acquireCustomTLEUrl,
  acquireTLECatalog,
  formatEpochAge,
  formatTLEEpoch,
  resolveActiveCatalogId,
  resolveCustomTLEUrl,
  saveCatalogId,
  type TLECatalogId,
  type TLECatalogMeta,
  type TLECatalogResult,
} from '@/data/TLESource.js';
import { syncSimClockFromTleEpoch } from '@/app/SimClockController.js';
import { rebuildSatelliteCatalog } from '@/app/SatelliteSelection.js';
import { CONSTANTS } from '@/types/constants.js';
import { runSgp4Benchmark } from '@/physics/Sgp4Benchmark.js';
import type { AppRuntime } from '@/app/AppRuntime.js';

function buildDataSourceLabel(meta: TLECatalogMeta, realismMode: boolean, realCount: number): string {
  const prefix = realismMode ? 'TLE SGP4' : 'TLE';
  const sourceHint =
    meta.source === 'bundled-fallback'
      ? 'offline'
      : meta.source === 'bundled'
        ? 'bundled'
        : meta.label;
  return `${prefix} · ${sourceHint} (${realCount.toLocaleString()} real)`;
}

async function acquireCatalogData(
  rt: AppRuntime,
  catalogId: TLECatalogId,
): Promise<TLECatalogResult> {
  const customUrl = resolveCustomTLEUrl();
  if (customUrl) {
    return acquireCustomTLEUrl(customUrl);
  }

  return acquireTLECatalog(catalogId, (updated) => {
    void applyCatalogResult(rt, updated, catalogId, false);
  });
}

async function applyCatalogResult(
  rt: AppRuntime,
  result: TLECatalogResult,
  catalogId: TLECatalogId,
  persistSelection: boolean,
): Promise<string> {
  if (!rt.buffers) {
    throw new Error('SatelliteGPUBuffer must be initialized before loading orbital data');
  }

  const { tles, meta } = result;
  let dataSourceLabel = 'Procedural Walker';
  let hasTleCatalog = false;
  let realTLECount = 0;

  if (tles.length > 0) {
    realTLECount = rt.simulation.realismMode
      ? rt.buffers.loadFromTLEDataWithSgp4(tles, rt.simulation.simTime)
      : rt.buffers.loadFromTLEData(tles);
    hasTleCatalog = true;
    dataSourceLabel = buildDataSourceLabel(meta, rt.simulation.realismMode, realTLECount);
    console.log(
      `[GrokZephyr] Loaded ${realTLECount} TLE satellites from ${meta.label}, padded to ${CONSTANTS.NUM_SATELLITES.toLocaleString()}`,
    );
  } else {
    console.warn('[GrokZephyr] TLE source returned 0 records, falling back to procedural');
    rt.buffers.generateOrbitalElements();
    dataSourceLabel = 'Procedural Walker';
  }

  if (rt.webglOrbital) {
    if (tles.length > 0) {
      rt.webglOrbital.loadFromTLE(tles);
    } else {
      rt.webglOrbital.generate();
    }
  }

  rt.simulation.hasTleCatalog = hasTleCatalog;
  rt.buffers.uploadOrbitalElements();
  rt.ui.setDataSource(dataSourceLabel);
  rt.ui.setTleCatalogMeta(meta);
  rt.ui.setActiveTleCatalog(catalogId, meta);
  rt.ui.setRealismControls(rt.simulation.realismMode, hasTleCatalog);
  rt.dataSourceLabel = dataSourceLabel;
  rt.tleCatalogMeta = meta;

  syncSimClockFromTleEpoch(rt, meta.epoch);

  if (persistSelection) {
    saveCatalogId(catalogId);
  }

  if (hasTleCatalog) {
    const propagator = rt.buffers.getTlePropagator();
    if (propagator) {
      await propagator.initWasm();
      const bench = await runSgp4Benchmark(propagator, Date.now());
      rt.ui.updateSgp4Benchmark(bench, propagator.getBackend());
    }
  } else {
    rt.ui.updateSgp4Benchmark(null, 'js');
  }

  rt.loadedTles = tles;
  rt.tleRealCount = realTLECount;
  rebuildSatelliteCatalog(rt);

  return dataSourceLabel;
}

/** Load procedural or TLE orbital elements into the active satellite buffer. */
export async function loadSatelliteOrbitalData(rt: AppRuntime): Promise<string> {
  const catalogId = resolveActiveCatalogId();
  const result = await acquireCatalogData(rt, catalogId);
  return applyCatalogResult(rt, result, catalogId, false);
}

/** Switch TLE catalog at runtime without reloading the page. */
export async function switchTLECatalog(rt: AppRuntime, catalogId: TLECatalogId): Promise<string> {
  console.log(`[GrokZephyr] Switching TLE catalog to: ${catalogId}`);
  const result = await acquireTLECatalog(catalogId, (updated) => {
    void applyCatalogResult(rt, updated, catalogId, true);
  });
  return applyCatalogResult(rt, result, catalogId, true);
}

export function formatTleHudEpoch(meta: TLECatalogMeta | null): string {
  if (!meta?.epoch) return '—';
  return `${formatTLEEpoch(meta.epoch)} (${formatEpochAge(meta.epoch)} old)`;
}

export function formatTleHudFetchAge(meta: TLECatalogMeta | null): string {
  if (!meta) return '—';
  if (meta.fetchedAt === null) return 'bundled file';
  const age = formatEpochAge(new Date(meta.fetchedAt));
  return `${age} ago (${meta.source})`;
}
