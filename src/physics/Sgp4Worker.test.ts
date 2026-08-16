import { describe, expect, it, beforeAll } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TLELoader } from '@/data/TLELoader.js';
import { Sgp4WasmEngine } from './Sgp4WasmEngine.js';
import { propagatePackedInProcess } from './Sgp4Worker.js';
import { sgp4ErrorFromFlag } from './extendedElements.js';

const SAMPLE_TLE = `STARLINK-1007
1 44713U 19074A   24356.50000000  .00001256  00000-0  11371-3 0  9991
2 44713  53.0000  85.0000 0001000  50.0000 310.0000 15.06397611123456
`;

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '../../public');

describe('Sgp4 worker packing (in-process)', () => {
  let engine: Sgp4WasmEngine | null = null;

  beforeAll(async () => {
    const { readFile } = await import('node:fs/promises');
    const wasmBinary = new Uint8Array(await readFile(join(publicDir, 'sgp4.wasm')));
    engine = await Sgp4WasmEngine.tryLoad({
      moduleUrl: pathToFileURL(join(publicDir, 'sgp4.js')).href,
      wasmBinary,
      locateFile: (path) => pathToFileURL(join(publicDir, path)).href,
    });
  });

  it('round-trips a packed extended slice and reports TLE epoch JD', () => {
    if (!engine) return;
    const tles = TLELoader.parse(SAMPLE_TLE);
    engine.loadCatalog(tles);
    const dateMs = Date.UTC(2024, 11, 22, 12, 0, 0);
    const packed = propagatePackedInProcess(engine, dateMs, 0, 1);
    expect(packed.count).toBe(1);
    expect(packed.extended.length).toBe(8);
    expect(sgp4ErrorFromFlag(packed.extended[7])).toBeNull();
    expect(packed.extended[0]).toBeGreaterThan(6400);
    const jd = engine.catalogEpochJd(0);
    expect(jd).toBeGreaterThan(2460000);
    expect(jd).toBeLessThan(2461000);
  });
});
