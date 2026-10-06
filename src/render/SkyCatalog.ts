/**
 * Night-sky configuration — `?sky=` parsing, the Hipparcos binary decoder, the
 * ICRS → render-frame matrix, and CPU mirrors of the catalog WGSL
 * (`src/shaders/render/starsCatalog.wgsl`) for tests. See docs/SKY.md.
 *
 * The catalog is opt-in. With no `?sky=` the procedural starfield renders
 * exactly as before, which keeps the default visual baselines unchanged.
 */

import type { QualityLevel } from '@/core/QualityPresets.js';
import type { Mat4 } from '@/types/index.js';
import { gcrfToTemeMatrix, unixMsToJulianDate, type Mat3 } from '@/physics/frames.js';
import type { SunLightingMode } from '@/physics/sun.js';
import { CONSTANTS } from '@/types/constants.js';

export type SkyMode = 'proc' | 'hip';

/** Catalog asset under public/, built by scripts/build-sky-catalog.mjs. */
export const SKY_CATALOG_ASSET = 'sky/hip_v65.bin';
export const SKY_CATALOG_MAGIC = 0x31594b53; // 'SKY1'
export const SKY_CATALOG_VERSION = 1;
const HEADER_BYTES = 16;
const STAR_BYTES = 16;

/** Brightness gain on `starHdrLuminance` for catalog points. */
export const SKY_CATALOG_GAIN = 1.0;
/** Impostor half-size in pixels for faint stars (bright ones grow to 2x). */
export const SKY_CATALOG_POINT_HALF_PX = 1.6;

/** `?sky=auto` → the catalog on the high presets only. */
export function skyModeForQuality(quality: QualityLevel): SkyMode {
  return quality === 'high' || quality === 'cinematic' ? 'hip' : 'proc';
}

/** Parse `?sky=`. Absent or unknown values keep today's procedural sky. */
export function parseSkyMode(search: string, quality: QualityLevel): SkyMode {
  const raw = new URLSearchParams(search).get('sky')?.toLowerCase();
  switch (raw) {
    case 'hip':
    case 'hipparcos':
    case 'catalog':
      return 'hip';
    case 'auto':
    case 'on':
      return skyModeForQuality(quality);
    default:
      return 'proc';
  }
}

/** Resolved once at boot, read back when the render pipeline loads the catalog. */
let activeSkyMode: SkyMode = 'proc';

export function setActiveSkyMode(mode: SkyMode): void {
  activeSkyMode = mode;
}

export function getActiveSkyMode(): SkyMode {
  return activeSkyMode;
}

export interface StarCatalog {
  count: number;
  magLimit: number;
  /** count × 4 words: x, y, z (f32 ICRS unit direction), packed mag/B−V (u32). */
  data: Float32Array;
}

/** Validate and wrap a `SKY1` binary. Throws on a bad header or short buffer. */
export function decodeStarCatalog(buffer: ArrayBuffer): StarCatalog {
  if (buffer.byteLength < HEADER_BYTES) throw new Error('sky catalog: truncated header');
  const header = new DataView(buffer, 0, HEADER_BYTES);
  if (header.getUint32(0, true) !== SKY_CATALOG_MAGIC) throw new Error('sky catalog: bad magic');
  const version = header.getUint32(4, true);
  if (version !== SKY_CATALOG_VERSION) throw new Error(`sky catalog: unsupported version ${version}`);
  const count = header.getUint32(8, true);
  const magLimit = header.getUint32(12, true) / 1000;
  if (count === 0 || buffer.byteLength < HEADER_BYTES + count * STAR_BYTES) {
    throw new Error(`sky catalog: expected ${count} stars, got ${buffer.byteLength} bytes`);
  }
  return { count, magLimit, data: new Float32Array(buffer, HEADER_BYTES, count * 4) };
}

export interface CatalogStar {
  dir: [number, number, number];
  mag: number;
  bv: number;
}

/** Decode one record the way the vertex shader does. */
export function catalogStar(catalog: StarCatalog, index: number): CatalogStar {
  const o = index * 4;
  const d = catalog.data;
  const packed = new Uint32Array(d.buffer, d.byteOffset + (o + 3) * 4, 1)[0];
  return {
    dir: [d[o], d[o + 1], d[o + 2]],
    mag: (packed & 0xffff) / 1000 - 2,
    bv: (packed >> 16) / 1000, // arithmetic shift, like bitcast<i32> >> 16 in WGSL
  };
}

