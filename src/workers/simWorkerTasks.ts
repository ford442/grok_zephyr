/**
 * CPU-heavy simulation tasks shared by the worker and main-thread fallback.
 */

import { OrbitalElements } from '@/core/OrbitalElements.js';
import { TLELoader } from '@/data/TLELoader.js';
import type { MergedCatalogSegment } from '@/core/OrbitalElements.js';
import type { TLEData } from '@/types/index.js';
import type { OrbitalElementsResult } from '@/workers/simWorkerTypes.js';

/** Detach orbital element bytes for transferable postMessage. */
function detachOrbitalBuffer(data: Float32Array): ArrayBuffer {
  const bytes = data.byteLength;
  const copy = new Uint8Array(bytes);
  copy.set(new Uint8Array(data.buffer, data.byteOffset, bytes));
  return copy.buffer;
}

export function taskParseTle(text: string): TLEData[] {
  return TLELoader.parse(text);
}

export async function taskFetchParseTle(url: string): Promise<TLEData[]> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch TLE data (${response.status} ${response.statusText})`);
  }
  return TLELoader.parse(await response.text());
}

function detachUint32Buffer(data: Uint32Array): ArrayBuffer {
  const bytes = data.byteLength;
  const copy = new Uint8Array(bytes);
  copy.set(new Uint8Array(data.buffer, data.byteOffset, bytes));
  return copy.buffer;
}

export function taskGenerateElements(
  numSatellites: number,
  seed?: number,
): OrbitalElementsResult {
  const orbital = new OrbitalElements(numSatellites);
  orbital.generate(seed);
  const groupIds = new Uint32Array(numSatellites);
  return {
    orbitalBuffer: detachOrbitalBuffer(orbital.data),
    groupIdsBuffer: detachUint32Buffer(groupIds),
    numSatellites,
    realTleCount: 0,
  };
}

export function taskMergeCatalogElements(
  segments: MergedCatalogSegment[],
  numSatellites: number,
): OrbitalElementsResult {
  const orbital = new OrbitalElements(numSatellites);
  const { realTleCount, groupCounts } = orbital.loadMergedTleSegments(segments);
  const groupIds = orbital.buildGroupIdsForMerged(segments);
  return {
    orbitalBuffer: detachOrbitalBuffer(orbital.data),
    groupIdsBuffer: detachUint32Buffer(groupIds),
    numSatellites,
    realTleCount,
    groupCounts,
  };
}

export function taskDeriveElementsFromTle(
  tles: TLEData[],
  numSatellites: number,
): OrbitalElementsResult {
  const orbital = new OrbitalElements(numSatellites);
  const realTleCount = orbital.loadFromTLE(tles);
  const groupIds = new Uint32Array(numSatellites);
  if (realTleCount > 0) {
    groupIds.fill(1, 0, realTleCount);
  }
  groupIds.fill(0, realTleCount, numSatellites);
  return {
    orbitalBuffer: detachOrbitalBuffer(orbital.data),
    groupIdsBuffer: detachUint32Buffer(groupIds),
    numSatellites,
    realTleCount,
  };
}
