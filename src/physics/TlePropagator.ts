/**
 * CPU-side SGP4 propagation with WASM (Vallado) primary and satellite.js fallback.
 *
 * Used to anchor osculating Keplerian elements for the GPU path and to
 * periodically re-anchor against SGP4 drift.
 *
 * WASM `twoline2rv` is the single catalog parser: `load()` only retains the two
 * lines, and a satellite.js `SatRec` is materialised lazily — per record, on
 * first use — so nothing calls `twoline2satrec` when the module initialises.
 * The fallback (no WASM and no Worker) is the only path that forces a parse.
 */

import { propagate, twoline2satrec, type SatRec } from 'satellite.js';
import type { TLEData } from '@/types/index.js';
import { eciStateToKeplerian, type KeplerianState } from './keplerianFromState.js';
import { packTleCatalog } from './packTleCatalog.js';
import { Sgp4WasmEngine } from './Sgp4WasmEngine.js';
import { Sgp4WorkerClient, type Sgp4PropagatePacked } from './Sgp4Worker.js';
import { packExtendedFromEciBatch } from './sgp4PackExtended.js';
import {
  SGP4_GPU_FLOATS_PER_SLOT,
  SGP4_GPU_HEADER_FLOATS,
  isNearEarth,
  packSgp4GpuSlot,
  sgp4MeanElementsFromSatrec,
} from './sgp4NearEarth.js';

export interface TleRecord {
  name: string;
  line1: string;
  line2: string;
  /** satellite.js record, parsed on first read (fallback / oracle paths only). */
  readonly satrec: SatRec;
}

/**
 * How a catalog entry is actually propagated, so the HUD can say so rather
 * than implying every TLE gets GPU SGP4 (see docs/FRAMES.md).
 *  - `sgp4-gpu`  near-earth ('n'): GPU mode-3 kernel between CPU re-anchors
 *  - `sdp4-cpu`  deep space ('d'): Vallado SDP4 in WASM, GPU coasts on J2
 *  - `j2`        no usable SGP4 record: shell / Keplerian J2 only
 */
export type Sgp4PropagationClass = 'sgp4-gpu' | 'sdp4-cpu' | 'j2';

export interface Sgp4PropagationClassCounts {
  sgp4Gpu: number;
  sdp4Cpu: number;
  j2: number;
}

/** Retain the TLE lines; parse to a satellite.js satrec only if something asks. */
function makeRecord(tle: TLEData): TleRecord {
  let parsed: SatRec | null = null;
  return {
    name: tle.name,
    line1: tle.line1,
    line2: tle.line2,
    get satrec(): SatRec {
      parsed ??= twoline2satrec(tle.line1, tle.line2);
      return parsed;
    },
  };
}

export type Sgp4Backend = 'wasm' | 'js';
/** Re-anchor output frame. 'gcrf' needs WASM (`sgp4_teme_to_gcrf`); JS fallback stays TEME. */
export type Sgp4OutputFrame = 'teme' | 'gcrf';

export class TlePropagator {
  private records: TleRecord[] = [];
  private wasmEngine: Sgp4WasmEngine | null = null;
  private worker: Sgp4WorkerClient | null = null;
  private wasmInitPromise: Promise<boolean> | null = null;
  private wasmInitAttempted = false;
  private batchScratch: Float32Array | null = null;
  private outputFrame: Sgp4OutputFrame = 'teme';

  /** Retain TLE lines for SGP4 propagation. Parsing happens in WASM (or lazily in JS). */
  load(tles: TLEData[], maxCount = Number.POSITIVE_INFINITY): number {
    this.records = [];
    const limit = Math.min(tles.length, maxCount);
    for (let i = 0; i < limit; i++) {
      this.records.push(makeRecord(tles[i]));
    }

    if (this.wasmEngine) {
      this.wasmEngine.loadCatalog(this.records);
    }
    if (this.worker) {
      void this.worker.load(this.records);
    }

    return this.records.length;
  }

  /**
   * Fill the physics mode-3 GPU records for catalog entries
   * [start, start + count) into `dest`, writing them at slot `destSlotBase`
   * onward. Returns the slots carrying a usable near-earth record.
   *
   * C++ packs straight out of the WASM catalog into HEAPF32; the satellite.js
   * packer below is only reached when neither WASM nor the Worker came up.
   */
  packGpuSgp4Slots(
    dest: Float32Array,
    destSlotBase: number,
    baseUnixMs: number,
    start: number,
    count: number,
  ): number {
    const limit = Math.min(count, Math.max(0, this.records.length - start));
    if (limit <= 0) return 0;

    if (this.wasmEngine?.canPackGpuElements()) {
      return this.wasmEngine.packGpuElements(
        baseUnixMs,
        start,
        limit,
        dest,
        SGP4_GPU_HEADER_FLOATS + destSlotBase * SGP4_GPU_FLOATS_PER_SLOT,
      );
    }

    let valid = 0;
    for (let i = 0; i < limit; i++) {
      const el = sgp4MeanElementsFromSatrec(this.records[start + i].satrec);
      packSgp4GpuSlot(dest, destSlotBase + i, el, baseUnixMs);
      if (el) valid++;
    }
    return valid;
  }

