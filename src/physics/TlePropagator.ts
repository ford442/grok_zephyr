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
      const engine = await Sgp4WasmEngine.tryLoad();
      if (!engine) {
        return false;
      }
      this.wasmEngine = engine;
      if (this.records.length > 0) {
        engine.loadCatalog(this.records);
      }
      return true;
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
  ): void {
    const batch = this.propagateBatchEci(dateMs, startIndex, count);
    const limit = Math.floor(batch.length / 6);
    for (let i = 0; i < limit; i++) {
      const base = i * 6;
      const state = eciStateToKeplerian(
        { x: batch[base], y: batch[base + 1], z: batch[base + 2] },
        { x: batch[base + 3], y: batch[base + 4], z: batch[base + 5] },
      );
      write(startIndex + i, state);
    }
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
