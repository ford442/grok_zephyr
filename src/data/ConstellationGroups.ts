/**
 * Constellation group registry — per-group colors, size scales, and GPU uniform packing.
 */

import type { TLECatalogId } from '@/data/TLESource.js';

/** Maximum constellation groups supported by the GPU uniform array. */
export const MAX_GROUPS = 8;

/** Bytes per group in the GPU uniform buffer (32 bytes = 8 floats). */
export const GROUP_UNIFORM_STRIDE = 32;

/** Total group-params uniform size. */
export const GROUP_PARAMS_UNIFORM_SIZE = MAX_GROUPS * GROUP_UNIFORM_STRIDE;

/** Catalog ids exposed as toggleable constellation chips (excludes active/sample). */
export const CHIP_CATALOG_IDS = ['starlink', 'oneweb', 'gnss', 'stations'] as const;
export type ChipCatalogId = (typeof CHIP_CATALOG_IDS)[number];

export function isChipCatalogId(value: string): value is ChipCatalogId {
  return (CHIP_CATALOG_IDS as readonly string[]).includes(value);
}

export interface ConstellationGroupDef {
  groupId: number;
  catalogId: TLECatalogId | 'procedural';
  label: string;
  baseColor: [number, number, number];
  brightness: number;
  sizeScale: number;
  chipColor: string;
}

/** Fixed group registry — group 0 is procedural Walker padding. */
export const CONSTELLATION_GROUPS: readonly ConstellationGroupDef[] = [
  {
    groupId: 0,
    catalogId: 'procedural',
    label: 'Walker',
    baseColor: [1, 1, 1],
    brightness: 1,
    sizeScale: 1,
    chipColor: '#888888',
  },
  {
    groupId: 1,
    catalogId: 'starlink',
    label: 'Starlink',
    baseColor: [0.2, 0.85, 0.75],
    brightness: 1,
    sizeScale: 1,
    chipColor: '#33d9b8',
  },
  {
    groupId: 2,
    catalogId: 'oneweb',
    label: 'OneWeb',
    baseColor: [1.0, 0.72, 0.2],
    brightness: 1,
    sizeScale: 1,
    chipColor: '#ffb833',
  },
  {
    groupId: 3,
    catalogId: 'gnss',
    label: 'GNSS',
    baseColor: [0.65, 0.45, 1.0],
    brightness: 1,
    sizeScale: 1,
    chipColor: '#a673ff',
  },
  {
    groupId: 4,
    catalogId: 'stations',
    label: 'Stations',
    baseColor: [1, 1, 1],
    brightness: 1.1,
    sizeScale: 2.5,
    chipColor: '#ffffff',
  },
] as const;

export const CONSTELLATION_STORAGE_KEY = 'zephyr.constellations';

export function getGroupDef(groupId: number): ConstellationGroupDef | null {
  return CONSTELLATION_GROUPS.find((g) => g.groupId === groupId) ?? null;
}

export function getGroupDefByCatalog(catalogId: TLECatalogId): ConstellationGroupDef | null {
  return CONSTELLATION_GROUPS.find((g) => g.catalogId === catalogId) ?? null;
}

export function getGroupIdForCatalog(catalogId: TLECatalogId): number {
  return getGroupDefByCatalog(catalogId)?.groupId ?? 0;
}

/** Default chip selection for baseline parity (single Starlink catalog). */
export function defaultConstellationSelection(): ChipCatalogId[] {
  return ['starlink'];
}

export function readSavedConstellationSelection(): ChipCatalogId[] {
  try {
    const raw = localStorage.getItem(CONSTELLATION_STORAGE_KEY);
    if (!raw) return defaultConstellationSelection();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return defaultConstellationSelection();
    const ids = parsed.filter((v): v is ChipCatalogId => typeof v === 'string' && isChipCatalogId(v));
    return ids.length > 0 ? ids : defaultConstellationSelection();
  } catch {
    return defaultConstellationSelection();
  }
}

export function saveConstellationSelection(ids: readonly ChipCatalogId[]): void {
  try {
    localStorage.setItem(CONSTELLATION_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // localStorage may be unavailable
  }
}

export interface GroupVisibilityState {
  /** Per-group visibility (index = groupId). */
  visible: boolean[];
  /** When true, shader uses group baseColor instead of legacy shell palette. */
  multiGroupColorMode: boolean;
}

export function createDefaultVisibility(): GroupVisibilityState {
  return {
    visible: CONSTELLATION_GROUPS.map(() => true),
    multiGroupColorMode: false,
  };
}

/**
 * Determine whether multi-group coloring should be active.
 * Legacy path: exactly one TLE chip enabled → shell/sat_color palette.
 */
export function shouldUseMultiGroupColors(enabledCatalogIds: readonly ChipCatalogId[]): boolean {
  return enabledCatalogIds.length !== 1;
}

/**
 * Pack group parameters into a GPU uniform buffer.
 * Layout per group (32 bytes): baseColor(vec3f) + brightness(f32) + sizeScale(f32) + visible(f32) + pad(vec2f)
 * Slot 0 pad.x stores multiGroupColorMode as f32 (0 or 1).
 */
export function buildGroupParamsUniform(state: GroupVisibilityState): ArrayBuffer {
  const buffer = new ArrayBuffer(GROUP_PARAMS_UNIFORM_SIZE);
  const f32 = new Float32Array(buffer);

  for (const group of CONSTELLATION_GROUPS) {
    const base = group.groupId * 8;
    f32[base + 0] = group.baseColor[0];
    f32[base + 1] = group.baseColor[1];
    f32[base + 2] = group.baseColor[2];
    f32[base + 3] = group.brightness;
    f32[base + 4] = group.sizeScale;
    f32[base + 5] = state.visible[group.groupId] ? 1 : 0;
    if (group.groupId === 0) {
      f32[base + 6] = state.multiGroupColorMode ? 1 : 0;
    }
  }

  return buffer;
}

/** Format HUD legend: "Starlink 7,412 · OneWeb 634 · GNSS 31" */
export function formatGroupCountLegend(counts: ReadonlyMap<number, number>): string {
  const parts: string[] = [];
  for (const group of CONSTELLATION_GROUPS) {
    if (group.groupId === 0) continue;
    const count = counts.get(group.groupId) ?? 0;
    if (count > 0) {
      parts.push(`${group.label} ${count.toLocaleString()}`);
    }
  }
  return parts.join(' · ');
}
