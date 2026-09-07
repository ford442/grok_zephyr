import { describe, expect, it } from 'vitest';
import { cellCoord, findClosePairs, hashCell } from './conjunctionHash.js';
import {
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
    const all = findClosePairs(pack(sats), sats.length, 5, { bucketCapacity: 64 });
    expect(all.pairs.length).toBeGreaterThan(10);
    expect(all.pairsTruncated).toBe(false);

    const capped = findClosePairs(pack(sats), sats.length, 5, {
      bucketCapacity: 64,
      maxPairs: 10,
    });
    expect(capped.pairs).toHaveLength(10);
    expect(capped.pairsTruncated).toBe(true);
  });

  it('reports bucket overflow instead of silently under-counting a cluster', () => {
    // 40 satellites inside one 5 km cell overflow a capacity-8 bucket. The
    // dropped count is what tells the HUD the view is saturated.
    const sats: [number, number, number][] = [];
    for (let i = 0; i < 40; i++) sats.push([7000 + i * 0.01, 0, 0]);
    const result = findClosePairs(pack(sats), sats.length, 5, { bucketCapacity: 8 });
    expect(result.dropped).toBe(32);
    expect(result.pairs.length).toBeLessThan(780);

    // With room for everyone, nothing is dropped and every pair is found.
    const full = findClosePairs(pack(sats), sats.length, 5, { bucketCapacity: 64 });
    expect(full.dropped).toBe(0);
    expect(full.pairs).toHaveLength((40 * 39) / 2);
  });

  it('agrees with brute force on a randomised cloud', () => {
    // The hash is only worth having if it finds what O(n^2) finds.
    let seed = 12345;
    const rand = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const n = 400;
    const sats: [number, number, number][] = [];
    for (let i = 0; i < n; i++) {
      sats.push([7000 + rand() * 40, rand() * 40, rand() * 40]);
    }
    const positions = pack(sats);
    const threshold = 5;

    const brute: string[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = positions[j * 4] - positions[i * 4];
        const dy = positions[j * 4 + 1] - positions[i * 4 + 1];
        const dz = positions[j * 4 + 2] - positions[i * 4 + 2];
        if (Math.hypot(dx, dy, dz) <= threshold) brute.push(`${i}-${j}`);
      }
    }
    // A big per-bucket capacity removes the lossy part, so any disagreement
    // here would be a bug in the neighbour walk rather than dropped overflow.
    const hashed = findClosePairs(positions, n, threshold, { bucketCapacity: 64 })
      .pairs.map((p) => `${p.a}-${p.b}`)
      .sort();
    expect(hashed).toEqual(brute.sort());
    expect(brute.length).toBeGreaterThan(0);
  });
});

describe('buffer sizing', () => {
  it('keeps mean bucket occupancy near 0.5', () => {
    expect(conjunctionBucketCount(1000)).toBe(4096);
    expect(conjunctionBucketCount(16384)).toBe(32768);
    expect(conjunctionBucketCount(1048576)).toBe(1 << 18); // clamped
  });

  it('caps the scan where the table saturates', () => {
    expect(conjunctionScanLimit(16384)).toBe(16384);
    expect(conjunctionScanLimit(1048576)).toBe(131072);
  });

  it('fits the storage budget at fleet sizes below 1M and refuses at 1M', () => {
    const bytesFor = (n: number): number => calculateSatelliteBufferBudget(n).total;

    const mid = conjunctionsFitBudget(bytesFor(262144), 262144);
    expect(mid.fits).toBe(true);

    // At 1M the satellite buffers already consume the entire 128 MB Pascal cap,
    // so the feature must decline rather than allocate and trip the assert.
    const full = conjunctionsFitBudget(bytesFor(1048576), 1048576);
    expect(full.freeBytes).toBeLessThanOrEqual(0);
    expect(full.fits).toBe(false);
  });

  it('stays a small allocation next to the satellite buffers', () => {
    // 128 KB of pairs plus a table sized to the scan — not another ISL-sized
    // 4 MiB tenant of the budget.
    expect(conjunctionBufferBytes(16384)).toBeLessThan(2 * 1024 * 1024);
    expect(conjunctionBufferBytes(131072)).toBeLessThan(10 * 1024 * 1024);
    expect(MAX_CONJUNCTION_PAIRS * 32).toBe(131072);
  });
});
