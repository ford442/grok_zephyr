/**
 * CPU-side SGP4 propagation with WASM (Vallado) primary and satellite.js fallback.
 *
 * Used to anchor osculating Keplerian elements for the GPU path and to
 * periodically re-anchor against SGP4 drift.
 */

import { propagate, twoline2satrec, type SatRec } from 'satellite.js';
import type { TLEData } from '@/types/index.js';
import { eciStateToKeplerian, type KeplerianState } from './keplerianFromState.js';
import { packTleCatalog } from './packTleCatalog.js';
import { Sgp4WasmEngine } from './Sgp4WasmEngine.js';
import { Sgp4WorkerClient, type Sgp4PropagatePacked } from './Sgp4Worker.js';
import { packExtendedFromEciBatch } from './sgp4PackExtended.js';

export interface TleRecord {
  name: string;
  line1: string;
  line2: string;
  satrec: SatRec;
}

export type Sgp4Backend = 'wasm' | 'js';

export class TlePropagator {
  private records: TleRecord[] = [];
  private wasmEngine: Sgp4WasmEngine | null = null;
  private worker: Sgp4WorkerClient | null = null;
  private wasmInitPromise: Promise<boolean> | null = null;
  private wasmInitAttempted = false;
  private batchScratch: Float32Array | null = null;

  /** Parse and retain TLE records for SGP4 propagation. */
  load(tles: TLEData[], maxCount = Number.POSITIVE_INFINITY): number {
    this.records = [];
    const limit = Math.min(tles.length, maxCount);
    for (let i = 0; i < limit; i++) {
      const tle = tles[i];
      try {
        const satrec = twoline2satrec(tle.line1, tle.line2);
        this.records.push({
          name: tle.name,
          line1: tle.line1,
          line2: tle.line2,
          satrec,
        });
      } catch (error) {
        console.warn(`[TlePropagator] Skipping invalid TLE for ${tle.name}:`, error);
      }
    }

    if (this.wasmEngine) {
      this.wasmEngine.loadCatalog(this.records);
    }
    if (this.worker) {
      void this.worker.load(this.records);
    }

    return this.records.length;
  }

  get count(): number {
    return this.records.length;
  }

  getRecord(index: number): TleRecord | null {
    return this.records[index] ?? null;
  }

  getBackend(): Sgp4Backend {
    return this.wasmEngine ? 'wasm' : 'js';
  }

  isWasmActive(): boolean {
    return this.wasmEngine !== null;
  }

  /** Attempt to load the WASM module; safe to call multiple times. */
  async initWasm(): Promise<boolean> {
    if (this.wasmEngine) {
      return true;
    }
    if (this.wasmInitAttempted) {
      return this.wasmInitPromise ?? Promise.resolve(false);
    }

    this.wasmInitAttempted = true;
    this.wasmInitPromise = (async () => {
      const worker = new Sgp4WorkerClient();
      if (await worker.init()) {
        this.worker = worker;
        if (this.records.length > 0) {
          await worker.load(this.records);
        }
      }

      const engine = await Sgp4WasmEngine.tryLoad();
      if (engine) {
        this.wasmEngine = engine;
        if (this.records.length > 0) {
          engine.loadCatalog(this.records);
        }
      }

      return this.wasmEngine !== null || this.worker !== null;
    })();

    return this.wasmInitPromise;
  }

  /** SGP4 ECI position (km) at simulation wall-clock offset from Unix epoch. */
  propagatePositionEci(index: number, dateMs: number): [number, number, number] | null {
    if (this.wasmEngine) {
      const batch = this.wasmEngine.propagateBatch(dateMs, index, 1);
      if (batch.length < 3) return null;
      return [batch[0], batch[1], batch[2]];
    }

    const record = this.records[index];
    if (!record) return null;

    const result = propagate(record.satrec, new Date(dateMs));
    if (!result.position || typeof result.position === 'boolean') return null;
    return [result.position.x, result.position.y, result.position.z];
  }

  /** Derive osculating Keplerian elements from SGP4 at the given instant. */
  keplerianAt(index: number, dateMs: number): KeplerianState | null {
    const state = this.propagateStateEci(index, dateMs);
    if (!state) return null;
    return eciStateToKeplerian(state.position, state.velocity);
  }

