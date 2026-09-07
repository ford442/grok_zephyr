/**
 * Close-approach GPU buffers — allocated on first enable, never at boot.
 *
 * At a 1M fleet the satellite buffers already consume the whole 128 MB Pascal
 * cap (calculateSatelliteBufferBudget), so allocating a hash table up front
 * would either trip assertBufferBudget or quietly push a real GPU into
 * eviction. These buffers therefore appear only when the feature is switched
 * on, and only when what is left of the budget can hold them.
 */

import type { WebGPUContext } from '@/core/WebGPUContext.js';
import {
  CONJUNCTION_BUCKET_CAPACITY,
  CONJUNCTION_PAIR_BYTES,
  MAX_CONJUNCTION_PAIRS,
  conjunctionBucketCount,
  conjunctionBufferBytes,
  conjunctionScanLimit,
  conjunctionsFitBudget,
} from '@/types/conjunction.js';

export interface ConjunctionBufferSet {
  binCounts: GPUBuffer;
  binIndices: GPUBuffer;
  pairs: GPUBuffer;
  counters: GPUBuffer;
  readback: GPUBuffer;
  buckets: number;
  scanCount: number;
  bytes: number;
}

/** What the compute pass read back last frame. */
export interface ConjunctionStats {
  pairCount: number;
  overflow: number;
  truncated: boolean;
}

export class ConjunctionBuffers {
  private set: ConjunctionBufferSet | null = null;
  private readbackPending = false;
  private mapInFlight = false;
  private stats: ConjunctionStats = { pairCount: 0, overflow: 0, truncated: false };

  constructor(private readonly context: WebGPUContext) {}

  get(): ConjunctionBufferSet | null {
    return this.set;
  }

  getStats(): ConjunctionStats {
    return this.stats;
  }

  /**
   * Allocate for `fleetSize`, or explain why not. `satelliteBufferBytes` is what
   * the satellite buffers already hold — the caller passes it so this decision
   * is made against the real budget rather than an assumed one.
   */
  ensure(
    fleetSize: number,
    satelliteBufferBytes: number,
  ): { ok: true; set: ConjunctionBufferSet } | { ok: false; reason: string } {
    const scanCount = conjunctionScanLimit(fleetSize);
    if (this.set && this.set.scanCount === scanCount) {
      return { ok: true, set: this.set };
    }

    const budget = conjunctionsFitBudget(satelliteBufferBytes, fleetSize);
    if (!budget.fits) {
      const need = (budget.needBytes / (1024 * 1024)).toFixed(1);
      const free = (Math.max(0, budget.freeBytes) / (1024 * 1024)).toFixed(1);
      return {
        ok: false,
        reason:
          `needs ${need} MB but only ${free} MB of the 128 MB buffer budget is free ` +
          `at ${fleetSize.toLocaleString()} satellites — try a smaller ?sats=`,
      };
    }

    this.destroy();

    const device = this.context.getDevice();
    const buckets = conjunctionBucketCount(scanCount);
    const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;

    const binCounts = device.createBuffer({
      label: 'conjunction-bin-counts',
      size: buckets * 4,
      usage: storage,
    });
    const binIndices = device.createBuffer({
      label: 'conjunction-bin-indices',
      size: buckets * CONJUNCTION_BUCKET_CAPACITY * 4,
      usage: storage,
    });
    const pairs = device.createBuffer({
      label: 'conjunction-pairs',
      size: MAX_CONJUNCTION_PAIRS * CONJUNCTION_PAIR_BYTES,
      usage: storage,
    });
    const counters = device.createBuffer({
      label: 'conjunction-counters',
      size: 16,
      usage: storage | GPUBufferUsage.COPY_SRC,
    });
    const readback = device.createBuffer({
      label: 'conjunction-readback',
      size: 16,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    this.set = {
      binCounts,
      binIndices,
      pairs,
      counters,
      readback,
      buckets,
      scanCount,
      bytes: conjunctionBufferBytes(scanCount),
    };
    console.log(
      `[Conjunctions] ${(this.set.bytes / (1024 * 1024)).toFixed(2)} MB — ` +
        `${buckets.toLocaleString()} buckets × ${CONJUNCTION_BUCKET_CAPACITY}, ` +
        `scanning ${scanCount.toLocaleString()} of ${fleetSize.toLocaleString()} satellites`,
    );
    return { ok: true, set: this.set };
  }

  /** Queue a copy of the counters so the HUD can report last frame's numbers. */
  encodeReadback(encoder: GPUCommandEncoder): void {
    if (!this.set || this.readbackPending) return;
    encoder.copyBufferToBuffer(this.set.counters, 0, this.set.readback, 0, 16);
    this.readbackPending = true;
  }

  /**
   * Resolve the queued copy. Safe to call every frame; no-ops when idle.
   *
   * `mapInFlight` is separate from `readbackPending` on purpose: a map can stay
   * outstanding across several frames on a slow adapter, and calling mapAsync
   * again on the same buffer while one is pending throws. (The satellite cull
   * readback has that shape and does log those errors.) The buffers can also be
   * released mid-flight when a quality drop disables the feature, so the
   * resolved map is checked against the set it was queued for.
   */
  async consumeReadback(): Promise<ConjunctionStats | null> {
    const set = this.set;
    if (!set || !this.readbackPending || this.mapInFlight) return null;
    this.mapInFlight = true;
    const { readback } = set;
    try {
      await readback.mapAsync(GPUMapMode.READ);
      if (this.set !== set) {
        readback.unmap();
        return null;
      }
      const view = new Uint32Array(readback.getMappedRange().slice(0));
      readback.unmap();
      this.stats = {
        pairCount: Math.min(view[0], MAX_CONJUNCTION_PAIRS),
        overflow: view[1],
        truncated: view[0] > MAX_CONJUNCTION_PAIRS,
      };
      return this.stats;
    } catch {
      // Device loss, a destroyed buffer, or a torn-down instance. The next
      // frame simply queues another copy.
      try {
        readback.unmap();
      } catch {
        // ignore double-unmap
      }
      return null;
    } finally {
      this.mapInFlight = false;
      this.readbackPending = false;
    }
  }

  destroy(): void {
    if (!this.set) return;
    this.set.binCounts.destroy();
    this.set.binIndices.destroy();
    this.set.pairs.destroy();
    this.set.counters.destroy();
    this.set.readback.destroy();
    this.set = null;
    this.readbackPending = false;
    this.mapInFlight = false;
    this.stats = { pairCount: 0, overflow: 0, truncated: false };
  }
}
