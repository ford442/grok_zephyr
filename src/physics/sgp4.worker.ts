/// <reference lib="webworker" />

import { Sgp4WasmEngine } from './Sgp4WasmEngine.js';
import { packExtendedFromEciBatch } from './sgp4PackExtended.js';
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
        case 'propagate': {
          if (!engine) {
            post({ id: msg.id, type: 'error', message: 'SGP4 worker WASM not ready' });
            break;
          }
          const { eci, errors } = engine.propagateBatchEx(msg.unixMs, msg.start, msg.count);
          const dest = new Float32Array(errors.length * EXTENDED_FLOATS_PER_SATELLITE);
          packExtendedFromEciBatch(eci, errors, dest, 0);
          post(
            {
              id: msg.id,
              type: 'propagated',
              start: msg.start,
              extended: dest.buffer,
              count: errors.length,
            },
            [dest.buffer],
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
