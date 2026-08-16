export type Sgp4WorkerRequest =
  | { id: number; type: 'init' }
  | { id: number; type: 'load'; packed: ArrayBuffer }
  | { id: number; type: 'propagate'; unixMs: number; start: number; count: number }
  | { id: number; type: 'epoch'; index: number };

export type Sgp4WorkerResponse =
  | { id: number; type: 'ready'; ok: boolean }
  | { id: number; type: 'loaded'; count: number }
  | { id: number; type: 'propagated'; start: number; extended: ArrayBuffer; count: number }
  | { id: number; type: 'epoch'; jd: number }
  | { id: number; type: 'error'; message: string };
