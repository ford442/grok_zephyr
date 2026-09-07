import { describe, expect, it } from 'vitest';
import {
  EARTH_MAP_OPTIONAL_FEATURES,
  earthMapPlan,
  earthMapTierForQuality,
  parseEarthMapTier,
} from './EarthMaps.js';
import { selectEarthMapFormat, usableMipLevels } from './EarthTextures.js';

describe('parseEarthMapTier', () => {
  it('defaults to procedural so existing visual baselines are unaffected', () => {
    expect(parseEarthMapTier('', 'high')).toBe('off');
    expect(parseEarthMapTier('?mode=2&preset=high', 'high')).toBe('off');
  });

  it('accepts explicit tiers and maps ?earthmap=on to the quality preset', () => {
    expect(parseEarthMapTier('?earthmap=low', 'high')).toBe('low');
    expect(parseEarthMapTier('?earthmap=balanced', 'low')).toBe('balanced');
    expect(parseEarthMapTier('?earthmap=cinematic', 'low')).toBe('high');
    expect(parseEarthMapTier('?earthmap=on', 'low')).toBe('low');
    expect(parseEarthMapTier('?earthmap=on', 'balanced')).toBe('balanced');
    expect(parseEarthMapTier('?earthmap=on', 'cinematic')).toBe('high');
  });

  it('honours ?earth=proc without colliding with the ?earth=0|1 rotation switch', () => {
    expect(parseEarthMapTier('?earthmap=high&earth=proc', 'high')).toBe('off');
    // ?earth=1 is GMST rotation (docs/FRAMES.md) and must not disable the plates.
    expect(parseEarthMapTier('?earthmap=high&earth=1', 'high')).toBe('high');
    expect(parseEarthMapTier('?earth=1', 'high')).toBe('off');
  });

  it('falls back to procedural for unparseable values', () => {
    expect(parseEarthMapTier('?earthmap=8k', 'high')).toBe('off');
    expect(parseEarthMapTier('?earthmap=', 'high')).toBe('off');
  });
});

describe('earthMapPlan', () => {
  it('follows the tier ladder: albedo, then night lights, then clouds', () => {
    expect(earthMapPlan('off')).toMatchObject({ albedo: null, night: null, clouds: null });
    expect(earthMapPlan('low')).toMatchObject({ albedo: 'albedo_1k', night: null, clouds: null });
    expect(earthMapPlan('balanced')).toMatchObject({ albedo: 'albedo_2k', clouds: null });
    expect(earthMapPlan('high')).toMatchObject({
      albedo: 'albedo_4k',
      night: 'night_2k',
      clouds: 'clouds_2k',
    });
  });

  it('never asks a low-quality preset for the 4K plate', () => {
    expect(earthMapPlan(earthMapTierForQuality('low')).albedo).toBe('albedo_1k');
  });
});

describe('selectEarthMapFormat', () => {
  it('prefers BC7, then ASTC, then ETC2', () => {
    expect(selectEarthMapFormat(new Set(['texture-compression-bc'])).gpuFormat).toBe(
      'bc7-rgba-unorm-srgb',
    );
    expect(
      selectEarthMapFormat(new Set(['texture-compression-astc', 'texture-compression-etc2']))
        .gpuFormat,
    ).toBe('astc-4x4-unorm-srgb');
    expect(selectEarthMapFormat(new Set(['texture-compression-etc2'])).gpuFormat).toBe(
      'etc2-rgba8unorm-srgb',
    );
  });

  it('falls back to uncompressed rgba8 when the adapter has no block formats', () => {
    const target = selectEarthMapFormat(new Set());
    expect(target.gpuFormat).toBe('rgba8unorm-srgb');
    expect(target.blockSize).toBe(1);
  });

  it('requests only formats the capability catalog knows about', () => {
    for (const feature of ['texture-compression-bc', 'texture-compression-etc2']) {
      expect(EARTH_MAP_OPTIONAL_FEATURES).toContain(feature);
    }
  });
});

describe('usableMipLevels', () => {
  it('stops a 2:1 equirect chain before height drops below one block', () => {
    // 1024x512 -> ... -> 8x4 is the last level with both dimensions >= 4.
    expect(usableMipLevels(1024, 512, 11, 4)).toBe(8);
    expect(usableMipLevels(4096, 2048, 13, 4)).toBe(10);
  });

  it('keeps the full chain for uncompressed formats', () => {
    expect(usableMipLevels(1024, 512, 11, 1)).toBe(11);
  });

  it('always keeps at least the base level', () => {
    expect(usableMipLevels(2, 1, 1, 4)).toBe(1);
  });
});
