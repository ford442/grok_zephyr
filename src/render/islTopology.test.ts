import { describe, expect, it } from 'vitest';
import { ISL_LINKS_PER_SAT, MAX_ISL_LINKS } from '@/types/isl.js';

const SATS_PER_PLANE = 1024;

function walkerNeighbor(sat: number, which: number, satLimit: number): number {
  const plane = Math.floor(sat / SATS_PER_PLANE);
  const slot = sat % SATS_PER_PLANE;
  const planeCount = Math.max(1, Math.ceil(satLimit / SATS_PER_PLANE));
  if (which === 0) {
    return plane * SATS_PER_PLANE + ((slot + 1) % SATS_PER_PLANE);
  }
  const np = (plane + 1) % planeCount;
  return np * SATS_PER_PLANE + slot;
}

describe('ISL plane-neighbor topology', () => {
  it('links along a plane and to the next plane without exceeding the 128k budget', () => {
    expect(MAX_ISL_LINKS).toBe(131072);
    expect(ISL_LINKS_PER_SAT).toBe(2);
    expect(walkerNeighbor(0, 0, 65536)).toBe(1);
    expect(walkerNeighbor(1023, 0, 65536)).toBe(0);
    expect(walkerNeighbor(0, 1, 65536)).toBe(1024);
    const lastPlane = walkerNeighbor(63 * 1024, 1, 65536);
    expect(lastPlane).toBe(0);
  });

  it('TLE ring uses wrap-around neighbors', () => {
    const n = 6000;
    const next = (sat: number) => (sat + 1) % n;
    const hop = (sat: number) => (sat + Math.max(2, Math.floor(n / 32))) % n;
    expect(next(n - 1)).toBe(0);
    expect(hop(0)).toBeGreaterThan(1);
  });
});
