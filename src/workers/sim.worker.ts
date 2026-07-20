/// <reference lib="webworker" />

import {
  taskDeriveElementsFromTle,
  taskFetchParseTle,
  taskGenerateElements,
  taskMergeCatalogElements,
  taskParseTle,
} from '@/workers/simWorkerTasks.js';
import type { SimWorkerRequest, SimWorkerResponse } from '@/workers/simWorkerTypes.js';

function postOk(response: SimWorkerResponse, transfer?: Transferable[]): void {
  if (transfer && transfer.length > 0) {
    self.postMessage(response, transfer);
  } else {
    self.postMessage(response);
  }
}

self.onmessage = (event: MessageEvent<SimWorkerRequest>) => {
  const msg = event.data;
  void (async () => {
    try {
      switch (msg.type) {
        case 'parse-tle': {
          const tles = taskParseTle(msg.text);
          postOk({ id: msg.id, type: 'tle-parsed', tles });
          break;
        }
        case 'fetch-parse-tle': {
          const tles = await taskFetchParseTle(msg.url);
          postOk({ id: msg.id, type: 'tle-parsed', tles });
          break;
        }
        case 'generate-elements': {
          const result = taskGenerateElements(msg.numSatellites, msg.seed);
          const transfer: Transferable[] = [result.orbitalBuffer];
          if (result.groupIdsBuffer) transfer.push(result.groupIdsBuffer);
          postOk(
            {
              id: msg.id,
              type: 'elements-ready',
              orbitalBuffer: result.orbitalBuffer,
              groupIdsBuffer: result.groupIdsBuffer,
              numSatellites: result.numSatellites,
              realTleCount: result.realTleCount,
            },
            transfer,
          );
          break;
        }
        case 'derive-elements-from-tle': {
          const result = taskDeriveElementsFromTle(msg.tles, msg.numSatellites);
          const transfer: Transferable[] = [result.orbitalBuffer];
          if (result.groupIdsBuffer) transfer.push(result.groupIdsBuffer);
          postOk(
            {
              id: msg.id,
              type: 'elements-ready',
              orbitalBuffer: result.orbitalBuffer,
              groupIdsBuffer: result.groupIdsBuffer,
              numSatellites: result.numSatellites,
              realTleCount: result.realTleCount,
            },
            transfer,
          );
          break;
        }
        case 'merge-catalog-elements': {
          const result = taskMergeCatalogElements(msg.segments, msg.numSatellites);
          const transfer: Transferable[] = [result.orbitalBuffer];
          if (result.groupIdsBuffer) transfer.push(result.groupIdsBuffer);
          const groupCounts: Record<number, number> = {};
          if (result.groupCounts) {
            for (const [k, v] of result.groupCounts) {
              groupCounts[k] = v;
            }
          }
          postOk(
            {
              id: msg.id,
              type: 'elements-ready',
              orbitalBuffer: result.orbitalBuffer,
              groupIdsBuffer: result.groupIdsBuffer,
              numSatellites: result.numSatellites,
              realTleCount: result.realTleCount,
              groupCounts,
            },
            transfer,
          );
          break;
        }
        default: {
          const _exhaustive: never = msg;
          throw new Error(`Unknown worker request: ${String(_exhaustive)}`);
        }
      }
    } catch (error) {
      postOk({
        id: msg.id,
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  })();
};
