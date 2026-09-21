/**
 * WASM is the single TLE catalog authority.
 *
 * Pins the two halves of that claim: `twoline2satrec` is never reached on the
 * success path, and the GPU mean elements C++ packs match the TypeScript
 * reference packer (`sgp4NearEarth.ts`, which stays the WGSL mirror) closely
 * enough that the shader cannot tell them apart.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type * as SatelliteJs from 'satellite.js';
import { twoline2satrec } from 'satellite.js';
import { TLELoader } from '@/data/TLELoader.js';
import { TlePropagator } from './TlePropagator.js';
import { Sgp4WasmEngine } from './Sgp4WasmEngine.js';
import {
  SGP4_GPU_FLOATS_PER_SLOT,
  SGP4_GPU_HEADER_FLOATS,
  packSgp4GpuSlot,
  propagateSgp4GpuSlot,
  sgp4MeanElementsFromSatrec,
  writeSgp4GpuHeader,
} from './sgp4NearEarth.js';

const twoline2satrecSpy = vi.fn();

// vi.mock is hoisted above the imports above, so every module under test sees
// the counting wrapper while still getting the real satellite.js behaviour.
vi.mock('satellite.js', async (importOriginal) => {
  const actual = await importOriginal<typeof SatelliteJs>();
  return {
    ...actual,
    twoline2satrec: (...args: Parameters<typeof actual.twoline2satrec>) => {
      twoline2satrecSpy(...args);
      return actual.twoline2satrec(...args);
    },
  };
});

/** LEO, ISS, eccentric near-earth, SSO, low-perigee, then GPS and GEO (deep space). */
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
GEO-DEEP
1 90005U 24001E   24356.00000000  .00000000  00000-0  00000+0 0  9990
2 90005   0.0300  85.0000 0002000  10.0000 350.0000  1.00270000 10000
`;

const NEAR_EARTH = 5;
const publicDir = join(dirname(fileURLToPath(import.meta.url)), '../../public');
const tles = TLELoader.parse(FIXTURE);
const baseUnixMs = Date.UTC(2024, 11, 22, 12, 0, 0);

function emptyGpuBuffer(): Float32Array {
  return new Float32Array(SGP4_GPU_HEADER_FLOATS + tles.length * SGP4_GPU_FLOATS_PER_SLOT);
}

describe('WASM is the single TLE catalog authority', () => {
  let engine: Sgp4WasmEngine | null = null;

  beforeAll(async () => {
    const { readFile } = await import('node:fs/promises');
    engine = await Sgp4WasmEngine.tryLoad({
      moduleUrl: pathToFileURL(join(publicDir, 'sgp4.js')).href,
      wasmBinary: new Uint8Array(await readFile(join(publicDir, 'sgp4.wasm'))),
      locateFile: (path) => pathToFileURL(join(publicDir, path)).href,
    });
    engine?.loadCatalog(tles);
  });

  it('never parses a TLE with satellite.js once WASM is up', async () => {
    const propagator = new TlePropagator();
    propagator.load(tles);
    expect(await propagator.initWasm()).toBe(true);

    twoline2satrecSpy.mockClear();
    // Everything the app does on the success path for ?tle=gps / mixed active.
    propagator.propagatePositionEci(0, baseUnixMs);
    propagator.packGpuSgp4Slots(emptyGpuBuffer(), 0, baseUnixMs, 0, tles.length);
    propagator.applyKeplerianBatch(baseUnixMs, 0, tles.length, () => {});
    await propagator.applyPackedBatch(baseUnixMs, 0, tles.length);
    propagator.propagatePositionsAtEpochs(0, [baseUnixMs, baseUnixMs + 60_000]);
    propagator.catalogEpochJd(0);
    propagator.propagationClassCounts();
    propagator.rejectedCount();

    expect(twoline2satrecSpy).not.toHaveBeenCalled();
  });

  it('still parses with satellite.js on the load-failure fallback', () => {
    const propagator = new TlePropagator();
    propagator.load(tles);
    twoline2satrecSpy.mockClear();
    // No initWasm(): this is the no-WASM / no-Worker path.
    expect(propagator.getBackend()).toBe('js');
    expect(propagator.propagatePositionEci(0, baseUnixMs)).not.toBeNull();
    expect(twoline2satrecSpy).toHaveBeenCalled();
  });

  it('packs GPU mean elements in C++ matching the TypeScript reference packer', () => {
    expect(engine).not.toBeNull();
    if (!engine) return;

    const fromCpp = emptyGpuBuffer();
    const valid = engine.packGpuElements(
      baseUnixMs,
      0,
      tles.length,
      fromCpp,
      SGP4_GPU_HEADER_FLOATS,
    );
    writeSgp4GpuHeader(fromCpp, 0, tles.length);
    expect(valid).toBe(NEAR_EARTH);

    const fromTs = emptyGpuBuffer();
    writeSgp4GpuHeader(fromTs, 0, tles.length);
    tles.forEach((tle, k) => {
      packSgp4GpuSlot(fromTs, k, sgp4MeanElementsFromSatrec(twoline2satrec(tle.line1, tle.line2)), baseUnixMs);
    });

    for (let k = 0; k < NEAR_EARTH; k++) {
      const o = SGP4_GPU_HEADER_FLOATS + k * SGP4_GPU_FLOATS_PER_SLOT;
      // Mean elements and tsince are copied straight out of the same Vallado
      // sgp4init, so these are float32-identical.
      for (const f of [0, 1, 2, 3, 7, 8, 9]) {
        expect(fromCpp[o + f]).toBeCloseTo(fromTs[o + f], 6);
      }
      // Secular phases are advanced in float64 by each side's own libm.
      for (const f of [4, 5, 6]) {
        const d = Math.abs(fromCpp[o + f] - fromTs[o + f]);
        expect(Math.min(d, Math.abs(d - 2 * Math.PI))).toBeLessThan(1e-5);
      }
    }

    // Deep-space slots are zeroed on both sides (the shader reads "no SGP4").
    for (let k = NEAR_EARTH; k < tles.length; k++) {
      const o = SGP4_GPU_HEADER_FLOATS + k * SGP4_GPU_FLOATS_PER_SLOT;
      expect(Array.from(fromCpp.subarray(o, o + SGP4_GPU_FLOATS_PER_SLOT))).toEqual(
        new Array(SGP4_GPU_FLOATS_PER_SLOT).fill(0),
      );
      expect(propagateSgp4GpuSlot(fromCpp, k, 0)).toBeNull();
    }

    // What actually matters: the WGSL mirror cannot tell the packings apart.
    for (let simSec = 0; simSec <= 3 * 3600; simSec += 900) {
      for (let k = 0; k < NEAR_EARTH; k++) {
        const a = propagateSgp4GpuSlot(fromCpp, k, simSec)!;
        const b = propagateSgp4GpuSlot(fromTs, k, simSec)!;
        expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(0.05);
      }
    }
  });

  it('C++-packed slots track Vallado over 6 h as tightly as the TS packing did', () => {
    if (!engine) return;
    const packed = emptyGpuBuffer();
    engine.packGpuElements(baseUnixMs, 0, tles.length, packed, SGP4_GPU_HEADER_FLOATS);
    writeSgp4GpuHeader(packed, 0, tles.length);

    let worst = 0;
    for (let simSec = 0; simSec <= 6 * 3600; simSec += 600) {
      const ref = engine.propagateBatchEx(baseUnixMs + simSec * 1000, 0, NEAR_EARTH);
      for (let k = 0; k < NEAR_EARTH; k++) {
        expect(ref.errors[k]).toBe(0);
        const p = propagateSgp4GpuSlot(packed, k, simSec)!;
        const b = k * 6;
        worst = Math.max(
          worst,
          Math.hypot(p[0] - ref.eci[b], p[1] - ref.eci[b + 1], p[2] - ref.eci[b + 2]),
        );
      }
    }
    expect(worst).toBeLessThan(0.1);
  });
});

describe('deep-space records run CPU SDP4, not GPU near-earth SGP4', () => {
  it('classifies the catalog and keeps GPS/GEO off the GPU kernel', async () => {
    const propagator = new TlePropagator();
    propagator.load(tles);
    expect(await propagator.initWasm()).toBe(true);

    expect(propagator.propagationClassCounts()).toEqual({
      sgp4Gpu: NEAR_EARTH,
      sdp4Cpu: tles.length - NEAR_EARTH,
      j2: 0,
    });
    for (let i = 0; i < NEAR_EARTH; i++) {
      expect(propagator.propagationClass(i)).toBe('sgp4-gpu');
    }
    for (let i = NEAR_EARTH; i < tles.length; i++) {
      expect(propagator.propagationClass(i)).toBe('sdp4-cpu');
    }

    // GPS/GEO still propagate — through Vallado SDP4 in WASM, on the CPU.
    for (let i = NEAR_EARTH; i < tles.length; i++) {
      const pos = propagator.propagatePositionEci(i, baseUnixMs);
      expect(pos).not.toBeNull();
      expect(Math.hypot(...pos!)).toBeGreaterThan(20_000);
    }
  });

  it('agrees with the satellite.js SDP4 oracle for deep space over 24 h', async () => {
    const wasm = new TlePropagator();
    wasm.load(tles);
    expect(await wasm.initWasm()).toBe(true);
    const js = new TlePropagator();
    js.load(tles);

    for (let h = 0; h <= 24; h += 8) {
      const dateMs = baseUnixMs + h * 3600_000;
      for (let i = NEAR_EARTH; i < tles.length; i++) {
        const a = wasm.propagatePositionEci(i, dateMs)!;
        const b = js.propagatePositionEci(i, dateMs)!;
        // The WASM batch is float32, whose quantum at GEO (~42 000 km) is
        // already ~2.5e-3 km, so the LEO-style 1e-3 km floor is scaled by radius.
        const r = Math.hypot(b[0], b[1], b[2]);
        expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(
          Math.max(1e-3, r * 1e-7),
        );
      }
    }
  });
});

describe('near-earth SIMD kernel', () => {
  let engine: Sgp4WasmEngine | null = null;

  beforeAll(async () => {
    const { readFile } = await import('node:fs/promises');
    engine = await Sgp4WasmEngine.tryLoad({
      moduleUrl: pathToFileURL(join(publicDir, 'sgp4.js')).href,
      wasmBinary: new Uint8Array(await readFile(join(publicDir, 'sgp4.wasm'))),
      locateFile: (path) => pathToFileURL(join(publicDir, path)).href,
    });
    engine?.loadCatalog(tles);
  });

  it('matches the satellite.js oracle within 1e-3 km over 24 h', () => {
    if (!engine) return;
    const js = new TlePropagator();
    js.load(tles);

    for (let h = 0; h <= 24; h += 6) {
      const dateMs = baseUnixMs + h * 3600_000;
      const batch = engine.propagateBatchEx(dateMs, 0, NEAR_EARTH);
      for (let i = 0; i < NEAR_EARTH; i++) {
        expect(batch.errors[i]).toBe(0);
        const ref = js.propagatePositionEci(i, dateMs)!;
        const b = i * 6;
        expect(
          Math.hypot(batch.eci[b] - ref[0], batch.eci[b + 1] - ref[1], batch.eci[b + 2] - ref[2]),
        ).toBeLessThan(1e-3);
      }
    }
  });

  it('gives the same state whatever the slice alignment (pair / odd tail / mixed)', () => {
    if (!engine) return;
    const dateMs = baseUnixMs + 5 * 3600_000;
    const full = engine.propagateBatchEx(dateMs, 0, tles.length);

    // Lane pairing must not depend on where a batch starts or ends, including
    // slices that straddle the deep-space records at indices 5 and 6.
    for (let start = 0; start < tles.length; start++) {
      for (let count = 1; count <= tles.length - start; count++) {
        const slice = engine.propagateBatchEx(dateMs, start, count);
        for (let i = 0; i < count; i++) {
          expect(slice.errors[i]).toBe(full.errors[start + i]);
          for (let k = 0; k < 6; k++) {
            expect(slice.eci[i * 6 + k]).toBe(full.eci[(start + i) * 6 + k]);
          }
        }
      }
    }
  });

  it('propagateEpochs pairs epochs of one satellite without changing the answer', () => {
    if (!engine) return;
    const times = [0, 30_000, 60_000, 90_000, 150_000].map((d) => baseUnixMs + d);
    for (let i = 0; i < tles.length; i++) {
      const multi = engine.propagateEpochs(times, i, 1);
      for (let e = 0; e < times.length; e++) {
        const single = engine.propagateBatch(times[e], i, 1);
        for (let k = 0; k < 6; k++) {
          expect(multi[e * 6 + k]).toBe(single[k]);
        }
      }
    }
  });
});
