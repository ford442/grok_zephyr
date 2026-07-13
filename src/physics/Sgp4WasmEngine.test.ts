import { describe, it, expect, beforeAll } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TLELoader } from '@/data/TLELoader.js';
import { TlePropagator } from './TlePropagator.js';
import { Sgp4WasmEngine } from './Sgp4WasmEngine.js';

const SAMPLE_TLE = `STARLINK-1007
1 44713U 19074A   24356.50000000  .00001256  00000-0  11371-3 0  9991
2 44713  53.0000  85.0000 0001000  50.0000 310.0000 15.06397611123456
ISS (ZARYA)
1 25544U 98067A   24356.50000000  .00010000  00000-0  15000-3 0  9990
2 25544  51.6400 120.0000 0002000  90.0000 270.0000 15.50000000123456
`;

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '../../public');

async function loadWasmBinary(): Promise<Uint8Array> {
  const { readFile } = await import('node:fs/promises');
  return new Uint8Array(await readFile(join(publicDir, 'sgp4.wasm')));
}

describe('Sgp4WasmEngine', () => {
  let engine: Sgp4WasmEngine | null = null;

  beforeAll(async () => {
    const wasmBinary = await loadWasmBinary();
    engine = await Sgp4WasmEngine.tryLoad({
      moduleUrl: pathToFileURL(join(publicDir, 'sgp4.js')).href,
      wasmBinary,
      locateFile: (path) => pathToFileURL(join(publicDir, path)).href,
    });
  });

  it('loads WASM module from prebuilt public artifacts', () => {
    expect(engine).not.toBeNull();
  });

  it('agrees with satellite.js within 1e-3 km over a 24h window', () => {
    if (!engine) return;

    const tles = TLELoader.parse(SAMPLE_TLE);
    const js = new TlePropagator();
    js.load(tles);
    engine.loadCatalog(tles);

    const startMs = Date.UTC(2024, 11, 22, 12, 0, 0);
    const stepMs = 6 * 60 * 60 * 1000;

    for (let t = 0; t <= 24; t += 6) {
      const dateMs = startMs + t * stepMs;
      for (let i = 0; i < tles.length; i++) {
        const jsPos = js.propagatePositionEci(i, dateMs);
        const wasmBatch = engine.propagateBatch(dateMs, i, 1);
        expect(jsPos).not.toBeNull();
        const dx = Math.abs(jsPos![0] - wasmBatch[0]);
        const dy = Math.abs(jsPos![1] - wasmBatch[1]);
        const dz = Math.abs(jsPos![2] - wasmBatch[2]);
        expect(Math.hypot(dx, dy, dz)).toBeLessThan(1e-3);
      }
    }
  });
});

describe('TlePropagator WASM integration', () => {
  it('falls back to satellite.js when WASM module URL is invalid', async () => {
    const tles = TLELoader.parse(SAMPLE_TLE);
    const propagator = new TlePropagator();
    propagator.load(tles);

    const broken = await Sgp4WasmEngine.tryLoad({ moduleUrl: '/missing/sgp4.js' });
    expect(broken).toBeNull();

    const pos = propagator.propagatePositionEci(0, Date.now());
    expect(pos).not.toBeNull();
    expect(propagator.getBackend()).toBe('js');
  });

  it('uses WASM after initWasm when artifacts are available', async () => {
    const tles = TLELoader.parse(SAMPLE_TLE);
    const propagator = new TlePropagator();
    propagator.load(tles);

    const ok = await propagator.initWasm();
    expect(ok).toBe(true);
    expect(propagator.isWasmActive()).toBe(true);
    expect(propagator.getBackend()).toBe('wasm');
  });
});
