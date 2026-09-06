import { describe, it, expect, beforeAll } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TLELoader } from '@/data/TLELoader.js';
import { TlePropagator } from './TlePropagator.js';
import { Sgp4WasmEngine } from './Sgp4WasmEngine.js';
import { eciStateToKeplerian } from './keplerianFromState.js';

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

  it('loads WASM module from prebuilt public artifacts', async () => {
    expect(engine).not.toBeNull();
    const { stat } = await import('node:fs/promises');
    const { size } = await stat(join(publicDir, 'sgp4.wasm'));
    expect(size).toBeLessThanOrEqual(80 * 1024);
  });

  it('returns epoch JD and zero error codes for a healthy TLE', () => {
    if (!engine) return;
    const tles = TLELoader.parse(SAMPLE_TLE);
    engine.loadCatalog(tles);
    expect(engine.catalogEpochJd(0)).toBeGreaterThan(2_460_000);
    const { eci, errors } = engine.propagateBatchEx(Date.UTC(2024, 11, 22, 12, 0, 0), 0, 1);
    expect(eci.length).toBe(6);
    expect(errors[0]).toBe(0);
    expect(Math.hypot(eci[0], eci[1], eci[2])).toBeGreaterThan(6400);
  });

  it('packs Keplerian extended elements in C++ matching the JS converter', () => {
    if (!engine) return;
    const tles = TLELoader.parse(SAMPLE_TLE);
    engine.loadCatalog(tles);
    const dateMs = Date.UTC(2024, 11, 22, 12, 0, 0);
    const packed = engine.propagateBatchKeplerian(dateMs, 0, 1);
    expect(packed.length).toBe(8);
    expect(packed[7]).toBe(1);
    expect(packed[0]).toBeGreaterThan(6400);

    const eci = engine.propagateBatch(dateMs, 0, 1);
    const js = eciStateToKeplerian(
      { x: eci[0], y: eci[1], z: eci[2] },
      { x: eci[3], y: eci[4], z: eci[5] },
    );
    expect(packed[0]).toBeCloseTo(js.a, 1);
    expect(packed[1]).toBeCloseTo(js.e, 4);
    expect(packed[2]).toBeCloseTo(js.inc, 4);
    expect(packed[6]).toBeCloseTo(js.n, 6);
  });

  it('propagates many epochs for one sat matching single-time batch', () => {
    if (!engine) return;
    const tles = TLELoader.parse(SAMPLE_TLE);
    engine.loadCatalog(tles);
    const startMs = Date.UTC(2024, 11, 22, 12, 0, 0);
    const times = [startMs, startMs + 30_000, startMs + 60_000];
    const multi = engine.propagateEpochs(times, 0, 1);
    expect(multi.length).toBe(18);
    for (let i = 0; i < times.length; i++) {
      const single = engine.propagateBatch(times[i], 0, 1);
      const b = i * 6;
      expect(Math.hypot(multi[b] - single[0], multi[b + 1] - single[1], multi[b + 2] - single[2])).toBeLessThan(
        1e-3,
      );
    }
  });

  it('rotates TEME states to GCRF without changing vector length', () => {
    if (!engine) return;
    const tles = TLELoader.parse(SAMPLE_TLE);
    engine.loadCatalog(tles);
    const dateMs = Date.UTC(2024, 11, 22, 12, 0, 0);
    const teme = engine.propagateBatch(dateMs, 0, 1);
    const gcrf = engine.temeToGcrf(teme, dateMs);
    const temeR = Math.hypot(teme[0], teme[1], teme[2]);
    const gcrfR = Math.hypot(gcrf[0], gcrf[1], gcrf[2]);
    expect(Math.abs(gcrfR - temeR)).toBeLessThan(1e-3);
    const angle = Math.acos(
      Math.min(
        1,
        Math.max(-1, (teme[0] * gcrf[0] + teme[1] * gcrf[1] + teme[2] * gcrf[2]) / (temeR * gcrfR)),
      ),
    );
    expect(angle).toBeGreaterThan(0);
    expect(angle).toBeLessThan(0.01);
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
