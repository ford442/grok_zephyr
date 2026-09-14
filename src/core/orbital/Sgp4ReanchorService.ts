import type { TLEData } from '@/types/index.js';
import {
  EXTENDED_FLOATS_PER_SATELLITE,
  TlePropagator,
  writeKeplerianExtended,
  writeShellExtended,
  type KeplerianState,
} from '@/physics/index.js';
import type { OrbitalDataStore } from './OrbitalDataStore.js';
import { sgp4GpuBufferBytes } from '@/core/buffer/BufferAllocator.js';
import {
  SGP4_GPU_CAPACITY,
  SGP4_GPU_REBASE_SIM_SEC,
  packSgp4GpuSlot,
  writeSgp4GpuHeader,
  type Sgp4MeanElements,
} from '@/physics/sgp4NearEarth.js';

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
  /** Near-earth SGP4 mean elements for the GPU kernel (null = deep space / invalid). */
  meanElements?(index: number): Sgp4MeanElements | null;
  /** TLEs the propagator (or WASM catalog) rejected on load. */
  rejectedCount?(): number;
  setOutputFrame?(frame: 'teme' | 'gcrf'): void;
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
  /** Re-anchor output frame; 'gcrf' only under ?frame=gcrf&sun=astro (docs/FRAMES.md). */
  outputFrame: 'teme' | 'gcrf' = 'teme';
  private reanchorBusy = false;

  /** Physics mode 3 GPU buffer contents (header + near-earth mean elements per TLE slot). */
  readonly gpuSgp4Data: Float32Array;
  /** Slots with a valid near-earth record in the last pack. */
  gpuSgp4Slots = 0;
  private gpuSgp4Dirty = true;
  private gpuSgp4BaseSimSec = 0;
  private gpuSgp4PackedEpochMs = Number.NaN;

  constructor(private readonly store: OrbitalDataStore) {
    this.gpuSgp4Data = new Float32Array(sgp4GpuBufferBytes(store.numSatellites) / 4);
  }

  resetProcedural(): void {
    this.propagator = null;
    this.tleRealCount = 0;
    this.realismEnabled = false;
    this.gpuSgp4Dirty = true;
  }

  attachCatalog(tles: TLEData[], create = () => new TlePropagator()): number {
    this.propagator = create();
    this.propagator.setOutputFrame?.(this.outputFrame);
    this.tleRealCount = this.propagator.load(tles, this.store.numSatellites);
    this.gpuSgp4Dirty = true;
    void this.propagator.initWasm();
    return this.tleRealCount;
  }

  /** Switch the re-anchor frame. Returns true when a forced re-anchor is warranted. */
  setOutputFrame(frame: 'teme' | 'gcrf'): boolean {
    if (frame === this.outputFrame) return false;
    this.outputFrame = frame;
    this.propagator?.setOutputFrame?.(frame);
    return this.realismEnabled && this.tleRealCount > 0;
  }

  /**
   * Re-pack the mode-3 GPU records when the catalog or clock epoch changed, or
   * sim time drifted more than SGP4_GPU_REBASE_SIM_SEC from the phase base.
   * Returns true when `gpuSgp4Data` must be uploaded.
   */
  tickGpuSgp4(simTime: number): boolean {
    const stale =
      this.gpuSgp4Dirty ||
      this.simEpochMs !== this.gpuSgp4PackedEpochMs ||
      Math.abs(simTime - this.gpuSgp4BaseSimSec) > SGP4_GPU_REBASE_SIM_SEC;
    if (!stale) return false;
    this.packGpuSgp4(simTime);
    return true;
  }

  packGpuSgp4(baseSimSec: number): void {
    const dest = this.gpuSgp4Data;
    const capacity = Math.min(
      SGP4_GPU_CAPACITY,
      (dest.length / 4 - 1) / 3,
    );
    const slots = this.propagator?.meanElements ? Math.min(this.tleRealCount, capacity) : 0;
    const baseUnixMs = this.simEpochMs + baseSimSec * 1000;
    let valid = 0;
    for (let k = 0; k < slots; k++) {
      const el = this.propagator!.meanElements!(k);
      packSgp4GpuSlot(dest, k, el, baseUnixMs);
      if (el) valid++;
    }
    writeSgp4GpuHeader(dest, baseSimSec, slots);
    this.gpuSgp4Slots = valid;
    this.gpuSgp4BaseSimSec = baseSimSec;
    this.gpuSgp4PackedEpochMs = this.simEpochMs;
    this.gpuSgp4Dirty = false;
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
