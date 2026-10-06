/**
 * Spatial hash for close-approach detection — CPU reference.
 *
 * This is the authority for the hash: `src/shaders/compute/conjunction.wgsl`
 * reimplements `cellCoord` and `hashCell` in WGSL and must stay bit-identical,
 * which is what the tests pin. Running the whole search on the CPU also gives
 * the pass a checkable definition of "how many pairs should there be", without
 * needing a GPU in Node.
 *
 * Cell size is the threshold distance, so a pair within the threshold is always
 * either in the same cell or in one of the 26 neighbours.
 *
 * The table is a counting sort, not fixed-capacity buckets: count satellites
 * per bucket, exclusive prefix-sum the counts into offsets, scatter each index
 * into one dense array. No bucket can fill, so nothing is dropped and the scan
 * covers the whole fleet. `exclusiveScanBlocked` mirrors the GPU's three scan
 * dispatches (conjunctionScan*.wgsl).
 */

import { CONJUNCTION_SCAN_BLOCK, conjunctionBucketCount } from '@/types/conjunction.js';

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

/**
 * Exclusive prefix sum, structured as the GPU runs it: scan each block of
 * `blockSize` independently (`scan_blocks`), scan the block totals
 * (`scan_block_sums`), then add each block's base back (`add_block_offsets`).
 * The result equals a plain sequential exclusive scan; the tests pin that.
 */
export function exclusiveScanBlocked(
  counts: Uint32Array,
  blockSize: number = CONJUNCTION_SCAN_BLOCK,
): Uint32Array {
  const n = counts.length;
  const out = new Uint32Array(n);
  const blocks = Math.ceil(n / blockSize);
  const blockSums = new Uint32Array(blocks);

  for (let b = 0; b < blocks; b++) {
    let running = 0;
    const end = Math.min(n, (b + 1) * blockSize);
    for (let i = b * blockSize; i < end; i++) {
      out[i] = running;
      running += counts[i];
    }
    blockSums[b] = running;
  }

  let base = 0;
  for (let b = 0; b < blocks; b++) {
    const total = blockSums[b];
    blockSums[b] = base;
    base += total;
  }

  for (let i = 0; i < n; i++) out[i] += blockSums[Math.floor(i / blockSize)];
  return out;
}

export interface ClosePair {
  a: number;
  b: number;
  distanceKm: number;
}

export interface ClosePairResult {
  pairs: ClosePair[];
  /** Active satellites hashed into the table (unlaunched / decayed skipped). */
  binned: number;
  /** True once the pair cap was hit, so the count is a floor, not a total. */
  pairsTruncated: boolean;
}

export interface ClosePairOptions {
  /** Satellites to scan (defaults to every position supplied). */
  scanCount?: number;
  /** Stop after this many pairs, mirroring the GPU pair buffer cap. */
  maxPairs?: number;
  /** Override the table size (power of two) — tests use it to force collisions. */
  buckets?: number;
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
  const buckets = options.buckets ?? conjunctionBucketCount(scanCount);
  const cellKm = Math.max(thresholdKm, 1e-6);

  const active = (i: number): boolean => {
    const x = positions[i * 4];
    const y = positions[i * 4 + 1];
    const z = positions[i * 4 + 2];
    const w = positions[i * 4 + 3];
    if (w < 0) return false;
    return x !== 0 || y !== 0 || z !== 0;
  };
  const bucketOf = (i: number): number => {
    const [cx, cy, cz] = cellCoord(
      positions[i * 4],
      positions[i * 4 + 1],
      positions[i * 4 + 2],
      cellKm,
    );
    return hashCell(cx, cy, cz, buckets);
  };

  // count_sats
  const counts = new Uint32Array(buckets);
  let binned = 0;
  for (let i = 0; i < scanCount; i++) {
    if (!active(i)) continue;
    counts[bucketOf(i)]++;
    binned++;
  }

  // scan_blocks / scan_block_sums / add_block_offsets
  const starts = exclusiveScanBlocked(counts);

  // scatter_sats. The GPU's atomic cursor leaves `offsets` at each bucket's
  // end; the order inside a bucket differs, but the set it holds does not.
  const cursor = starts.slice();
  const sorted = new Uint32Array(Math.max(1, binned));
  for (let i = 0; i < scanCount; i++) {
    if (!active(i)) continue;
    sorted[cursor[bucketOf(i)]++] = i;
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
          const start = starts[bucket];
          const end = start + counts[bucket];
          for (let s = start; s < end; s++) {
            const j = sorted[s];
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
            if (pairs.length >= maxPairs) return { pairs, binned, pairsTruncated: true };
          }
        }
      }
    }
  }
  return { pairs, binned, pairsTruncated: false };
}
