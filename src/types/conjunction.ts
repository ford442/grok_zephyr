/**
 * Close-approach ("conjunction") visualization — buffer sizing and budget.
 *
 * This is a congestion *visualization*, not SSA. See docs/CONJUNCTIONS.md for
 * what the numbers do and do not mean.
 *
 * Sizing is driven by the Pascal 128 MB storage cap: at a 1M fleet the existing
 * satellite buffers already reach it exactly (see calculateSatelliteBufferBudget),
 * so these buffers are allocated only when the feature is switched on, and only
 * when they fit in what is left.
 */

import { MAX_SAFE_BUFFER_SIZE } from '@/core/buffer/bufferTypes.js';

/** Hard cap on reported pairs. 4096 × 32 B = 128 KB. */
export const MAX_CONJUNCTION_PAIRS = 4096;

/** Bytes per emitted pair: two vec4f (position + metadata). */
export const CONJUNCTION_PAIR_BYTES = 32;

/**
 * Satellite indices stored per hash bucket. A bucket that fills drops the rest,
 * and dropped satellites are exactly the ones a congestion view cares about —
 * they are dropped because they are crowded. 8 keeps the largest table at 8 MB
 * while surviving realistic clusters; the pass reports its overflow count so a
 * saturated view is visible rather than silently thin.
 */
export const CONJUNCTION_BUCKET_CAPACITY = 8;

/** ConjunctionParams uniform. */
export const CONJUNCTION_PARAM_BYTES = 32;

export const DEFAULT_CONJUNCTION_THRESHOLD_KM = 5;
export const MIN_CONJUNCTION_THRESHOLD_KM = 0.5;
export const MAX_CONJUNCTION_THRESHOLD_KM = 100;

/** Smallest and largest hash tables we will build. */
const MIN_BUCKETS = 1 << 12;
const MAX_BUCKETS = 1 << 18;

/**
 * Bucket count for a scan of `scanCount` satellites: the next power of two at
 * or above 2 × scanCount, so mean occupancy stays near 0.5 and bucket overflow
 * (which silently drops candidates) is rare. Clamped at 2^18 = 262,144 buckets,
 * which is where the table stops fitting the storage budget.
 */
export function conjunctionBucketCount(scanCount: number): number {
  const target = Math.max(1, scanCount) * 2;
  let buckets = MIN_BUCKETS;
  while (buckets < target && buckets < MAX_BUCKETS) buckets <<= 1;
  return buckets;
}

/**
 * How many satellites a scan can cover before the hash table saturates. Above
 * this the pass scans a prefix of the fleet and the HUD must say so — a strided
 * sample would be worse, since it can split a close pair across the sample
 * boundary and report zero.
 */
export function conjunctionScanLimit(fleetSize: number): number {
  return Math.min(fleetSize, MAX_BUCKETS / 2);
}

/** Total storage bytes the pass allocates for a given scan size. */
export function conjunctionBufferBytes(scanCount: number): number {
  const buckets = conjunctionBucketCount(scanCount);
  const counts = buckets * 4;
  const indices = buckets * CONJUNCTION_BUCKET_CAPACITY * 4;
  const pairs = MAX_CONJUNCTION_PAIRS * CONJUNCTION_PAIR_BYTES;
  const pairCounter = 16;
  return counts + indices + pairs + pairCounter;
}

/**
 * Whether the pass fits alongside `satelliteBufferBytes` already allocated.
 * At a 1M fleet the answer is no on a 128 MB-capped adapter — the caller is
 * expected to say so rather than allocate and trip assertBufferBudget.
 */
export function conjunctionsFitBudget(
  satelliteBufferBytes: number,
  fleetSize: number,
): { fits: boolean; needBytes: number; freeBytes: number } {
  const needBytes = conjunctionBufferBytes(conjunctionScanLimit(fleetSize));
  const freeBytes = MAX_SAFE_BUFFER_SIZE - satelliteBufferBytes;
  return { fits: needBytes <= freeBytes, needBytes, freeBytes };
}
