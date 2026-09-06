/// <reference lib="webworker" />

import { Sgp4WasmEngine } from './Sgp4WasmEngine.js';
import { EXTENDED_FLOATS_PER_SATELLITE } from './extendedElements.js';
import type { Sgp4WorkerRequest, Sgp4WorkerResponse } from './sgp4WorkerProtocol.js';

let engine: Sgp4WasmEngine | null = null;

function post(response: Sgp4WorkerResponse, transfer?: Transferable[]): void {
  if (transfer && transfer.length > 0) {
    self.postMessage(response, transfer);
  } else {
    self.postMessage(response);
  }
}

self.onmessage = (event: MessageEvent<Sgp4WorkerRequest>) => {
  const msg = event.data;
  void (async () => {
    try {
      switch (msg.type) {
        case 'init': {
          engine = await Sgp4WasmEngine.tryLoad();
          post({ id: msg.id, type: 'ready', ok: engine !== null });
          break;
        }
        case 'load': {
          if (!engine) {
            post({ id: msg.id, type: 'error', message: 'SGP4 worker WASM not ready' });
            break;
          }
          const count = engine.loadPacked(new Uint8Array(msg.packed));
          post({ id: msg.id, type: 'loaded', count });
          break;
        }
        case 'propagate':
        case 'propagatePackedKeplerian': {
          if (!engine) {
            post({ id: msg.id, type: 'error', message: 'SGP4 worker WASM not ready' });
            break;
          }
          const dest = engine.propagateBatchKeplerian(msg.unixMs, msg.start, msg.count);
          const compact = dest.slice();
          post(
            {
              id: msg.id,
              type: 'propagated',
              start: msg.start,
              extended: compact.buffer,
              count: compact.length / EXTENDED_FLOATS_PER_SATELLITE,
            },
            [compact.buffer],
          );
          break;
        }
        case 'epoch': {
          post({ id: msg.id, type: 'epoch', jd: engine?.catalogEpochJd(msg.index) ?? 0 });
          break;
        }
        default:
          break;
      }
    } catch (error) {
      post({
        id: msg.id,
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  })();
};
