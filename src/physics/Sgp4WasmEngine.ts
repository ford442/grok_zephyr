/**
 * Thin TypeScript wrapper around the Vallado SGP4 Emscripten module (public/sgp4.wasm).
 */

import { packTleCatalog, type TleLinePair } from './packTleCatalog.js';

export interface Sgp4WasmModule {
  _malloc(size: number): number;
  _free(ptr: number): void;
  _sgp4_load_catalog(data: number, byteLength: number): number;
  _sgp4_propagate_batch(unixMs: number, out: number, startIndex: number, count: number): number;
  _sgp4_propagate_batch_ex?(
    unixMs: number,
    out: number,
    errors: number,
    startIndex: number,
    count: number,
  ): number;
  _sgp4_catalog_epoch_jd?(index: number): number;
  _sgp4_catalog_count(): number;
  _sgp4_clear_catalog(): void;
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
  HEAP32: Int32Array;
}

export interface Sgp4BatchResult {
  eci: Float32Array;
  errors: Int32Array;
}

export type Sgp4WasmLoadOptions = {
  moduleUrl?: string;
  wasmBinary?: Uint8Array;
  locateFile?: (path: string) => string;
};

function defaultModuleUrl(): string {
  if (typeof window !== 'undefined') {
    return new URL('sgp4.js', window.location.href).href;
  }
  if (typeof self !== 'undefined' && 'location' in self && self.location?.origin) {
    return new URL('/sgp4.js', self.location.origin).href;
  }
  return new URL('../../public/sgp4.js', import.meta.url).href;
}

function defaultWasmUrl(path: string): string {
  if (typeof window !== 'undefined') {
    return new URL(path, window.location.href).href;
  }
  if (typeof self !== 'undefined' && 'location' in self && self.location?.origin) {
    return new URL(`/${path}`, self.location.origin).href;
  }
  return new URL(`../../public/${path}`, import.meta.url).href;
}

export class Sgp4WasmEngine {
  private catalogCount = 0;

  private constructor(private readonly mod: Sgp4WasmModule) {}

  static async tryLoad(options: Sgp4WasmLoadOptions = {}): Promise<Sgp4WasmEngine | null> {
    try {
      const moduleUrl = options.moduleUrl ?? defaultModuleUrl();
      const createModule = (await import(/* @vite-ignore */ moduleUrl)) as {
        default: (opts?: Record<string, unknown>) => Promise<Sgp4WasmModule>;
      };

      let wasmBinary = options.wasmBinary;
      if (!wasmBinary) {
        const wasmUrl = options.locateFile?.('sgp4.wasm') ?? defaultWasmUrl('sgp4.wasm');
        try {
          const response = await fetch(wasmUrl);
          if (response.ok) {
            wasmBinary = new Uint8Array(await response.arrayBuffer());
          }
        } catch {
          const proc = globalThis as { process?: { versions?: { node?: string } } };
          if (proc.process?.versions?.node) {
            try {
              // @ts-expect-error Node built-in (Vitest fallback when file:// fetch is unavailable)
              const { readFile } = await import('node:fs/promises');
              // @ts-expect-error Node built-in
              const { fileURLToPath } = await import('node:url');
              wasmBinary = new Uint8Array(await readFile(fileURLToPath(wasmUrl)));
            } catch {
              // Browser/worker environments rely on Emscripten's own loader.
            }
          }
        }
      }

      const moduleOpts: Record<string, unknown> = {
        locateFile: options.locateFile ?? defaultWasmUrl,
      };

      if (wasmBinary) {
        moduleOpts.wasmBinary = wasmBinary;
        moduleOpts.instantiateWasm = (
          imports: WebAssembly.Imports,
          receiveInstance: (instance: WebAssembly.Instance) => void,
        ) => {
          const binary = wasmBinary;
          void (
            WebAssembly.instantiate(binary, imports) as unknown as Promise<WebAssembly.WebAssemblyInstantiatedSource>
          ).then((result) => {
            receiveInstance(result.instance);
          });
          return {};
        };
      }

      const mod = await createModule.default(moduleOpts);
      return new Sgp4WasmEngine(mod);
    } catch (error) {
      console.warn('[Sgp4WasmEngine] WASM load failed, using satellite.js fallback:', error);
      return null;
    }
  }

  get loadedCount(): number {
    return this.catalogCount;
  }

  loadCatalog(tles: readonly TleLinePair[]): number {
    return this.loadPacked(packTleCatalog(tles));
  }

  loadPacked(packed: Uint8Array): number {
    const ptr = this.mod._malloc(packed.byteLength);
    try {
      this.mod.HEAPU8.set(packed, ptr);
      this.catalogCount = this.mod._sgp4_load_catalog(ptr, packed.byteLength);
      return this.catalogCount;
    } finally {
      this.mod._free(ptr);
    }
  }

  /**
   * Batch-propagate catalog entries [startIndex, startIndex + count).
   * Output layout: count × 6 floats (x,y,z km, vx,vy,vz km/s).
   */
  propagateBatch(
    unixMs: number,
    startIndex: number,
    count: number,
    out?: Float32Array,
  ): Float32Array {
    return this.propagateBatchEx(unixMs, startIndex, count, out).eci;
  }

  /** Same as propagateBatch plus per-satellite Vallado error codes (0 = ok). */
  propagateBatchEx(
    unixMs: number,
    startIndex: number,
    count: number,
    out?: Float32Array,
  ): Sgp4BatchResult {
    const limit = Math.min(count, Math.max(0, this.catalogCount - startIndex));
    const floats = limit * 6;
    const buffer = out && out.length >= floats ? out : new Float32Array(floats);
    const errors = new Int32Array(limit);
    if (limit === 0) {
      return { eci: buffer.subarray(0, 0), errors };
    }

    const ptr = this.mod._malloc(floats * 4);
    const errPtr = this.mod._sgp4_propagate_batch_ex ? this.mod._malloc(limit * 4) : 0;
    try {
      const written = this.mod._sgp4_propagate_batch_ex
        ? this.mod._sgp4_propagate_batch_ex(unixMs, ptr, errPtr, startIndex, limit)
        : this.mod._sgp4_propagate_batch(unixMs, ptr, startIndex, limit);
      const copyFloats = written > 0 ? written * 6 : floats;
      buffer.set(this.mod.HEAPF32.subarray(ptr >> 2, (ptr >> 2) + copyFloats));
      if (errPtr && written > 0) {
        errors.set(this.mod.HEAP32.subarray(errPtr >> 2, (errPtr >> 2) + written));
      }
      return { eci: buffer.subarray(0, copyFloats), errors: errors.subarray(0, Math.max(0, written)) };
    } finally {
      this.mod._free(ptr);
      if (errPtr) this.mod._free(errPtr);
    }
  }

  catalogEpochJd(index: number): number {
    if (!this.mod._sgp4_catalog_epoch_jd) return 0;
    return this.mod._sgp4_catalog_epoch_jd(index);
  }

  clear(): void {
    this.mod._sgp4_clear_catalog();
    this.catalogCount = 0;
  }
}
