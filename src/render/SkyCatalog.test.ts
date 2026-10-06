import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mat4lookAt, mat4mul, mat4persp } from '@/utils/math.js';
import { mat3MulVec, unixMsToJulianDate, gcrfToTemeMatrix, type Mat3 } from '@/physics/frames.js';
import type { QualityLevel } from '@/core/QualityPresets.js';
import {
  ICRS_TO_LEGACY_GALACTIC,
  LEGACY_GALACTIC_NORTH,
  SKY_CATALOG_ASSET,
  SKY_CATALOG_SETTINGS_BYTE_SIZE,
  catalogStar,
  decodeStarCatalog,
  isStarOccludedByEarth,
  packSkyCatalogSettings,
  parseSkyMode,
  projectStarToNdc,
  skyFrameMatrix,
  type StarCatalog,
} from './SkyCatalog.js';

type V3 = [number, number, number];
const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const DEG = Math.PI / 180;

function radec(raDeg: number, decDeg: number): V3 {
  const a = raDeg * DEG;
  const d = decDeg * DEG;
  return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
}

function angleDeg(a: readonly number[], b: readonly number[]): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.min(1, Math.max(-1, dot))) / DEG;
}

function loadCommittedCatalog(): StarCatalog {
  const bytes = readFileSync(new URL(`../../public/${SKY_CATALOG_ASSET}`, import.meta.url));
  return decodeStarCatalog(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

/**
 * SIMBAD J2000 positions and V magnitudes, typed in independently of the
 * build script so a column or epoch mistake in it would fail here.
 */
const NAMED: Record<string, { hip: number; ra: number; dec: number; v: number }> = {
  polaris: { hip: 11767, ra: 37.95456067, dec: 89.26410897, v: 1.98 },
  acrux: { hip: 60718, ra: 186.64956354, dec: -63.09909286, v: 0.76 },
  alnitak: { hip: 26727, ra: 85.18969443, dec: -1.94257359, v: 1.77 },
  alnilam: { hip: 26311, ra: 84.05338894, dec: -1.20191914, v: 1.69 },
  mintaka: { hip: 25930, ra: 83.00166706, dec: -0.29909204, v: 2.23 },
  sirius: { hip: 32349, ra: 101.28715533, dec: -16.71611586, v: -1.46 },
  betelgeuse: { hip: 27989, ra: 88.79293899, dec: 7.40706399, v: 0.42 },
};

function findNearest(catalog: StarCatalog, dir: V3): { index: number; sepDeg: number } {
  let best = -1;
  let bestDot = -2;
  for (let i = 0; i < catalog.count; i++) {
    const o = i * 4;
    const dot = catalog.data[o] * dir[0] + catalog.data[o + 1] * dir[1] + catalog.data[o + 2] * dir[2];
    if (dot > bestDot) {
      bestDot = dot;
      best = i;
    }
  }
  return { index: best, sepDeg: Math.acos(Math.min(1, bestDot)) / DEG };
}

describe('parseSkyMode', () => {
  const qualities: QualityLevel[] = ['low', 'balanced', 'high', 'cinematic'];

  it('keeps the procedural sky by default and for proc/unknown values', () => {
    for (const q of qualities) {
      expect(parseSkyMode('', q)).toBe('proc');
      expect(parseSkyMode('?sky=proc', q)).toBe('proc');
      expect(parseSkyMode('?sky=nonsense', q)).toBe('proc');
    }
  });

  it('forces the catalog with ?sky=hip on every preset', () => {
    for (const q of qualities) expect(parseSkyMode('?sky=HIP', q)).toBe('hip');
  });

  it('?sky=auto picks the catalog on high and cinematic only', () => {
    expect(parseSkyMode('?sky=auto', 'low')).toBe('proc');
    expect(parseSkyMode('?sky=auto', 'balanced')).toBe('proc');
    expect(parseSkyMode('?sky=auto', 'high')).toBe('hip');
    expect(parseSkyMode('?sky=auto', 'cinematic')).toBe('hip');
  });
});

describe('decodeStarCatalog', () => {
  const header = (magic: number, version: number, count: number, extraBytes: number): ArrayBuffer => {
    const ab = new ArrayBuffer(16 + extraBytes);
    const dv = new DataView(ab);
    dv.setUint32(0, magic, true);
    dv.setUint32(4, version, true);
    dv.setUint32(8, count, true);
    dv.setUint32(12, 6500, true);
    return ab;
  };

  it('rejects bad magic, version and truncated payloads', () => {
    expect(() => decodeStarCatalog(new ArrayBuffer(8))).toThrow(/truncated/);
    expect(() => decodeStarCatalog(header(0xdeadbeef, 1, 1, 16))).toThrow(/magic/);
    expect(() => decodeStarCatalog(header(0x31594b53, 2, 1, 16))).toThrow(/version/);
    expect(() => decodeStarCatalog(header(0x31594b53, 1, 2, 16))).toThrow(/expected 2/);
  });

  it('round-trips a packed record the way the vertex shader unpacks it', () => {
    const ab = header(0x31594b53, 1, 1, 16);
    const dv = new DataView(ab);
    dv.setFloat32(16, 0, true);
    dv.setFloat32(20, 0, true);
    dv.setFloat32(24, 1, true);
    dv.setUint16(28, Math.round((-1.46 + 2) * 1000), true);
    dv.setInt16(30, -243, true);
    const cat = decodeStarCatalog(ab);
    const star = catalogStar(cat, 0);
    expect(cat.magLimit).toBe(6.5);
    expect(star.dir).toEqual([0, 0, 1]);
    expect(star.mag).toBeCloseTo(-1.46, 3);
    expect(star.bv).toBeCloseTo(-0.243, 3);
  });
});

describe('committed Hipparcos catalog', () => {
  const catalog = loadCommittedCatalog();

  it('holds the naked-eye sky, brightest first', () => {
    expect(catalog.magLimit).toBe(6.5);
    expect(catalog.count).toBeGreaterThan(8000);
    expect(catalog.count).toBeLessThan(10000);
    expect(catalog.data.byteLength).toBeLessThan(200 * 1024);
    let prev = -Infinity;
    for (let i = 0; i < catalog.count; i++) {
      const s = catalogStar(catalog, i);
      expect(s.mag).toBeGreaterThanOrEqual(prev);
      prev = s.mag;
    }
    // Sirius is the brightest star in the sky.
    expect(angleDeg(catalogStar(catalog, 0).dir, radec(NAMED.sirius.ra, NAMED.sirius.dec))).toBeLessThan(0.05);
  });

  it.each(Object.entries(NAMED))('places %s at its J2000 position and magnitude', (_name, star) => {
    const { index, sepDeg } = findNearest(catalog, radec(star.ra, star.dec));
    expect(sepDeg).toBeLessThan(0.05);
    expect(Math.abs(catalogStar(catalog, index).mag - star.v)).toBeLessThan(0.15);
  });
});

describe('projectStarToNdc', () => {
  const catalog = loadCommittedCatalog();
  const starDir = (name: keyof typeof NAMED): V3 => {
    const s = NAMED[name];
    return catalogStar(catalog, findNearest(catalog, radec(s.ra, s.dec)).index).dir;
  };

  function camera(eye: V3, target: V3, up: V3, fovDeg = 30) {
    return mat4mul(mat4persp(fovDeg * DEG, 16 / 9, 10, 500000), mat4lookAt(eye, target, up));
  }

  it('lines up Orion’s Belt in order at ~1.4° spacing around Alnilam', () => {
    // Camera on the +X axis at 720 km altitude looking at Alnilam, celestial north up.
    const eye: V3 = [7091, 0, 0];
    const alnilam = starDir('alnilam');
    const target: V3 = [eye[0] + alnilam[0] * 1e5, eye[1] + alnilam[1] * 1e5, eye[2] + alnilam[2] * 1e5];
    const vp = camera(eye, target, [0, 0, 1]);

    const mid = projectStarToNdc(alnilam, vp, IDENTITY)!;
    expect(Math.abs(mid[0])).toBeLessThan(1e-3);
    expect(Math.abs(mid[1])).toBeLessThan(1e-3);

    const east = projectStarToNdc(starDir('alnitak'), vp, IDENTITY)!;
    const west = projectStarToNdc(starDir('mintaka'), vp, IDENTITY)!;
    // Looking south-ish at the equator with north up, RA increases to the left:
    // Alnitak (higher RA) is left of Alnilam, Mintaka right, and Mintaka higher.
    expect(east[0]).toBeLessThan(0);
    expect(west[0]).toBeGreaterThan(0);
    expect(west[1]).toBeGreaterThan(east[1]);

    // Near-collinear: Alnilam sits within a few % of the Alnitak–Mintaka chord.
    const chord = [west[0] - east[0], west[1] - east[1]];
    const rel = [mid[0] - east[0], mid[1] - east[1]];
    const cross = Math.abs(chord[0] * rel[1] - chord[1] * rel[0]) / Math.hypot(chord[0], chord[1]);
    expect(cross / Math.hypot(chord[0], chord[1])).toBeLessThan(0.05);

    // Angular spacing Alnitak–Alnilam ≈ 1.36°, Alnilam–Mintaka ≈ 1.39°.
    expect(angleDeg(starDir('alnitak'), alnilam)).toBeGreaterThan(1.2);
    expect(angleDeg(starDir('alnitak'), alnilam)).toBeLessThan(1.5);
    expect(angleDeg(starDir('mintaka'), alnilam)).toBeGreaterThan(1.2);
    expect(angleDeg(starDir('mintaka'), alnilam)).toBeLessThan(1.5);
  });

  it('puts Polaris within 0.75° of screen centre for a camera aimed at +Z', () => {
    const eye: V3 = [7091, 0, 0];
    const vp = camera(eye, [7091, 0, 1e5], [1, 0, 0], 60);
    const ndc = projectStarToNdc(starDir('polaris'), vp, IDENTITY)!;
    // 60° vertical FOV → NDC y of 1 is 30°; x is scaled by the 16:9 aspect.
    const halfTan = Math.tan(30 * DEG);
    const offDeg = Math.atan(Math.hypot(ndc[0] * halfTan * (16 / 9), ndc[1] * halfTan)) / DEG;
    expect(offDeg).toBeGreaterThan(0.6);
    expect(offDeg).toBeLessThan(0.75);
  });

  it('does not project Acrux (Southern Cross) for a camera aimed at the north pole', () => {
    const eye: V3 = [7091, 0, 0];
    const north = camera(eye, [7091, 0, 1e5], [1, 0, 0], 60);
    expect(projectStarToNdc(starDir('acrux'), north, IDENTITY)).toBeNull();
  });

  it('applies the frame matrix: TEME-of-date shifts stars by ~0.37° in 2026', () => {
    const eye: V3 = [7091, 0, 0];
    const alnilam = starDir('alnilam');
    const target: V3 = [eye[0] + alnilam[0] * 1e5, eye[1] + alnilam[1] * 1e5, eye[2] + alnilam[2] * 1e5];
    const vp = camera(eye, target, [0, 0, 1]);
    const frame = skyFrameMatrix({ sunMode: 'art', gcrfRequested: false, utcMs: Date.UTC(2026, 9, 5) });
    expect(frame).toEqual(gcrfToTemeMatrix(unixMsToJulianDate(Date.UTC(2026, 9, 5))));
    const moved = mat3MulVec(frame, alnilam);
    const shift = angleDeg(moved, alnilam);
    expect(shift).toBeGreaterThan(0.3);
    expect(shift).toBeLessThan(0.42);
    const ndc = projectStarToNdc(alnilam, vp, frame)!;
    expect(Math.hypot(ndc[0], ndc[1])).toBeGreaterThan(0.01);
  });

  it('uses identity only under ?frame=gcrf with the astro sun', () => {
    const utcMs = Date.UTC(2026, 9, 5);
    expect(skyFrameMatrix({ sunMode: 'astro', gcrfRequested: true, utcMs })).toEqual(IDENTITY);
    expect(skyFrameMatrix({ sunMode: 'art', gcrfRequested: true, utcMs })).not.toEqual(IDENTITY);
    expect(skyFrameMatrix({ sunMode: 'astro', gcrfRequested: false, utcMs })).not.toEqual(IDENTITY);
  });
});

describe('isStarOccludedByEarth', () => {
  it('clips below the Ground View horizon and keeps the zenith', () => {
    const cam: V3 = [6371.002, 0, 0];
    expect(isStarOccludedByEarth([1, 0, 0], cam)).toBe(false);
    expect(isStarOccludedByEarth([0, 1, 0], cam)).toBe(false); // grazing horizon
    expect(isStarOccludedByEarth([-1, 0, 0], cam)).toBe(true); // nadir
    const below: V3 = [-Math.sin(5 * DEG), Math.cos(5 * DEG), 0];
    expect(isStarOccludedByEarth(below, cam)).toBe(true);
  });

  it('hides stars behind the Earth disk from Moon View, not 2° off it', () => {
    const cam: V3 = [384400, 0, 0];
    expect(isStarOccludedByEarth([-1, 0, 0], cam)).toBe(true);
    const off: V3 = [-Math.cos(2 * DEG), Math.sin(2 * DEG), 0];
    expect(isStarOccludedByEarth(off, cam)).toBe(false);
  });
});

describe('packSkyCatalogSettings', () => {
  it('lays out frame rows, limit, gain, size, count and flags for the WGSL struct', () => {
    const ab = packSkyCatalogSettings({ frame: IDENTITY, count: 8874, magLimit: 6.5, enabled: true });
    expect(ab.byteLength).toBe(SKY_CATALOG_SETTINGS_BYTE_SIZE);
    const f = new Float32Array(ab);
    const u = new Uint32Array(ab);
    expect([f[0], f[1], f[2], f[3]]).toEqual([1, 0, 0, 6.5]);
    expect([f[4], f[5], f[6]]).toEqual([0, 1, 0]);
    expect([f[8], f[9], f[10]]).toEqual([0, 0, 1]);
    expect(f[11]).toBeGreaterThan(0);
    expect([u[12], u[13]]).toEqual([8874, 1]);
    const off = new Uint32Array(packSkyCatalogSettings({ frame: IDENTITY, count: 8874, magLimit: 6.5, enabled: false }));
    expect([off[12], off[13]]).toEqual([0, 0]);
  });
});

describe('ICRS_TO_LEGACY_GALACTIC', () => {
  const legacyLatDeg = (raDeg: number, decDeg: number): number => {
    const n = LEGACY_GALACTIC_NORTH;
    const len = Math.hypot(n[0], n[1], n[2]);
    const d = mat3MulVec(ICRS_TO_LEGACY_GALACTIC, radec(raDeg, decDeg));
    return Math.asin((d[0] * n[0] + d[1] * n[1] + d[2] * n[2]) / len) / DEG;
  };

  it('puts the Milky Way through Sgr A*, Crux and Cygnus', () => {
    expect(Math.abs(legacyLatDeg(266.417, -29.008))).toBeLessThan(1); // Sgr A*
    expect(Math.abs(legacyLatDeg(NAMED.acrux.ra, NAMED.acrux.dec))).toBeLessThan(2);
    expect(Math.abs(legacyLatDeg(310.358, 45.28))).toBeLessThan(3); // Deneb
    // Galactic latitude of the north celestial pole is +27.1°.
    expect(legacyLatDeg(0, 90)).toBeCloseTo(27.13, 0);
  });

  it('matches the transposed WGSL literal', () => {
    const wgsl = readFileSync(new URL('../shaders/render/stars.wgsl', import.meta.url), 'utf8');
    const block = wgsl.slice(wgsl.indexOf('const ICRS_TO_LEGACY_GALACTIC'));
    const nums = [...block.slice(0, block.indexOf(');')).matchAll(/-?\d+\.\d+/g)].map((m) => Number(m[0]));
    const m = ICRS_TO_LEGACY_GALACTIC;
    expect(nums).toEqual([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
  });
});
