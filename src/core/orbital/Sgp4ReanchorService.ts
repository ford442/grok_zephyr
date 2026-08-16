import type { TLEData } from '@/types/index.js';
import {
  EXTENDED_FLOATS_PER_SATELLITE,
  TlePropagator,
  writeKeplerianExtended,
  writeShellExtended,
  type KeplerianState,
} from '@/physics/index.js';
import type { OrbitalDataStore } from './OrbitalDataStore.js';

/** Re-anchor SGP4 elements every N simulation seconds. */
export const REANCHOR_INTERVAL_SIM_SEC = 180;
/** Satellites re-anchored per frame to avoid main-thread spikes. */
export const REANCHOR_CHUNK_SIZE = 512;

export interface PackedBatchResult {
  start: number;
  count: number;
  extended: Float32Array;
}

export interface KeplerianBatchPropagator {
  load(tles: TLEData[], maxCount: number): number;
  initWasm(): Promise<unknown>;
  applyKeplerianBatch(
    dateMs: number,
    start: number,
    count: number,
    write: (index: number, state: KeplerianState) => void,
    dest?: Float32Array,
  ): void;
  applyPackedBatch?(dateMs: number, start: number, count: number): Promise<PackedBatchResult>;
  usesSgp4Worker?(): boolean;
}

/** Owns TLE propagator + chunked / forced SGP4 re-anchor of extended elements. */
export class Sgp4ReanchorService {
  propagator: KeplerianBatchPropagator | null = null;
  tleRealCount = 0;
  realismEnabled = false;
  simEpochMs = Date.now();
  lastReanchorCycleSimTime = 0;
  reanchorCursor = 0;
  lastReanchorMainMs = 0;
  private reanchorBusy = false;

  constructor(private readonly store: OrbitalDataStore) {}

  resetProcedural(): void {
    this.propagator = null;
    this.tleRealCount = 0;
    this.realismEnabled = false;
  }

  attachCatalog(tles: TLEData[], create = () => new TlePropagator()): number {
    this.propagator = create();
    this.tleRealCount = this.propagator.load(tles, this.store.numSatellites);
    void this.propagator.initWasm();
    return this.tleRealCount;
  }

  enableRealism(simTime: number): void {
    this.realismEnabled = true;
    this.rebuild(simTime);
    this.lastReanchorCycleSimTime = simTime;
    this.reanchorCursor = this.tleRealCount;
  }

  setRealismEnabled(enabled: boolean, simTime: number): void {
    this.realismEnabled = enabled;
    if (enabled && this.propagator && this.tleRealCount > 0) {
      this.enableRealism(simTime);
    }
  }

  rebuild(anchorSimTime: number): void {
    const dateMs = this.simEpochMs + anchorSimTime * 1000;
    const data = this.store.extendedElementData;
    const orb = this.store.orbitalElementData;

    if (this.realismEnabled && this.propagator && this.tleRealCount > 0) {
      this.propagator.applyKeplerianBatch(
        dateMs,
        0,
        this.tleRealCount,
        (index, state) => {
          writeKeplerianExtended(data, index, state);
        },
        data,
      );
    }

    const start = this.realismEnabled ? this.tleRealCount : 0;
    for (let i = start; i < this.store.numSatellites; i++) {
      const base = i * 4;
      writeShellExtended(
        data,
        i,
        orb[base],
        orb[base + 1],
        orb[base + 2],
        (orb[base + 3] >> 8) & 0xff,
      );
    }
  }

  /**
   * Advance one chunk. Returns the [start, end) satellite range written, or null.
   */
  tick(simTime: number): { start: number; end: number } | null {
    if (!this.realismEnabled || !this.propagator || this.tleRealCount === 0) {
      return null;
    }

    if (this.reanchorCursor >= this.tleRealCount) {
      if (simTime - this.lastReanchorCycleSimTime < REANCHOR_INTERVAL_SIM_SEC) {
        return null;
      }
      this.lastReanchorCycleSimTime = simTime;
      this.reanchorCursor = 0;
    }

    const start = this.reanchorCursor;
    const end = Math.min(this.tleRealCount, start + REANCHOR_CHUNK_SIZE);
    const dateMs = this.simEpochMs + simTime * 1000;
    const data = this.store.extendedElementData;

    this.propagator.applyKeplerianBatch(
      dateMs,
      start,
      end - start,
      (index, state) => {
        writeKeplerianExtended(data, index, state);
      },
      data,
    );

    this.reanchorCursor = end;
    return { start, end };
  }

  planChunk(simTime: number): { start: number; end: number; dateMs: number } | null {
    if (this.reanchorBusy || !this.realismEnabled || !this.propagator || this.tleRealCount === 0) {
      return null;
    }
    if (this.reanchorCursor >= this.tleRealCount) {
      if (simTime - this.lastReanchorCycleSimTime < REANCHOR_INTERVAL_SIM_SEC) {
        return null;
      }
      this.lastReanchorCycleSimTime = simTime;
      this.reanchorCursor = 0;
    }
    const start = this.reanchorCursor;
    const end = Math.min(this.tleRealCount, start + REANCHOR_CHUNK_SIZE);
    return { start, end, dateMs: this.simEpochMs + simTime * 1000 };
  }

  async runChunkAsync(plan: { start: number; end: number; dateMs: number }): Promise<{
    start: number;
    end: number;
  } | null> {
    if (!this.propagator) return null;
    this.reanchorBusy = true;
    try {
      const count = plan.end - plan.start;
      if (this.propagator.applyPackedBatch && this.propagator.usesSgp4Worker?.()) {
        const packed = await this.propagator.applyPackedBatch(plan.dateMs, plan.start, count);
        const t0 = performance.now();
        this.store.extendedElementData.set(
          packed.extended,
          packed.start * EXTENDED_FLOATS_PER_SATELLITE,
        );
        this.lastReanchorMainMs = performance.now() - t0;
      } else {
        const t0 = performance.now();
        this.propagator.applyKeplerianBatch(
          plan.dateMs,
          plan.start,
          count,
          (index, state) => {
            writeKeplerianExtended(this.store.extendedElementData, index, state);
          },
          this.store.extendedElementData,
        );
        this.lastReanchorMainMs = performance.now() - t0;
      }
      this.reanchorCursor = plan.end;
      return { start: plan.start, end: plan.end };
    } finally {
      this.reanchorBusy = false;
    }
  }

  force(simTime: number): boolean {
    if (!this.realismEnabled || !this.propagator || this.tleRealCount === 0) {
      return false;
    }
    this.rebuild(simTime);
    this.lastReanchorCycleSimTime = simTime;
    this.reanchorCursor = this.tleRealCount;
    return true;
  }

  get floatsPerSat(): number {
    return EXTENDED_FLOATS_PER_SATELLITE;
  }
}