  /**
   * Batch-propagate ECI state vectors for [startIndex, startIndex + count).
   * When `forceBackend` is set, bypasses the active runtime backend (benchmark only).
   */
  propagateBatchEci(
    dateMs: number,
    startIndex: number,
    count: number,
    forceBackend?: Sgp4Backend,
  ): Float32Array {
    const limit = Math.min(count, Math.max(0, this.records.length - startIndex));
    const floats = limit * 6;
    const useWasm = forceBackend ? forceBackend === 'wasm' : this.wasmEngine !== null;

    if (useWasm && this.wasmEngine) {
      return this.wasmEngine.propagateBatch(dateMs, startIndex, limit);
    }

    const out = new Float32Array(floats);
    for (let i = 0; i < limit; i++) {
      const state = this.propagateStateJs(startIndex + i, dateMs);
      const base = i * 6;
      if (state) {
        out[base + 0] = state.position.x;
        out[base + 1] = state.position.y;
        out[base + 2] = state.position.z;
        out[base + 3] = state.velocity.x;
        out[base + 4] = state.velocity.y;
        out[base + 5] = state.velocity.z;
      }
    }
    return out;
  }

  /** Write Keplerian extended elements for a catalog slice using the fastest backend. */
  applyKeplerianBatch(
    dateMs: number,
    startIndex: number,
    count: number,
    write: (index: number, state: KeplerianState) => void,
    dest?: Float32Array,
  ): void {
    if (this.wasmEngine) {
      const { eci, errors } = this.wasmEngine.propagateBatchEx(dateMs, startIndex, count);
      if (dest) {
        packExtendedFromEciBatch(eci, errors, dest, startIndex);
        return;
      }
      const packed = new Float32Array(errors.length * 8);
      packExtendedFromEciBatch(eci, errors, packed, 0);
      for (let i = 0; i < errors.length; i++) {
        if (errors[i] !== 0) continue;
        const base = i * 8;
        write(startIndex + i, {
          a: packed[base],
          e: packed[base + 1],
          inc: packed[base + 2],
          raan: packed[base + 3],
          argp: packed[base + 4],
          M0: packed[base + 5],
          n: packed[base + 6],
        });
      }
      return;
    }

    const limit = Math.min(count, Math.max(0, this.records.length - startIndex));
    for (let i = 0; i < limit; i++) {
      const rec = this.records[startIndex + i];
      const state = this.propagateStateJs(startIndex + i, dateMs);
      if (!state || rec.satrec.error) {
        continue;
      }
      write(startIndex + i, eciStateToKeplerian(state.position, state.velocity));
    }
  }

  /** Off-main-thread pack when the SGP4 worker is available. */
  async applyPackedBatch(dateMs: number, startIndex: number, count: number): Promise<Sgp4PropagatePacked> {
    if (this.worker?.isActive()) {
      return this.worker.propagatePacked(dateMs, startIndex, count);
    }
    if (this.wasmEngine) {
      const { eci, errors } = this.wasmEngine.propagateBatchEx(dateMs, startIndex, count);
      const dest = new Float32Array(errors.length * 8);
      packExtendedFromEciBatch(eci, errors, dest, 0);
      return { start: startIndex, count: errors.length, extended: dest };
    }
    const dest = new Float32Array(count * 8);
    this.applyKeplerianBatch(dateMs, startIndex, count, (index, state) => {
      dest.set(
        [state.a, state.e, state.inc, state.raan, state.argp, state.M0, state.n, 1],
        (index - startIndex) * 8,
      );
    });
    return { start: startIndex, count, extended: dest };
  }

  catalogEpochJd(index: number): number {
    if (this.wasmEngine) {
      return this.wasmEngine.catalogEpochJd(index);
    }
    const rec = this.records[index];
    const sat = rec?.satrec as { jdsatepoch?: number } | undefined;
    return sat?.jdsatepoch ?? 0;
  }

  usesSgp4Worker(): boolean {
    return this.worker?.usesWorker() ?? false;
  }

  /** Expose packed catalog bytes (tests / diagnostics). */
  getPackedCatalog(): Uint8Array {
    return packTleCatalog(this.records);
  }

  private propagateStateEci(
    index: number,
    dateMs: number,
  ): { position: { x: number; y: number; z: number }; velocity: { x: number; y: number; z: number } } | null {
    if (this.wasmEngine) {
      if (!this.batchScratch || this.batchScratch.length < 6) {
        this.batchScratch = new Float32Array(6);
      }
      const batch = this.wasmEngine.propagateBatch(dateMs, index, 1, this.batchScratch);
      if (batch.length < 6) return null;
      return {
        position: { x: batch[0], y: batch[1], z: batch[2] },
        velocity: { x: batch[3], y: batch[4], z: batch[5] },
      };
    }
    return this.propagateStateJs(index, dateMs);
  }

  private propagateStateJs(
    index: number,
    dateMs: number,
  ): { position: { x: number; y: number; z: number }; velocity: { x: number; y: number; z: number } } | null {
    const record = this.records[index];
    if (!record) return null;

    const result = propagate(record.satrec, new Date(dateMs));
    if (
      !result.position ||
      typeof result.position === 'boolean' ||
      !result.velocity ||
      typeof result.velocity === 'boolean'
    ) {
      return null;
    }
    return { position: result.position, velocity: result.velocity };
  }
}