  /** How catalog entry `index` is propagated (GPU SGP4 / CPU SDP4 / J2 only). */
  propagationClass(index: number): Sgp4PropagationClass {
    if (index < 0 || index >= this.records.length) return 'j2';
    if (this.wasmEngine) {
      const method = this.wasmEngine.catalogMethod(index);
      if (method === 'n') return 'sgp4-gpu';
      if (method === 'd') return 'sdp4-cpu';
      return 'j2';
    }
    const satrec = this.records[index].satrec;
    if (satrec.error) return 'j2';
    // isNearEarth is the same period < 225 min test that sets satrec.method.
    return isNearEarth(satrec.no) ? 'sgp4-gpu' : 'sdp4-cpu';
  }

  /** Catalog-wide propagation-class tally for the HUD. */
  propagationClassCounts(): Sgp4PropagationClassCounts {
    const counts: Sgp4PropagationClassCounts = { sgp4Gpu: 0, sdp4Cpu: 0, j2: 0 };
    for (let i = 0; i < this.records.length; i++) {
      const cls = this.propagationClass(i);
      if (cls === 'sgp4-gpu') counts.sgp4Gpu++;
      else if (cls === 'sdp4-cpu') counts.sdp4Cpu++;
      else counts.j2++;
    }
    return counts;
  }

  /**
   * TLEs rejected on load. With WASM up this is Vallado's own count
   * (`sgp4_catalog_rejected_count`); otherwise the satellite.js records that
   * failed to parse or came back with an error, which forces a lazy parse.
   */
  rejectedCount(): number {
    if (this.wasmEngine) return this.wasmEngine.rejected;
    let errored = 0;
    for (const rec of this.records) {
      try {
        if (rec.satrec.error) errored++;
      } catch {
        errored++;
      }
    }
    return errored;
  }

  setOutputFrame(frame: Sgp4OutputFrame): void {
    this.outputFrame = frame;
  }

  getOutputFrame(): Sgp4OutputFrame {
    return this.outputFrame;
  }

  /** True when re-anchors rotate TEME→GCRF (WASM present and frame = 'gcrf'). */
  private rotatesToGcrf(): boolean {
    return this.outputFrame === 'gcrf' && this.wasmEngine !== null;
  }

  /** WASM TEME state → GCRF → 8-float extended elements (count × 8). */
  private packGcrfBatch(dateMs: number, startIndex: number, count: number): Float32Array {
    const engine = this.wasmEngine!;
    const { eci, errors } = engine.propagateBatchEx(dateMs, startIndex, count);
    const gcrf = engine.temeToGcrf(eci, dateMs);
    const dest = new Float32Array(errors.length * 8);
    packExtendedFromEciBatch(gcrf, errors, dest, 0);
    return dest;
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
      const packed = this.rotatesToGcrf()
        ? this.packGcrfBatch(dateMs, startIndex, count)
        : this.wasmEngine.propagateBatchKeplerian(dateMs, startIndex, count);
      const nSats = packed.length / 8;
      if (dest) {
        dest.set(packed, startIndex * 8);
        return;
      }
      for (let i = 0; i < nSats; i++) {
        const base = i * 8;
        if (packed[base + 7] < 0) continue;
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
      const state = this.propagateStateJs(startIndex + i, dateMs);
      if (!state) {
        continue;
      }
      write(startIndex + i, eciStateToKeplerian(state.position, state.velocity));
    }
  }

  /** Off-main-thread pack when the SGP4 worker is available. */
  async applyPackedBatch(dateMs: number, startIndex: number, count: number): Promise<Sgp4PropagatePacked> {
    if (this.worker?.isActive() && !this.rotatesToGcrf()) {
      return this.worker.propagatePacked(dateMs, startIndex, count);
    }
    if (this.rotatesToGcrf()) {
      const dest = this.packGcrfBatch(dateMs, startIndex, count);
      return { start: startIndex, count: dest.length / 8, extended: dest };
    }
    if (this.wasmEngine) {
      const dest = this.wasmEngine.propagateBatchKeplerian(dateMs, startIndex, count);
      return { start: startIndex, count: dest.length / 8, extended: dest };
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

  /**
   * Many UTC samples for one catalog index (pass prediction coarse scan).
   * Returns ECI km or null per sample (null if decayed / missing).
   */
  propagatePositionsAtEpochs(
    index: number,
    utcMs: readonly number[],
  ): Array<[number, number, number] | null> {
    const out: Array<[number, number, number] | null> = new Array(utcMs.length);
    if (this.wasmEngine && utcMs.length > 0) {
      const eci = this.wasmEngine.propagateEpochs(utcMs, index, 1);
      for (let i = 0; i < utcMs.length; i++) {
        const b = i * 6;
        if (eci.length < b + 3 || (eci[b] === 0 && eci[b + 1] === 0 && eci[b + 2] === 0)) {
          out[i] = null;
        } else {
          out[i] = [eci[b], eci[b + 1], eci[b + 2]];
        }
      }
      return out;
    }
    for (let i = 0; i < utcMs.length; i++) {
      out[i] = this.propagatePositionEci(index, utcMs[i]);
    }
    return out;
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
    // GCRF re-anchors rotate on the main-thread WASM instance (the worker packs TEME only).
    if (this.rotatesToGcrf()) return false;
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
