/**
 * Close-approach ("conjunction") visualization — buffer sizing and budget.
 *
 * This is a congestion *visualization*, not SSA. See docs/CONJUNCTIONS.md for
 * what the numbers do and do not mean.
 *
 * Sizing is driven by the Pascal 128 MB storage cap: the satellite buffers take
 * ~84 MB at 1M (~116 MB with cinematic trail history; see
 * calculateSatelliteBufferBudget), so these buffers are allocated only when the
 * feature is switched on, and only when they fit in what is left.
 */

import { MAX_SAFE_BUFFER_SIZE } from '@/core/buffer/bufferTypes.js';

/** Hard cap on reported pairs. 4096 × 32 B = 128 KB. */
export const MAX_CONJUNCTION_PAIRS = 4096;

/** Bytes per emitted pair: two vec4f (position + metadata). */
export const CONJUNCTION_PAIR_BYTES = 32;

/**
 * Buckets per prefix-sum block: 256 threads × 4 counts. The scan is three
 * dispatches (blocks, block sums, add back), so one workgroup has to be able to
 * scan every block sum: 256 × 4 = 1024 sums × 1024 = 2^20 buckets, above
 * MAX_BUCKETS.
 */
export const CONJUNCTION_SCAN_BLOCK = 1024;

/**
 * Optional device feature the pass uses when present: a subgroup prefix-sum.
 * Requested by bootWebGPU only when `?ca=1` will run (features are frozen at
 * requestDevice — same rule as EARTH_MAP_OPTIONAL_FEATURES). Without it the
 * workgroup-memory scan gives the identical result.
 */
export const CONJUNCTION_OPTIONAL_FEATURES = ['subgroups'] as const satisfies readonly GPUFeatureName[];

/** ConjunctionParams uniform. */
export const CONJUNCTION_PARAM_BYTES = 32;

export const DEFAULT_CONJUNCTION_THRESHOLD_KM = 5;
export const MIN_CONJUNCTION_THRESHOLD_KM = 0.5;
export const MAX_CONJUNCTION_THRESHOLD_KM = 100;

/** Smallest and largest hash tables we will build. */
const MIN_BUCKETS = 1 << 12;
const MAX_BUCKETS = 1 << 19;

/**
 * Bucket count for a scan of `scanCount` satellites: the next power of two at
 * or above scanCount, so mean occupancy stays at or below 1 up to 512k and 2 at
 * 1M. Clamped at 2^19 = 524,288 buckets — the counting sort has no per-bucket
 * capacity, so a fuller table only costs a longer neighbour walk, never a
 * dropped satellite, while two 2 MB bucket arrays keep the pass inside the
 * ~12 MB cinematic 1M headroom.
 */
export function conjunctionBucketCount(scanCount: number): number {
  const target = Math.max(1, scanCount);
  let buckets = MIN_BUCKETS;
  while (buckets < target && buckets < MAX_BUCKETS) buckets <<= 1;
  return buckets;
}

/** Prefix-sum blocks for a table of `buckets`. */
export function conjunctionBlockCount(buckets: number): number {
  return Math.ceil(buckets / CONJUNCTION_SCAN_BLOCK);
}

/**
 * How many satellites a scan covers: the whole fleet. The counting sort stores
 * one index per satellite in a dense array, so there is no table saturation to
 * cap it. Kept as a function so the HUD and the allocator share one answer.
 */
export function conjunctionScanLimit(fleetSize: number): number {
  return fleetSize;
}

/** Total storage bytes the pass allocates for a given scan size. */
export function conjunctionBufferBytes(scanCount: number): number {
  const buckets = conjunctionBucketCount(scanCount);
  const counts = buckets * 4;
  const offsets = buckets * 4;
  const sorted = Math.max(1, scanCount) * 4;
  const blockSums = conjunctionBlockCount(buckets) * 4;
  const pairs = MAX_CONJUNCTION_PAIRS * CONJUNCTION_PAIR_BYTES;
  const counters = 16;
  return counts + offsets + sorted + blockSums + pairs + counters;
}

/**
 * Whether the pass fits alongside `satelliteBufferBytes` already allocated.
 * `satelliteBufferBytes` should be the allocated ledger (getMemoryUsage); when
 * it does not fit the caller reports the real free bytes rather than allocate
 * and trip assertBufferBudget.
 */
export function conjunctionsFitBudget(
  satelliteBufferBytes: number,
  fleetSize: number,
): { fits: boolean; needBytes: number; freeBytes: number } {
  const needBytes = conjunctionBufferBytes(conjunctionScanLimit(fleetSize));
  const freeBytes = MAX_SAFE_BUFFER_SIZE - satelliteBufferBytes;
  return { fits: needBytes <= freeBytes, needBytes, freeBytes };
}

/**
 * Dashboard row: how much of the fleet the hash covered against what the pass
 * cost. `binned` counts active satellites only, so unlaunched (growth era) and
 * decayed slots make it read below the fleet size — that is coverage of what
 * is in orbit, not a dropped scan.
 */
export function formatConjunctionCoverage(
  coverage: { binned: number; fleet: number } | null,
  passMs: number,
): string {
  if (!coverage) return 'off';
  return (
    `hashed ${coverage.binned.toLocaleString()}/${coverage.fleet.toLocaleString()} · ` +
    `${passMs.toFixed(2)} ms`
  );
}
