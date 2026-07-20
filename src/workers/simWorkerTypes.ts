import type { TLEData } from '@/types/index.js';
import type { MergedCatalogSegment } from '@/core/OrbitalElements.js';

/** Request payloads posted to the simulation worker (without correlation id). */
export type SimWorkerRequestPayload =
  | { type: 'parse-tle'; text: string }
  | { type: 'fetch-parse-tle'; url: string }
  | {
      type: 'generate-elements';
      numSatellites: number;
      seed?: number;
    }
  | {
      type: 'derive-elements-from-tle';
      tles: TLEData[];
      numSatellites: number;
    }
  | {
      type: 'merge-catalog-elements';
      segments: MergedCatalogSegment[];
      numSatellites: number;
    };

/** Request messages posted to the simulation worker. */
export type SimWorkerRequest = SimWorkerRequestPayload & { id: number };

/** Successful parse response. */
export interface SimWorkerTleParsed {
  id: number;
  type: 'tle-parsed';
  tles: TLEData[];
}

/** Orbital element buffer ready for zero-copy GPU upload. */
export interface SimWorkerElementsReady {
  id: number;
  type: 'elements-ready';
  orbitalBuffer: ArrayBuffer;
  groupIdsBuffer?: ArrayBuffer;
  numSatellites: number;
  realTleCount: number;
  groupCounts?: Record<number, number>;
}

export interface SimWorkerError {
  id: number;
  type: 'error';
  message: string;
}

export type SimWorkerResponse = SimWorkerTleParsed | SimWorkerElementsReady | SimWorkerError;

export interface OrbitalElementsResult {
  orbitalBuffer: ArrayBuffer;
  groupIdsBuffer?: ArrayBuffer;
  numSatellites: number;
  realTleCount: number;
  groupCounts?: Map<number, number>;
}
