/**
 * TLE catalog acquisition with IndexedDB caching and CelesTrak fetch policy.
 *
 * Policy:
 * - Serve cache when younger than 24 hours
 * - When stale or missing, fetch once per browser session per group
 * - Stale cache is returned immediately while a background refresh runs
 * - Network failures fall back to the bundled sample file
 */

import { getSimWorkerClient } from '@/workers/SimWorkerClient.js';
import type { TLEData } from '@/types/index.js';

export type TLECatalogId = 'starlink' | 'oneweb' | 'gnss' | 'stations' | 'active' | 'sample';

export interface TLECatalogDef {
  id: TLECatalogId;
  label: string;
  celestrakGroup?: string;
  bundledPath?: string;
}

export const TLE_CATALOGS: readonly TLECatalogDef[] = [
  { id: 'starlink', label: 'Starlink', celestrakGroup: 'starlink' },
  { id: 'oneweb', label: 'OneWeb', celestrakGroup: 'oneweb' },
  { id: 'gnss', label: 'GNSS', celestrakGroup: 'gnss' },
  { id: 'stations', label: 'Stations', celestrakGroup: 'stations' },
  { id: 'active', label: 'Active Catalog', celestrakGroup: 'active' },
  { id: 'sample', label: 'Bundled Sample', bundledPath: '/tle/starlink_sample.txt' },
] as const;

export const BUNDLED_TLE_PATH = '/tle/starlink_sample.txt';
export const TLE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const TLE_CATALOG_STORAGE_KEY = 'zephyr.tleCatalog';

const DB_NAME = 'grok-zephyr-tle';
const DB_VERSION = 1;
const STORE_NAME = 'catalog-cache';

export type TLEAcquireSource = 'network' | 'cache' | 'bundled' | 'bundled-fallback';

export interface TLECatalogMeta {
  catalogId: TLECatalogId;
  label: string;
  objectCount: number;
  fetchedAt: number | null;
  epoch: Date | null;
  source: TLEAcquireSource;
}

export interface TLECatalogResult {
  tles: TLEData[];
  meta: TLECatalogMeta;
}

interface TLECacheRecord {
  key: string;
  text: string;
  fetchedAt: number;
}

const sessionFetchedGroups = new Set<string>();
let memoryCache: Map<string, TLECacheRecord> | null = null;

function getMemoryCache(): Map<string, TLECacheRecord> {
  if (!memoryCache) {
    memoryCache = new Map();
  }
  return memoryCache;
}

export function getCatalogDef(id: TLECatalogId): TLECatalogDef {
  const def = TLE_CATALOGS.find((entry) => entry.id === id);
  if (!def) {
    throw new Error(`Unknown TLE catalog: ${id}`);
  }
  return def;
}

export function isTLECatalogId(value: string): value is TLECatalogId {
  return TLE_CATALOGS.some((entry) => entry.id === value);
}

export function parseTLEEpoch(line1: string): Date | null {
  if (!line1.startsWith('1 ')) return null;

  const epochStr = line1.substring(18, 32).trim();
  if (!epochStr) return null;

  const year2 = Number.parseInt(epochStr.substring(0, 2), 10);
  const dayOfYear = Number.parseFloat(epochStr.substring(2));
  if (!Number.isFinite(year2) || !Number.isFinite(dayOfYear) || dayOfYear <= 0) {
    return null;
  }

  const year = year2 >= 57 ? 1900 + year2 : 2000 + year2;
  const wholeDay = Math.floor(dayOfYear);
  const fraction = dayOfYear - wholeDay;
  const epoch = new Date(Date.UTC(year, 0, 1));
  epoch.setUTCDate(epoch.getUTCDate() + wholeDay - 1);
  epoch.setTime(epoch.getTime() + fraction * 86_400_000);
  return epoch;
}

export function deriveCatalogEpoch(tles: TLEData[]): Date | null {
  const epochs: number[] = [];
  for (const tle of tles) {
    const epoch = parseTLEEpoch(tle.line1);
    if (epoch) {
      epochs.push(epoch.getTime());
    }
  }
  if (epochs.length === 0) return null;
  epochs.sort((a, b) => a - b);
  return new Date(epochs[Math.floor(epochs.length / 2)]);
}

