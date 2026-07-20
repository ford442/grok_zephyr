import { resolveCustomTLEUrl, acquireCustomTLEUrl, formatEpochAge, formatTLEEpoch } from '@/data/TLESource.js';
import {
  composeConstellationCatalog,
  composeProceduralCatalog,
  type MergedCatalog,
} from '@/data/ConstellationComposer.js';
import {
  createDefaultVisibility,
  formatGroupCountLegend,
  readSavedConstellationSelection,
  saveConstellationSelection,
  shouldUseMultiGroupColors,
  type ChipCatalogId,
} from '@/data/ConstellationGroups.js';
import { syncSimClockFromTleEpoch } from '@/app/SimClockController.js';
import { rebuildSatelliteCatalog } from '@/app/SatelliteSelection.js';
import { CONSTANTS } from '@/types/constants.js';
import { runSgp4Benchmark } from '@/physics/Sgp4Benchmark.js';
import type { AppRuntime } from '@/app/AppRuntime.js';

function buildDataSourceLabel(
  merged: MergedCatalog,
  realismMode: boolean,
  realCount: number,
): string {
  if (merged.segments.length === 0) {
    return 'Procedural Walker';
  }
  const legend = formatGroupCountLegend(merged.groupCounts);
  const prefix = realismMode ? 'TLE SGP4' : 'TLE';
  if (legend) {
    return `${prefix} · ${legend}`;
  }
  return `${prefix} (${realCount.toLocaleString()} real)`;
}

