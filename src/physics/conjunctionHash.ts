/**
 * Spatial hash for close-approach detection — CPU reference.
 *
 * This is the authority for the hash: `src/shaders/compute/conjunction.ts`
 * reimplements `cellCoord` and `hashCell` in WGSL and must stay bit-identical,
 * which is what the tests pin. Running the whole search on the CPU also gives
 * the pass a checkable definition of "how many pairs should there be", without
 * needing a GPU in Node.
 *
 * Cell size is the threshold distance, so a pair within the threshold is always
 * either in the same cell or in one of the 26 neighbours.
 */

import { CONJUNCTION_BUCKET_CAPACITY, conjunctionBucketCount } from '@/types/conjunction.js';

/** Body-frame cell coordinate for a position, in kilometres. */
export function cellCoord(x: number, y: number, z: number, cellKm: number): [number, number, number] {
  return [Math.floor(x / cellKm), Math.floor(y / cellKm), Math.floor(z / cellKm)];
}

/**
 * Cell coordinate → bucket. The three large primes are the standard Teschner
 * spatial-hash constants; `Math.imul` and `>>> 0` reproduce WGSL's wrapping u32
 * multiply exactly, which is the whole point of this being shared.
 */
export function hashCell(cx: number, cy: number, cz: number, buckets: number): number {
  const h =
    (Math.imul(cx | 0, 73856093) ^ Math.imul(cy | 0, 19349663) ^ Math.imul(cz | 0, 83492791)) >>> 0;
  return h & (buckets - 1);
}

export interface ClosePair {
  a: number;
  b: number;
  distanceKm: number;
}

export interface ClosePairResult {
  pairs: ClosePair[];
  /** Satellites a full bucket refused. Non-zero means the view under-reports. */
  dropped: number;
  /** True once the pair cap was hit, so the count is a floor, not a total. */
  pairsTruncated: boolean;
}

export interface ClosePairOptions {
  /** Satellites to scan (defaults to every position supplied). */
  scanCount?: number;
  /** Stop after this many pairs, mirroring the GPU pair buffer cap. */
  maxPairs?: number;
  /** Model the GPU's fixed per-bucket capacity, including its dropped overflow. */
  bucketCapacity?: number;
}

/**
 * Close pairs among `positions` (packed vec4: x, y, z, w — w ignored).
 *
 * Skips the two sentinel states the GPU pass also skips: an exactly-zero
 * position (growth-era satellite not yet launched) and a negative w flag
 * (decayed). Emits each unordered pair once, as a < b.
 */
export function findClosePairs(
  positions: Float32Array,
  count: number,
  thresholdKm: number,
  options: ClosePairOptions = {},
): ClosePairResult {
  const scanCount = Math.min(options.scanCount ?? count, count);
  const maxPairs = options.maxPairs ?? Number.MAX_SAFE_INTEGER;
  const capacity = options.bucketCapacity ?? CONJUNCTION_BUCKET_CAPACITY;
  const buckets = conjunctionBucketCount(scanCount);
  const cellKm = Math.max(thresholdKm, 1e-6);

  const counts = new Uint32Array(buckets);
  const table = new Int32Array(buckets * capacity).fill(-1);
  let dropped = 0;

  const active = (i: number): boolean => {
    const x = positions[i * 4];
    const y = positions[i * 4 + 1];
    const z = positions[i * 4 + 2];
    const w = positions[i * 4 + 3];
    if (w < 0) return false;
    return x !== 0 || y !== 0 || z !== 0;
  };

  for (let i = 0; i < scanCount; i++) {
    if (!active(i)) continue;
    const [cx, cy, cz] = cellCoord(
      positions[i * 4],
      positions[i * 4 + 1],
      positions[i * 4 + 2],
      cellKm,
    );
    const bucket = hashCell(cx, cy, cz, buckets);
    const slot = counts[bucket];
    // Overflow is dropped, exactly as the GPU pass drops it, and counted so the
    // caller can say the view is saturated instead of quietly showing fewer.
    if (slot < capacity) table[bucket * capacity + slot] = i;
    else dropped++;
    counts[bucket] = slot + 1;
  }

  const pairs: ClosePair[] = [];
  const thresholdSq = thresholdKm * thresholdKm;

  for (let i = 0; i < scanCount && pairs.length < maxPairs; i++) {
    if (!active(i)) continue;
    const ax = positions[i * 4];
    const ay = positions[i * 4 + 1];
    const az = positions[i * 4 + 2];
    const [cx, cy, cz] = cellCoord(ax, ay, az, cellKm);

    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          const nz = cz + dz;
          const bucket = hashCell(nx, ny, nz, buckets);
          const filled = Math.min(counts[bucket], capacity);
          for (let s = 0; s < filled; s++) {
            const j = table[bucket * capacity + s];
            // a < b emits each unordered pair once and skips self-pairing.
            if (j <= i) continue;
            // Two different neighbour cells can hash to one bucket. Without
            // this check such a collision would emit the same pair twice (once
            // per colliding cell), so confirm j really lives in the cell being
            // visited before considering it.
            const [jx, jy, jz] = cellCoord(
              positions[j * 4],
              positions[j * 4 + 1],
              positions[j * 4 + 2],
              cellKm,
            );
            if (jx !== nx || jy !== ny || jz !== nz) continue;
            const dxk = positions[j * 4] - ax;
            const dyk = positions[j * 4 + 1] - ay;
            const dzk = positions[j * 4 + 2] - az;
            const d2 = dxk * dxk + dyk * dyk + dzk * dzk;
            if (d2 > thresholdSq) continue;
            pairs.push({ a: i, b: j, distanceKm: Math.sqrt(d2) });
            if (pairs.length >= maxPairs) return { pairs, dropped, pairsTruncated: true };
          }
        }
      }
    }
  }
  return { pairs, dropped, pairsTruncated: false };
}