export function formatTLEEpoch(epoch: Date | null): string {
  if (!epoch) return '—';
  return epoch.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

export function formatDataAge(fetchedAt: number | null, now = Date.now()): string {
  if (fetchedAt === null) return 'bundled';
  const ageMs = Math.max(0, now - fetchedAt);
  const minutes = ageMs / 60_000;
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(1)}h ago`;
  return `${(hours / 24).toFixed(1)}d ago`;
}

export function formatEpochAge(epoch: Date | null, now = Date.now()): string {
  if (!epoch) return '—';
  const ageMs = Math.max(0, now - epoch.getTime());
  const days = ageMs / 86_400_000;
  if (days < 1) return `${(days * 24).toFixed(1)}h`;
  return `${days.toFixed(1)}d`;
}

function openCacheDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);

  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function readCache(key: string): Promise<TLECacheRecord | null> {
  const db = await openCacheDb();
  if (!db) {
    return getMemoryCache().get(key) ?? null;
  }

  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => resolve((request.result as TLECacheRecord | undefined) ?? null);
    request.onerror = () => resolve(getMemoryCache().get(key) ?? null);
  });
}

async function writeCache(record: TLECacheRecord): Promise<void> {
  getMemoryCache().set(record.key, record);
  const db = await openCacheDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.objectStore(STORE_NAME).put(record);
  });
}

async function parseTLEText(text: string): Promise<TLEData[]> {
  return getSimWorkerClient().parseTLE(text);
}

function celestrakUrl(group: string): string {
  return `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=tle`;
}

async function fetchTLEText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch TLE data (${response.status} ${response.statusText})`);
  }
  return response.text();
}

async function loadBundledSample(): Promise<{ text: string; fetchedAt: number | null }> {
  const text = await fetchTLEText(BUNDLED_TLE_PATH);
  return { text, fetchedAt: null };
}

function buildMeta(
  catalogId: TLECatalogId,
  tles: TLEData[],
  fetchedAt: number | null,
  source: TLEAcquireSource,
): TLECatalogMeta {
  const def = getCatalogDef(catalogId);
  return {
    catalogId,
    label: def.label,
    objectCount: tles.length,
    fetchedAt,
    epoch: deriveCatalogEpoch(tles),
    source,
  };
}

async function fetchAndCacheCatalog(
  cacheKey: string,
  url: string,
): Promise<{ text: string; fetchedAt: number }> {
  const text = await fetchTLEText(url);
  const fetchedAt = Date.now();
  await writeCache({ key: cacheKey, text, fetchedAt });
  sessionFetchedGroups.add(cacheKey);
  return { text, fetchedAt };
}

function scheduleBackgroundRefresh(
  cacheKey: string,
  url: string,
  onUpdated?: (result: TLECatalogResult) => void,
  catalogId?: TLECatalogId,
): void {
  if (sessionFetchedGroups.has(cacheKey)) return;
  sessionFetchedGroups.add(cacheKey);

  void (async () => {
    try {
      const { text, fetchedAt } = await fetchAndCacheCatalog(cacheKey, url);
      const tles = await parseTLEText(text);
      if (tles.length === 0 || !catalogId || !onUpdated) return;
      onUpdated({
        tles,
        meta: buildMeta(catalogId, tles, fetchedAt, 'network'),
      });
    } catch (err) {
      console.warn(`[GrokZephyr] Background TLE refresh failed for ${cacheKey}:`, err);
    }
  })();
}

async function acquireBundledCatalog(catalogId: TLECatalogId): Promise<TLECatalogResult> {
  const { text, fetchedAt } = await loadBundledSample();
  const tles = await parseTLEText(text);
  return {
    tles,
    meta: buildMeta(catalogId, tles, fetchedAt, 'bundled'),
  };
}

async function acquireNetworkCatalog(
  catalogId: TLECatalogId,
  onUpdated?: (result: TLECatalogResult) => void,
): Promise<TLECatalogResult> {
  const def = getCatalogDef(catalogId);
  const cacheKey = def.celestrakGroup ?? catalogId;
  const url = celestrakUrl(def.celestrakGroup!);
  const cached = await readCache(cacheKey);
  const cacheAge = cached ? Date.now() - cached.fetchedAt : Number.POSITIVE_INFINITY;
  const alreadyFetchedThisSession = sessionFetchedGroups.has(cacheKey);

  if (cached && cacheAge < TLE_CACHE_MAX_AGE_MS) {
    const tles = await parseTLEText(cached.text);
    return {
      tles,
      meta: buildMeta(catalogId, tles, cached.fetchedAt, 'cache'),
    };
  }

  if (cached) {
    const tles = await parseTLEText(cached.text);
    const result: TLECatalogResult = {
      tles,
      meta: buildMeta(catalogId, tles, cached.fetchedAt, 'cache'),
    };

    if (!alreadyFetchedThisSession) {
      scheduleBackgroundRefresh(cacheKey, url, onUpdated, catalogId);
    }
    return result;
  }

  if (alreadyFetchedThisSession) {
    const fallback = await acquireBundledCatalog(catalogId);
    return {
      ...fallback,
      meta: { ...fallback.meta, source: 'bundled-fallback' },
    };
  }

  try {
    const { text, fetchedAt } = await fetchAndCacheCatalog(cacheKey, url);
    const tles = await parseTLEText(text);
    if (tles.length === 0) {
      throw new Error('CelesTrak returned 0 TLE records');
    }
    return {
      tles,
      meta: buildMeta(catalogId, tles, fetchedAt, 'network'),
    };
  } catch (err) {
    sessionFetchedGroups.add(cacheKey);
    console.warn(`[GrokZephyr] TLE network fetch failed for ${catalogId}, using bundled sample:`, err);
    const fallback = await acquireBundledCatalog(catalogId);
    return {
      ...fallback,
      meta: { ...fallback.meta, source: 'bundled-fallback' },
    };
  }
}

