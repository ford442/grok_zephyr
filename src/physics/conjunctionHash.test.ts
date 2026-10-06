import { describe, expect, it } from 'vitest';
import { cellCoord, exclusiveScanBlocked, findClosePairs, hashCell } from './conjunctionHash.js';
import {
  CONJUNCTION_SCAN_BLOCK,
  conjunctionBlockCount,
  conjunctionBucketCount,
  conjunctionBufferBytes,
  conjunctionScanLimit,
  conjunctionsFitBudget,
  MAX_CONJUNCTION_PAIRS,
} from '@/types/conjunction.js';
import { calculateSatelliteBufferBudget } from '@/core/buffer/BufferAllocator.js';

/** Pack satellites as the GPU position buffer does: vec4 per satellite. */
function pack(sats: [number, number, number, number?][]): Float32Array {
  const out = new Float32Array(sats.length * 4);
  sats.forEach(([x, y, z, w], i) => {
    out.set([x, y, z, w ?? 1], i * 4);
  });
  return out;
}

/** Deterministic LCG so the randomised clouds are reproducible. */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Exhaustive O(n^2) reference, as sorted "a-b" keys. */
function bruteForcePairs(positions: Float32Array, n: number, threshold: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = positions[j * 4] - positions[i * 4];
      const dy = positions[j * 4 + 1] - positions[i * 4 + 1];
      const dz = positions[j * 4 + 2] - positions[i * 4 + 2];
      if (Math.hypot(dx, dy, dz) <= threshold) out.push(`${i}-${j}`);
    }
  }
  return out.sort();
}

const keys = (pairs: { a: number; b: number }[]): string[] => pairs.map((p) => `${p.a}-${p.b}`).sort();

describe('spatial hash', () => {
  it('floors to cell coordinates, including across the origin', () => {
    expect(cellCoord(0, 0, 0, 5)).toEqual([0, 0, 0]);
    expect(cellCoord(4.9, -0.1, 5.0, 5)).toEqual([0, -1, 1]);
    expect(cellCoord(-5, -5, -5, 5)).toEqual([-1, -1, -1]);
  });

  it('stays inside the table and is stable for a given cell', () => {
    const buckets = 4096;
    for (const c of [
      [0, 0, 0],
      [-1, -1, -1],
      [12345, -6789, 4242],
    ] as const) {
      const h = hashCell(c[0], c[1], c[2], buckets);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(buckets);
      expect(hashCell(c[0], c[1], c[2], buckets)).toBe(h);
    }
  });

  it('wraps u32 multiplication the way WGSL does', () => {
    // Large coordinates overflow 32 bits; the result must still be a valid
    // in-range bucket rather than NaN or a negative index.
    const h = hashCell(2 ** 20, -(2 ** 20), 2 ** 19, 1 << 18);
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(1 << 18);
  });
});

