/**
 * Main-thread client for Vallado SGP4 in a Worker.
 * Falls back to in-process Sgp4WasmEngine when Workers are unavailable.
 */

import { Sgp4WasmEngine } from './Sgp4WasmEngine.js';
import { packExtendedFromEciBatch } from './sgp4PackExtended.js';
import { packTleCatalog, type TleLinePair } from './packTleCatalog.js';
import { EXTENDED_FLOATS_PER_SATELLITE } from './extendedElements.js';
import type { Sgp4WorkerRequest, Sgp4WorkerResponse } from './sgp4WorkerProtocol.js';

export interface Sgp4PropagatePacked {
  start: number;
  count: number;
  extended: Float32Array;
}

type Pending = {
  resolve: (value: Sgp4WorkerResponse) => void;
  reject: (reason: Error) => void;
};

export class Sgp4WorkerClient {
  private worker: Worker | null = null;
  private engine: Sgp4WasmEngine | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private ready: Promise<boolean> | null = null;

  async init(): Promise<boolean> {
    if (this.ready) return this.ready;
    this.ready = this.tryInit();
    return this.ready;
  }

  private async tryInit(): Promise<boolean> {
    if (typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./sgp4.worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (event: MessageEvent<Sgp4WorkerResponse>) => {
          const entry = this.pending.get(event.data.id);
          if (!entry) return;
          this.pending.delete(event.data.id);
          entry.resolve(event.data);
        };
        this.worker.onerror = (event) => {
          const err = new Error(event.message || 'SGP4 worker error');
          for (const [, entry] of this.pending) entry.reject(err);
          this.pending.clear();
        };
        const response = await this.request({ type: 'init' });
        if (response.type === 'ready' && response.ok) return true;
        this.terminateWorker();
      } catch {
        this.terminateWorker();
      }
    }

    this.engine = await Sgp4WasmEngine.tryLoad();
    return this.engine !== null;
  }

  async load(tles: readonly TleLinePair[]): Promise<number> {
    const packed = packTleCatalog(tles);
    if (this.worker) {
      const copy = packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength);
      const response = await this.request({ type: 'load', packed: copy }, [copy]);
      return response.type === 'loaded' ? response.count : 0;
    }
    if (!this.engine) return 0;
    return this.engine.loadCatalog(tles);
  }

  async propagatePacked(unixMs: number, start: number, count: number): Promise<Sgp4PropagatePacked> {
    if (this.worker) {
      const response = await this.request({ type: 'propagate', unixMs, start, count });
      if (response.type !== 'propagated') {
        throw new Error('SGP4 worker propagate failed');
      }
      return {
        start: response.start,
        count: response.count,
        extended: new Float32Array(response.extended),
      };
    }
    if (!this.engine) {
      return { start, count: 0, extended: new Float32Array(0) };
    }
    const { eci, errors } = this.engine.propagateBatchEx(unixMs, start, count);
    const dest = new Float32Array(errors.length * EXTENDED_FLOATS_PER_SATELLITE);
    packExtendedFromEciBatch(eci, errors, dest, 0);
    return { start, count: errors.length, extended: dest };
  }

  async epochJd(index: number): Promise<number> {
    if (this.worker) {
      const response = await this.request({ type: 'epoch', index });
      return response.type === 'epoch' ? response.jd : 0;
    }
    return this.engine?.catalogEpochJd(index) ?? 0;
  }

  isActive(): boolean {
    return this.worker !== null || this.engine !== null;
  }

  usesWorker(): boolean {
    return this.worker !== null;
  }

  terminate(): void {
    this.terminateWorker();
    this.engine = null;
    this.ready = null;
  }

  private terminateWorker(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private request(
    body: Exclude<Sgp4WorkerRequest, { id: number }> | Record<string, unknown>,
    transfer?: Transferable[],
  ): Promise<Sgp4WorkerResponse> {
    const id = this.nextId++;
    const msg = { ...body, id } as Sgp4WorkerRequest;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      if (!this.worker) {
        this.pending.delete(id);
        reject(new Error('SGP4 worker missing'));
        return;
      }
      if (transfer && transfer.length > 0) {
        this.worker.postMessage(msg, transfer);
      } else {
        this.worker.postMessage(msg);
      }
    });
  }
}

/** In-process round-trip used by Node/Vitest when a dedicated Worker is awkward. */
export function propagatePackedInProcess(
  engine: Sgp4WasmEngine,
  unixMs: number,
  start: number,
  count: number,
): Sgp4PropagatePacked {
  const { eci, errors } = engine.propagateBatchEx(unixMs, start, count);
  const dest = new Float32Array(errors.length * EXTENDED_FLOATS_PER_SATELLITE);
  packExtendedFromEciBatch(eci, errors, dest, 0);
  return { start, count: errors.length, extended: dest };
}