async function applyMergedCatalog(
  rt: AppRuntime,
  merged: MergedCatalog,
  enabledIds: readonly ChipCatalogId[],
  persistSelection: boolean,
): Promise<string> {
  if (!rt.buffers) {
    throw new Error('SatelliteGPUBuffer must be initialized before loading orbital data');
  }

  const multiGroupColorMode = shouldUseMultiGroupColors(enabledIds);
  const visibility = createDefaultVisibility();
  visibility.multiGroupColorMode = multiGroupColorMode;
  rt.buffers.setGroupVisibilityState(visibility);

  let dataSourceLabel: string;
  let hasTleCatalog = false;
  let realTLECount = 0;

  if (merged.segments.length > 0 && merged.tles.length > 0) {
    realTLECount = rt.simulation.realismMode
      ? await rt.buffers.loadFromMergedCatalog(
          merged.tles,
          merged.segments,
          new ArrayBuffer(CONSTANTS.NUM_SATELLITES * 4),
          rt.simulation.simTime,
        )
      : await rt.buffers.loadFromMergedCatalog(
          merged.tles,
          merged.segments,
          new ArrayBuffer(CONSTANTS.NUM_SATELLITES * 4),
        );
    hasTleCatalog = true;
    dataSourceLabel = buildDataSourceLabel(merged, rt.simulation.realismMode, realTLECount);
    console.log(
      `[GrokZephyr] Loaded ${realTLECount} satellites across ${merged.segments.length} constellation(s)`,
    );
  } else {
    console.warn('[GrokZephyr] No TLE catalogs enabled, using procedural Walker');
    await rt.buffers.generateOrbitalElements();
    dataSourceLabel = 'Procedural Walker';
  }

  if (rt.webglOrbital && rt.buffers) {
    const src = rt.buffers.getOrbitalElementData();
    const bytes = src.byteLength;
    const copy = new Uint8Array(bytes);
    copy.set(new Uint8Array(src.buffer, src.byteOffset, bytes));
    rt.webglOrbital.adoptBuffer(copy.buffer);
    const groupSrc = rt.buffers.getGroupIdData();
    rt.webglGroupIds = new Uint32Array(groupSrc);
    rt.webglMultiGroupColorMode = multiGroupColorMode;
    rt.webglGroupVisibility = [...visibility.visible];
    rt.webglRenderer?.reloadOrbitalElements();
  }

  rt.simulation.hasTleCatalog = hasTleCatalog;
  rt.buffers.uploadOrbitalElements();
  rt.ui.setDataSource(dataSourceLabel);
  rt.ui.setConstellationLegend(formatGroupCountLegend(merged.groupCounts));
  rt.ui.setConstellationChips(
    enabledIds,
    merged.groupCounts,
    rt.buffers?.getGroupVisibilityState().visible ?? rt.webglGroupVisibility,
  );
  rt.ui.setRealismControls(rt.simulation.realismMode, hasTleCatalog);
  rt.dataSourceLabel = dataSourceLabel;
  rt.tleCatalogMeta = merged.meta.catalogs[0] ?? null;
  rt.constellationGroupCounts = merged.groupCounts;

  syncSimClockFromTleEpoch(rt, merged.meta.epoch);

  if (persistSelection) {
    saveConstellationSelection(enabledIds);
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

  rt.loadedTles = merged.tles;
  rt.tleRealCount = realTLECount;
  rt.enabledConstellations = [...enabledIds];
  rebuildSatelliteCatalog(rt);

  return dataSourceLabel;
}

/** Load procedural or multi-constellation orbital elements into the active satellite buffer. */
export async function loadSatelliteOrbitalData(rt: AppRuntime): Promise<string> {
  const customUrl = resolveCustomTLEUrl();
  if (customUrl) {
    const result = await acquireCustomTLEUrl(customUrl);
    const enabledIds: ChipCatalogId[] = ['starlink'];
    const merged: MergedCatalog = {
      tles: result.tles,
      segments: result.tles.length > 0 ? [{ tles: result.tles, groupId: 1 }] : [],
      groupCounts: result.tles.length > 0 ? new Map([[1, result.tles.length]]) : new Map(),
      meta: {
        catalogs: [result.meta],
        epoch: result.meta.epoch,
        totalRealCount: result.tles.length,
      },
    };
    return applyMergedCatalog(rt, merged, enabledIds, false);
  }

  const enabledIds = readSavedConstellationSelection();
  const merged = await composeConstellationCatalog(enabledIds);
  return applyMergedCatalog(rt, merged, enabledIds, false);
}

/** Apply multi-constellation chip selection at runtime. */
export async function applyConstellationSelection(
  rt: AppRuntime,
  enabledIds: readonly ChipCatalogId[],
): Promise<string> {
  console.log(`[GrokZephyr] Constellation selection: ${enabledIds.join(', ') || 'procedural'}`);
  if (enabledIds.length === 0) {
    const merged = composeProceduralCatalog();
    return applyMergedCatalog(rt, merged, enabledIds, true);
  }
  const merged = await composeConstellationCatalog(enabledIds);
  return applyMergedCatalog(rt, merged, enabledIds, true);
}

/** Toggle a constellation group's visibility without rebuilding buffers. */
export function toggleConstellationGroup(rt: AppRuntime, groupId: number, visible: boolean): void {
  rt.buffers?.setGroupVisibility(groupId, visible);
  if (groupId >= 0 && groupId < rt.webglGroupVisibility.length) {
    rt.webglGroupVisibility[groupId] = visible;
  }
  rt.webglRenderer?.setGroupVisibility(groupId, visible);
}

/** @deprecated Use applyConstellationSelection instead. */
export async function switchTLECatalog(
  rt: AppRuntime,
  catalogId: ChipCatalogId,
): Promise<string> {
  return applyConstellationSelection(rt, [catalogId]);
}

export function formatTleHudEpoch(meta: { epoch: Date | null } | null): string {
  if (!meta?.epoch) return '—';
  return `${formatTLEEpoch(meta.epoch)} (${formatEpochAge(meta.epoch)} old)`;
}

export function formatTleHudFetchAge(meta: { fetchedAt: number | null; source?: string } | null): string {
  if (!meta) return '—';
  if (meta.fetchedAt === null) return 'bundled file';
  const age = formatEpochAge(new Date(meta.fetchedAt));
  return `${age} ago (${meta.source ?? 'unknown'})`;
}