describe('findClosePairs', () => {
  it('finds one pair for two satellites 1 km apart', () => {
    const positions = pack([
      [7000, 0, 0],
      [7001, 0, 0],
    ]);
    const { pairs } = findClosePairs(positions, 2, 5);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ a: 0, b: 1 });
    expect(pairs[0].distanceKm).toBeCloseTo(1, 6);
  });

  it('finds no pairs for two satellites 1000 km apart', () => {
    const positions = pack([
      [7000, 0, 0],
      [8000, 0, 0],
    ]);
    expect(findClosePairs(positions, 2, 5).pairs).toHaveLength(0);
  });

  it('emits each unordered pair exactly once', () => {
    const positions = pack([
      [7000, 0, 0],
      [7000.5, 0, 0],
      [7001, 0, 0],
    ]);
    const { pairs } = findClosePairs(positions, 3, 5);
    expect(pairs).toHaveLength(3);
    expect(pairs.every((p) => p.a < p.b)).toBe(true);
    expect(new Set(pairs.map((p) => `${p.a}-${p.b}`)).size).toBe(3);
  });

  it('finds pairs that straddle a cell boundary', () => {
    // Cell size equals the threshold, so these two sit in adjacent cells and
    // are only found because the search covers the 26 neighbours.
    const positions = pack([
      [4.9, 0.0, 0.0],
      [5.1, 0.0, 0.0],
    ]);
    expect(findClosePairs(positions, 2, 5).pairs).toHaveLength(1);
  });

  it('is symmetric across the origin, where cell coordinates go negative', () => {
    const positions = pack([
      [-0.4, -0.4, -0.4],
      [0.4, 0.4, 0.4],
    ]);
    expect(findClosePairs(positions, 2, 5).pairs).toHaveLength(1);
  });

  it('raising the threshold cannot lose a pair it already found', () => {
    const positions = pack([
      [7000, 0, 0],
      [7003, 0, 0],
      [7050, 0, 0],
    ]);
    expect(findClosePairs(positions, 3, 1).pairs).toHaveLength(0);
    expect(findClosePairs(positions, 3, 5).pairs).toHaveLength(1);
    expect(findClosePairs(positions, 3, 100).pairs).toHaveLength(3);
  });

  it('skips unlaunched (zero position) and decayed (negative flag) satellites', () => {
    const positions = pack([
      [7000, 0, 0],
      [0, 0, 0], // growth-era: not launched yet
      [7000.5, 0, 0, -1], // decayed
      [7000.2, 0, 0],
    ]);
    const { pairs } = findClosePairs(positions, 4, 5);
    expect(pairs).toEqual([expect.objectContaining({ a: 0, b: 3 })]);
  });

  it('honours the pair cap the GPU buffer imposes', () => {
    const sats: [number, number, number][] = [];
    for (let i = 0; i < 40; i++) sats.push([7000 + i * 0.4, 0, 0]);
    const all = findClosePairs(pack(sats), sats.length, 5);
    expect(all.pairs.length).toBeGreaterThan(10);
    expect(all.pairsTruncated).toBe(false);

    const capped = findClosePairs(pack(sats), sats.length, 5, { maxPairs: 10 });
    expect(capped.pairs).toHaveLength(10);
    expect(capped.pairsTruncated).toBe(true);
  });

  it('never drops a dense cluster — every pair in one cell is found', () => {
    // 64 satellites inside one 5 km cell. The old fixed 8-slot buckets dropped
    // 56 of them; the counting sort has no capacity, so all C(64,2) appear.
    const sats: [number, number, number][] = [];
    for (let i = 0; i < 64; i++) sats.push([7000 + i * 0.01, 0, 0]);
    const positions = pack(sats);
    const result = findClosePairs(positions, sats.length, 5);
    expect(result.binned).toBe(64);
    expect(result.pairs).toHaveLength((64 * 63) / 2);
    expect(keys(result.pairs)).toEqual(bruteForcePairs(positions, 64, 5));
  });

  it('counts only active satellites as binned', () => {
    const positions = pack([
      [7000, 0, 0],
      [0, 0, 0],
      [7000.5, 0, 0, -1],
      [7000.2, 0, 0],
    ]);
    expect(findClosePairs(positions, 4, 5).binned).toBe(2);
  });

  it('agrees with brute force on a randomised cloud', () => {
    // The hash is only worth having if it finds what O(n^2) finds.
    const rand = lcg(12345);
    const n = 400;
    const sats: [number, number, number][] = [];
    for (let i = 0; i < n; i++) {
      sats.push([7000 + rand() * 40, rand() * 40, rand() * 40]);
    }
    const positions = pack(sats);
    const brute = bruteForcePairs(positions, n, 5);
    expect(keys(findClosePairs(positions, n, 5).pairs)).toEqual(brute);
    expect(brute.length).toBeGreaterThan(0);
  });

  it('agrees with brute force when a tiny table forces heavy hash collisions', () => {
    // 3,000 points in a 300 km cube over 64 buckets: ~47 satellites per bucket,
    // most of them from unrelated cells. The visited-cell check must reject
    // every collision without losing or doubling a pair.
    const rand = lcg(987654321);
    const n = 3000;
    const sats: [number, number, number][] = [];
    for (let i = 0; i < n; i++) {
      sats.push([-150 + rand() * 300, -150 + rand() * 300, 6900 + rand() * 300]);
    }
    const positions = pack(sats);
    const threshold = 8;
    const brute = bruteForcePairs(positions, n, threshold);
    const hashed = findClosePairs(positions, n, threshold, { buckets: 64 });
    expect(keys(hashed.pairs)).toEqual(brute);
    expect(brute.length).toBeGreaterThan(50);
  });

  it('covers satellites past the old 131,072 prefix', () => {
    // A pair parked at the very end of a fleet larger than the old scan limit:
    // the prefix scan could never see it, the full counting sort must.
    const n = 140_000;
    const positions = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      // Spread on a ring 7000 km out, ~0.31 km apart — every neighbour is a
      // close pair at 0.5 km, so use a 0.1 km threshold and plant one pair.
      const t = (i / n) * Math.PI * 2;
      positions.set([7000 * Math.cos(t), 7000 * Math.sin(t), 0, 1], i * 4);
    }
    const last = n - 1;
    positions.set([positions[last * 4] + 0.05, positions[last * 4 + 1], 0.01, 1], (last - 1) * 4);
    const { pairs, binned } = findClosePairs(positions, n, 0.1);
    expect(binned).toBe(n);
    expect(pairs).toEqual([expect.objectContaining({ a: last - 1, b: last })]);
  });
});

