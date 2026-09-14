import { describe, it, expect, beforeAll } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { twoline2satrec } from 'satellite.js';
import { TLELoader } from '@/data/TLELoader.js';
import { Sgp4WasmEngine } from './Sgp4WasmEngine.js';
import {
  SGP4_GPU_CAPACITY,
  SGP4_GPU_FLOATS_PER_SLOT,
  SGP4_GPU_HEADER_FLOATS,
  packSgp4GpuSlot,
  propagateSgp4GpuSlot,
  sgp4NearEarthInit,
  sgp4NearEarthPosition,
  sgp4MeanElementsFromSatrec,
  writeSgp4GpuHeader,
} from './sgp4NearEarth.js';

/**
 * Near-earth fixture: low-drag LEO, high-drag ISS, eccentric Molniya-like
 * near-earth (period < 225 min), a sun-synchronous polar, and a low-perigee
 * `isimp` orbit. The last entry is a GPS (deep space) and must not pack.
 */
const FIXTURE = `STARLINK-1007
1 44713U 19074A   24356.50000000  .00001256  00000-0  11371-3 0  9991
2 44713  53.0000  85.0000 0001000  50.0000 310.0000 15.06397611123456
ISS (ZARYA)
1 25544U 98067A   24356.50000000  .00010000  00000-0  15000-3 0  9990
2 25544  51.6400 120.0000 0002000  90.0000 270.0000 15.50000000123456
ECCENTRIC-LEO
1 90001U 24001A   24356.25000000  .00000500  00000-0  40000-4 0  9990
2 90001  63.4000 200.0000 0850000 270.0000  30.0000 12.80000000 10000
SSO-POLAR
1 90002U 24001B   24355.75000000  .00000200  00000-0  25000-4 0  9990
2 90002  97.6000  10.0000 0012000 120.0000 240.0000 14.90000000 10000
LOW-PERIGEE
1 90003U 24001C   24356.40000000  .00050000  00000-0  50000-3 0  9990
2 90003  28.5000 300.0000 0150000  45.0000 315.0000 15.90000000 10000
GPS-DEEP
1 90004U 24001D   24356.00000000 -.00000020  00000-0  00000+0 0  9990
2 90004  55.0000  60.0000 0050000  30.0000 330.0000  2.00560000 10000
`;

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '../../public');

describe('near-earth SGP4 GPU kernel (CPU mirror) vs Vallado WASM', () => {
  let engine: Sgp4WasmEngine | null = null;
  const tles = TLELoader.parse(FIXTURE);
  const simEpochMs = Date.UTC(2024, 11, 22, 12, 0, 0);

  beforeAll(async () => {
    const { readFile } = await import('node:fs/promises');
    engine = await Sgp4WasmEngine.tryLoad({
      moduleUrl: pathToFileURL(join(publicDir, 'sgp4.js')).href,
      wasmBinary: new Uint8Array(await readFile(join(publicDir, 'sgp4.wasm'))),
      locateFile: (path) => pathToFileURL(join(publicDir, path)).href,
    });
    engine?.loadCatalog(tles);
  });

  function packAt(baseSimSec: number): Float32Array {
    const packed = new Float32Array(SGP4_GPU_HEADER_FLOATS + tles.length * SGP4_GPU_FLOATS_PER_SLOT);
    writeSgp4GpuHeader(packed, baseSimSec, tles.length);
    tles.forEach((tle, k) => {
      const el = sgp4MeanElementsFromSatrec(twoline2satrec(tle.line1, tle.line2));
      packSgp4GpuSlot(packed, k, el, simEpochMs + baseSimSec * 1000);
    });
    return packed;
  }

  it('skips deep-space records', () => {
    const packed = packAt(0);
    expect(propagateSgp4GpuSlot(packed, 5, 0)).toBeNull();
    for (let k = 0; k < 5; k++) expect(propagateSgp4GpuSlot(packed, k, 0)).not.toBeNull();
  });

  it('stays within 0.1 km of Vallado over 6 h from float32-packed elements', () => {
    expect(engine).not.toBeNull();
    if (!engine) return;
    const packed = packAt(0);
    let worst = 0;
    for (let simSec = 0; simSec <= 6 * 3600; simSec += 600) {
      const ref = engine.propagateBatchEx(simEpochMs + simSec * 1000, 0, 5);
      for (let k = 0; k < 5; k++) {
        expect(ref.errors[k]).toBe(0);
        const p = propagateSgp4GpuSlot(packed, k, simSec);
        expect(p).not.toBeNull();
        const b = k * 6;
        const d = Math.hypot(p![0] - ref.eci[b], p![1] - ref.eci[b + 1], p![2] - ref.eci[b + 2]);
        worst = Math.max(worst, d);
      }
    }
    expect(worst).toBeLessThan(0.1);
  });

  it('holds the bound with float32 coefficients and time (GPU precision model)', () => {
    if (!engine) return;
    const f = Math.fround;
    const packed = packAt(0);
    let worst = 0;
    for (let simSec = 0; simSec <= 4 * 3600; simSec += 900) {
      const ref = engine.propagateBatchEx(simEpochMs + simSec * 1000, 0, 5);
      for (let k = 0; k < 5; k++) {
        const o = SGP4_GPU_HEADER_FLOATS + k * SGP4_GPU_FLOATS_PER_SLOT;
        const init = sgp4NearEarthInit(packed[o], packed[o + 1], packed[o + 2], packed[o + 3], packed[o + 8], packed[o + 9]);
        const f32Init = Object.fromEntries(
          Object.entries(init).map(([key, v]) => [key, typeof v === 'number' ? f(v) : v]),
        ) as typeof init;
        const p = sgp4NearEarthPosition(f32Init, packed[o + 4], packed[o + 5], packed[o + 6], packed[o + 7], f(simSec / 60))!;
        const b = k * 6;
        worst = Math.max(worst, Math.hypot(p[0] - ref.eci[b], p[1] - ref.eci[b + 1], p[2] - ref.eci[b + 2]));
      }
    }
    expect(worst).toBeLessThan(0.1);
  });

  it('re-basing phases does not move the answer', () => {
    const a = packAt(0);
    const b = packAt(3 * 3600);
    for (let k = 0; k < 5; k++) {
      const pa = propagateSgp4GpuSlot(a, k, 3 * 3600 + 120)!;
      const pb = propagateSgp4GpuSlot(b, k, 3 * 3600 + 120)!;
      expect(Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2])).toBeLessThan(0.05);
    }
  });

  it('fits the compact buffer well inside the Pascal cap', () => {
    expect((SGP4_GPU_HEADER_FLOATS + SGP4_GPU_CAPACITY * SGP4_GPU_FLOATS_PER_SLOT) * 4).toBeLessThan(
      1024 * 1024,
    );
  });
});
