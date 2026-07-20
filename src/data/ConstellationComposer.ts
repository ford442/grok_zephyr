/**
 * Merge multiple TLE catalogs into a single 1M-slot buffer with group assignments.
 */

import {
  CHIP_CATALOG_IDS,
  getGroupIdForCatalog,
  type ChipCatalogId,
} from '@/data/ConstellationGroups.js';
import {
  acquireTLECatalog,
  deriveCatalogEpoch,
  type TLECatalogMeta,
  type TLECatalogResult,
} from '@/data/TLESource.js';
import type { MergedCatalogSegment } from '@/core/OrbitalElements.js';
import type { TLEData } from '@/types/index.js';

export interface MultiCatalogMeta {
  catalogs: TLECatalogMeta[];
  epoch: Date | null;
  totalRealCount: number;
}

export interface MergedCatalog {
  tles: TLEData[];
  segments: MergedCatalogSegment[];
  groupCounts: Map<number, number>;
  meta: MultiCatalogMeta;
}

/** Fetch and merge enabled constellation catalogs in registry order. */
export async function composeConstellationCatalog(
  enabledCatalogIds: readonly ChipCatalogId[],
): Promise<MergedCatalog> {
  const orderedIds = CHIP_CATALOG_IDS.filter((id) => enabledCatalogIds.includes(id));
  const segments: MergedCatalogSegment[] = [];
  const mergedTles: TLEData[] = [];
  const groupCounts = new Map<number, number>();
  const catalogMetas: TLECatalogMeta[] = [];

  for (const catalogId of orderedIds) {
    const result: TLECatalogResult = await acquireTLECatalog(catalogId);
    catalogMetas.push(result.meta);
    const groupId = getGroupIdForCatalog(catalogId);
    if (result.tles.length === 0) continue;

    segments.push({ tles: result.tles, groupId });
    mergedTles.push(...result.tles);
    groupCounts.set(groupId, (groupCounts.get(groupId) ?? 0) + result.tles.length);
  }

  const epochs = catalogMetas
    .map((m) => m.epoch?.getTime() ?? null)
    .filter((t): t is number => t !== null);
  epochs.sort((a, b) => a - b);
  const epoch =
    epochs.length > 0 ? new Date(epochs[Math.floor(epochs.length / 2)]) : deriveCatalogEpoch(mergedTles);

  return {
    tles: mergedTles,
    segments,
    groupCounts,
    meta: {
      catalogs: catalogMetas,
      epoch,
      totalRealCount: mergedTles.length,
    },
  };
}

/** Procedural-only catalog (no TLE segments). */
export function composeProceduralCatalog(): MergedCatalog {
  return {
    tles: [],
    segments: [],
    groupCounts: new Map(),
    meta: {
      catalogs: [],
      epoch: null,
      totalRealCount: 0,
    },
  };
}
