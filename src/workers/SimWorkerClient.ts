/**
 * Main-thread client for the simulation worker.
 *
 * Falls back to in-thread execution when Workers are unavailable (Vitest/Node).
 */

import {
  taskDeriveElementsFromTle,
  taskFetchParseTle,
  taskGenerateElements,
  taskMergeCatalogElements,
  taskParseTle,
} from '@/workers/simWorkerTasks.js';
import type {
  OrbitalElementsResult,
  SimWorkerRequest,
  SimWorkerRequestPayload,
  SimWorkerResponse,
} from '@/workers/simWorkerTypes.js';
import type { MergedCatalogSegment } from '@/core/OrbitalElements.js';
import type { TLEData } from '@/types/index.js';

type PendingEntry = {
  resolve: (value: SimWorkerResponse) => void;
  reject: (reason: Error) => void;
};

let sharedClient: SimWorkerClient | null = null;

export function getSimWorkerClient(): SimWorkerClient {
  if (!sharedClient) {
    sharedClient = new SimWorkerClient();
  }
  return sharedClient;
}

/** Reset singleton — tests only. */
export function resetSimWorkerClientForTests(): void {
  sharedClient?.terminate();
  sharedClient = null;
}

export class SimWorkerClient {
  private readonly worker: Worker | null;
  private readonly useMainThread: boolean;
  private nextId = 1;
  private readonly pending = new Map<number, PendingEntry>();

  constructor() {
    if (typeof Worker === 'undefined') {
      this.worker = null;
      this.useMainThread = true;
      return;
    }

    try {
      this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
      this.useMainThread = false;
      this.worker.onmessage = (event: MessageEvent<SimWorkerResponse>) => {
        const response = event.data;
        const entry = this.pending.get(response.id);
        if (!entry) return;
        this.pending.delete(response.id);
        entry.resolve(response);
      };
      this.worker.onerror = (event) => {
        const err = new Error(event.message || 'Simulation worker error');
        for (const [, entry] of this.pending) {
          entry.reject(err);
        }
        this.pending.clear();
      };
    } catch {
      this.worker = null;
      this.useMainThread = true;
    }
  }

  /** Parse TLE text off the main thread when a worker is available. */
  async parseTLE(text: string): Promise<TLEData[]> {
    const response = await this.request({ type: 'parse-tle', text });
    if (response.type !== 'tle-parsed') {
      throw new Error(response.type === 'error' ? response.message : 'Unexpected worker response');
    }
    return response.tles;
  }

  /** Fetch and parse a TLE URL off the main thread. */
  async fetchParseTLE(url: string): Promise<TLEData[]> {
    const response = await this.request({ type: 'fetch-parse-tle', url });
    if (response.type !== 'tle-parsed') {
      throw new Error(response.type === 'error' ? response.message : 'Unexpected worker response');
    }
    return response.tles;
  }

  /** Generate procedural orbital elements; buffer is transferred when using a worker. */
  async generateOrbitalElements(
    numSatellites: number,
    seed?: number,
  ): Promise<OrbitalElementsResult> {
    const response = await this.request({ type: 'generate-elements', numSatellites, seed });
    return this.unwrapElements(response);
  }

  /** Derive orbital elements from TLE records with procedural padding. */
  async deriveOrbitalElementsFromTLE(
    tles: TLEData[],
    numSatellites: number,
  ): Promise<OrbitalElementsResult> {
    const response = await this.request({ type: 'derive-elements-from-tle', tles, numSatellites });
    return this.unwrapElements(response);
  }

  /** Merge multiple catalog segments with per-group IDs. */
  async mergeCatalogElements(
    segments: MergedCatalogSegment[],
    numSatellites: number,
  ): Promise<OrbitalElementsResult> {
    const response = await this.request({
      type: 'merge-catalog-elements',
      segments,
      numSatellites,
    });
    return this.unwrapElements(response);
  }

  terminate(): void {
    this.worker?.terminate();
    for (const [, entry] of this.pending) {
      entry.reject(new Error('Simulation worker terminated'));
    }
    this.pending.clear();
  }

  private unwrapElements(response: SimWorkerResponse): OrbitalElementsResult {
    if (response.type === 'error') {
      throw new Error(response.message);
    }
    if (response.type !== 'elements-ready') {
      throw new Error(`Expected elements-ready, got ${response.type}`);
    }
    return {
      orbitalBuffer: response.orbitalBuffer,
      groupIdsBuffer: response.groupIdsBuffer,
      numSatellites: response.numSatellites,
      realTleCount: response.realTleCount,
      groupCounts: response.groupCounts
        ? new Map(Object.entries(response.groupCounts).map(([k, v]) => [Number(k), v]))
        : undefined,
    };
  }

  private request(payload: SimWorkerRequestPayload): Promise<SimWorkerResponse> {
    const id = this.nextId++;
    if (this.useMainThread) {
      return this.runOnMainThread(id, payload);
    }

    return new Promise<SimWorkerResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ ...payload, id } satisfies SimWorkerRequest);
    });
  }

  private async runOnMainThread(
    id: number,
    payload: SimWorkerRequestPayload,
  ): Promise<SimWorkerResponse> {
    try {
      switch (payload.type) {
        case 'parse-tle':
          return { id, type: 'tle-parsed', tles: taskParseTle(payload.text) };
        case 'fetch-parse-tle':
          return { id, type: 'tle-parsed', tles: await taskFetchParseTle(payload.url) };
        case 'generate-elements': {
          const result = taskGenerateElements(payload.numSatellites, payload.seed);
          return {
            id,
            type: 'elements-ready',
            orbitalBuffer: result.orbitalBuffer,
            groupIdsBuffer: result.groupIdsBuffer,
            numSatellites: result.numSatellites,
            realTleCount: result.realTleCount,
          };
        }
        case 'derive-elements-from-tle': {
          const result = taskDeriveElementsFromTle(payload.tles, payload.numSatellites);
          return {
            id,
            type: 'elements-ready',
            orbitalBuffer: result.orbitalBuffer,
            groupIdsBuffer: result.groupIdsBuffer,
            numSatellites: result.numSatellites,
            realTleCount: result.realTleCount,
          };
        }
        case 'merge-catalog-elements': {
          const result = taskMergeCatalogElements(payload.segments, payload.numSatellites);
          const groupCounts: Record<number, number> = {};
          if (result.groupCounts) {
            for (const [k, v] of result.groupCounts) {
              groupCounts[k] = v;
            }
          }
          return {
            id,
            type: 'elements-ready',
            orbitalBuffer: result.orbitalBuffer,
            groupIdsBuffer: result.groupIdsBuffer,
            numSatellites: result.numSatellites,
            realTleCount: result.realTleCount,
            groupCounts,
          };
        }
        default: {
          const _exhaustive: never = payload;
          throw new Error(`Unknown worker request: ${String(_exhaustive)}`);
        }
      }
    } catch (error) {
      return {
        id,
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