/**
 * ICRS → render frame. Satellites are in TEME of date unless `?frame=gcrf`
 * is honoured (astro sun only), in which case the render frame is GCRF and the
 * catalog needs no rotation. docs/FRAMES.md, docs/SKY.md.
 */
export function skyFrameMatrix(options: {
  sunMode: SunLightingMode;
  gcrfRequested: boolean;
  utcMs: number;
}): Mat3 {
  if (options.sunMode === 'astro' && options.gcrfRequested) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  return gcrfToTemeMatrix(unixMsToJulianDate(options.utcMs));
}

/**
 * Mirror of `ICRS_TO_LEGACY_GALACTIC` in stars.wgsl, row-major here (`m · v`).
 * Rotates the ICRS galactic pole/centre onto the art constants hardcoded in
 * `renderMilkyWay`, so the `?sky=hip` background puts the band where the real
 * one is. The WGSL literal is the transpose (WGSL matrices are column-major).
 */
export const ICRS_TO_LEGACY_GALACTIC: Mat3 = [
  0.543221, -0.38335, 0.746963,
  -0.39188, 0.671051, 0.629381,
  -0.742523, -0.634613, 0.214301,
];

/** The pole `renderMilkyWay` hardcodes (normalized in the shader). */
export const LEGACY_GALACTIC_NORTH: readonly [number, number, number] = [-0.0548, 0.4941, 0.8677];

/** Byte size of the WGSL `SkyCatalogSettings` uniform. */
export const SKY_CATALOG_SETTINGS_BYTE_SIZE = 64;

export function packSkyCatalogSettings(options: {
  frame: Mat3;
  count: number;
  magLimit: number;
  enabled: boolean;
}): ArrayBuffer {
  const ab = new ArrayBuffer(SKY_CATALOG_SETTINGS_BYTE_SIZE);
  const f32 = new Float32Array(ab);
  const u32 = new Uint32Array(ab);
  const m = options.frame;
  f32.set([m[0], m[1], m[2], options.magLimit], 0);
  f32.set([m[3], m[4], m[5], SKY_CATALOG_GAIN], 4);
  f32.set([m[6], m[7], m[8], SKY_CATALOG_POINT_HALF_PX], 8);
  u32[12] = options.enabled ? options.count : 0;
  u32[13] = options.enabled ? 1 : 0;
  return ab;
}

/** Mirror of `occludedByEarth` in starsCatalog.wgsl. */
export function isStarOccludedByEarth(
  dir: readonly [number, number, number],
  cameraPos: readonly [number, number, number],
): boolean {
  const r = Math.hypot(cameraPos[0], cameraPos[1], cameraPos[2]);
  const R = CONSTANTS.EARTH_RADIUS_KM;
  if (r <= R) return false;
  const cosLimb = Math.sqrt(Math.max(0, 1 - (R * R) / (r * r)));
  const toEarth = -(dir[0] * cameraPos[0] + dir[1] * cameraPos[1] + dir[2] * cameraPos[2]) / r;
  return toEarth > cosLimb;
}

/**
 * Mirror of the catalog vertex projection: `view_proj · (frame · dir, 0)`.
 * Returns NDC, or null when the star is behind the camera.
 */
export function projectStarToNdc(
  dir: readonly [number, number, number],
  viewProj: Mat4,
  frame: Mat3,
): [number, number] | null {
  const d = [
    frame[0] * dir[0] + frame[1] * dir[1] + frame[2] * dir[2],
    frame[3] * dir[0] + frame[4] * dir[1] + frame[5] * dir[2],
    frame[6] * dir[0] + frame[7] * dir[1] + frame[8] * dir[2],
  ];
  const clip = (row: number) => viewProj[row] * d[0] + viewProj[4 + row] * d[1] + viewProj[8 + row] * d[2];
  const w = clip(3);
  if (w <= 0) return null;
  return [clip(0) / w, clip(1) / w];
}