describe('exclusiveScanBlocked', () => {
  const naive = (counts: Uint32Array): Uint32Array => {
    const out = new Uint32Array(counts.length);
    let sum = 0;
    for (let i = 0; i < counts.length; i++) {
      out[i] = sum;
      sum += counts[i];
    }
    return out;
  };

  it.each([1, 1023, 1024, 1025, 4096, 1 << 19])(
    'matches a sequential scan over %i buckets',
    (n) => {
      const rand = lcg(n);
      const counts = new Uint32Array(n);
      for (let i = 0; i < n; i++) counts[i] = Math.floor(rand() * 5);
      expect(exclusiveScanBlocked(counts)).toEqual(naive(counts));
    },
  );

  it('fits the single-workgroup block-sum pass at the largest table', () => {
    // scan_block_sums runs one workgroup of 256 × 4 — it must hold every block.
    expect(conjunctionBlockCount(conjunctionBucketCount(1 << 20))).toBeLessThanOrEqual(
      CONJUNCTION_SCAN_BLOCK,
    );
  });
});

describe('buffer sizing', () => {
  it('sizes the table to the scan, clamped at 2^19 buckets', () => {
    expect(conjunctionBucketCount(1000)).toBe(4096);
    expect(conjunctionBucketCount(16384)).toBe(16384);
    expect(conjunctionBucketCount(300_000)).toBe(1 << 19);
    expect(conjunctionBucketCount(1048576)).toBe(1 << 19); // clamped
  });

  it('scans the whole fleet', () => {
    expect(conjunctionScanLimit(16384)).toBe(16384);
    expect(conjunctionScanLimit(1048576)).toBe(1048576);
  });

  it('fits the storage budget at a full 1M fleet, cinematic trails included', () => {
    const bytesFor = (n: number): number => calculateSatelliteBufferBudget(n).total;

    expect(conjunctionsFitBudget(bytesFor(262144), 262144).fits).toBe(true);

    // ~44 MB free at 1M high.
    expect(conjunctionsFitBudget(bytesFor(1048576), 1048576).fits).toBe(true);

    // Cinematic trail history leaves ~12 MB; the full-fleet table is ~8.1 MB.
    const trails = calculateSatelliteBufferBudget(1048576, {
      doubleBuffer: false,
      trailHistory: true,
    }).total;
    expect(conjunctionsFitBudget(trails, 1048576).fits).toBe(true);
  });

  it('still declines when doubleBuffer + cinematic trails fill the cap', () => {
    const full = calculateSatelliteBufferBudget(1048576, {
      doubleBuffer: true,
      trailHistory: true,
    }).total;
    const budget = conjunctionsFitBudget(full, 1048576);
    expect(budget.fits).toBe(false);
    expect(budget.freeBytes).toBeLessThan(budget.needBytes);
  });

  it('stays a small allocation next to the satellite buffers', () => {
    // 128 KB of pairs plus a table sized to the scan.
    expect(conjunctionBufferBytes(16384)).toBeLessThan(1 * 1024 * 1024);
    expect(conjunctionBufferBytes(1048576)).toBeLessThan(8.5 * 1024 * 1024);
    expect(MAX_CONJUNCTION_PAIRS * 32).toBe(131072);
  });
});