export async function acquireTLECatalog(
  catalogId: TLECatalogId,
  onUpdated?: (result: TLECatalogResult) => void,
): Promise<TLECatalogResult> {
  if (catalogId === 'sample') {
    return acquireBundledCatalog(catalogId);
  }
  return acquireNetworkCatalog(catalogId, onUpdated);
}

export async function acquireCustomTLEUrl(url: string): Promise<TLECatalogResult> {
  try {
    const text = await fetchTLEText(url);
    const tles = await parseTLEText(text);
    return {
      tles,
      meta: {
        catalogId: 'sample',
        label: 'Custom URL',
        objectCount: tles.length,
        fetchedAt: Date.now(),
        epoch: deriveCatalogEpoch(tles),
        source: 'network',
      },
    };
  } catch (err) {
    console.warn('[GrokZephyr] Custom TLE URL failed, using bundled sample:', err);
    const fallback = await acquireBundledCatalog('sample');
    return {
      ...fallback,
      meta: { ...fallback.meta, label: 'Custom URL (fallback)', source: 'bundled-fallback' },
    };
  }
}

export function readSavedCatalogId(): TLECatalogId {
  try {
    const stored = localStorage.getItem(TLE_CATALOG_STORAGE_KEY);
    if (stored && isTLECatalogId(stored)) {
      return stored;
    }
  } catch {
    // localStorage may be unavailable; ignore persistence failures.
  }
  return 'starlink';
}

export function saveCatalogId(catalogId: TLECatalogId): void {
  try {
    localStorage.setItem(TLE_CATALOG_STORAGE_KEY, catalogId);
  } catch {
    // localStorage may be unavailable; ignore persistence failures.
  }
}

export function formatCatalogOptionLabel(
  def: TLECatalogDef,
  meta?: Pick<TLECatalogMeta, 'objectCount' | 'fetchedAt'> | null,
): string {
  if (!meta || meta.objectCount <= 0) {
    return def.label;
  }
  const age = formatDataAge(meta.fetchedAt);
  return `${def.label} (${meta.objectCount.toLocaleString()} · ${age})`;
}

/** Reset session fetch tracking — intended for tests only. */
export function resetTLESessionCacheForTests(): void {
  sessionFetchedGroups.clear();
  memoryCache = null;
}

/** Legacy CelesTrak shorthand map kept for ?tle= URL compatibility. */
export const CELESTRAK_GROUPS: Record<string, string> = {
  starlink: 'starlink',
  oneweb: 'oneweb',
  iridium: 'iridium',
  'iridium-next': 'iridium-NEXT',
  gps: 'gps-ops',
  galileo: 'galileo',
  gnss: 'gnss',
  stations: 'stations',
  active: 'active',
};

export function catalogIdFromCelesTrakShorthand(value: string): TLECatalogId | null {
  const lower = value.toLowerCase();
  if (isTLECatalogId(lower)) {
    return lower;
  }
  if (lower in CELESTRAK_GROUPS && isTLECatalogId(CELESTRAK_GROUPS[lower])) {
    return CELESTRAK_GROUPS[lower];
  }
  return null;
}

export function resolveCustomTLEUrl(search: string = window.location.search): string | null {
  const params = new URLSearchParams(search);
  const tleParam = params.get('tle');
  if (!tleParam) return null;
  if (tleParam.startsWith('http://') || tleParam.startsWith('https://')) {
    return tleParam;
  }
  return null;
}

/** Resolve the active catalog id from URL + localStorage. */
export function resolveActiveCatalogId(search: string = window.location.search): TLECatalogId {
  const params = new URLSearchParams(search);
  const tleParam = params.get('tle');
  if (tleParam) {
    const fromShorthand = catalogIdFromCelesTrakShorthand(tleParam);
    if (fromShorthand) {
      saveCatalogId(fromShorthand);
      return fromShorthand;
    }
  }
  return readSavedCatalogId();
}

/** @deprecated Use resolveActiveCatalogId + acquireTLECatalog instead. */
export function getTLESource(search: string = window.location.search): string | null {
  const custom = resolveCustomTLEUrl(search);
  if (custom) return custom;

  const catalogId = resolveActiveCatalogId(search);
  if (catalogId === 'sample') {
    return BUNDLED_TLE_PATH;
  }

  const group = CELESTRAK_GROUPS[catalogId] ?? catalogId;
  return celestrakUrl(group);
}

export function resolveTLESource(params: URLSearchParams): string | null {
  return getTLESource(`?${params.toString()}`);
}
