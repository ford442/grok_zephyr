import { afterEach, describe, expect, it } from 'vitest';
import {
  adapterFitsFleet,
  FLEET_SIZE_MAX,
  fleetLimitsForCount,
  injectFleetCount,
  maxFleetForAdapter,
  parseSatsParam,
  resetFleetScaleForTests,
  resolveFleetScale,
} from './FleetScale.js';

afterEach(() => {
  resetFleetScaleForTests();
});

describe('resolveFleetScale', () => {
  it('honours ?sats= on the WebGPU path', () => {
    const scale = resolveFleetScale({ search: '?sats=65536', quality: 'high' });
    expect(scale.count).toBe(65_536);
    expect(scale.source).toBe('url');
    expect(scale.autoReduced).toBe(false);
  });

  it('maps quality presets when sats is omitted', () => {
    expect(resolveFleetScale({ search: '', quality: 'low' }).count).toBe(65_536);
    expect(resolveFleetScale({ search: '', quality: 'balanced' }).count).toBe(262_144);
    expect(resolveFleetScale({ search: '', quality: 'high' }).count).toBe(FLEET_SIZE_MAX);
  });

  it('downscales to the largest fitting power-of-two when the adapter cannot bind 1M', () => {
    const tight = {
      maxStorageBufferBindingSize: 10 * 1024 * 1024,
      maxBufferSize: 10 * 1024 * 1024,
      maxComputeWorkgroupsPerDimension: 65_535,
    };
    expect(maxFleetForAdapter(tight)).toBe(262_144);
    const scale = resolveFleetScale({ search: '', quality: 'high', adapterLimits: tight });
    expect(scale.count).toBe(262_144);
    expect(scale.autoReduced).toBe(true);
    expect(scale.source).toBe('adapter');
  });

  it('clamps URL sats to adapter max and marks auto-reduced', () => {
    const tight = {
      maxStorageBufferBindingSize: 10 * 1024 * 1024,
      maxBufferSize: 10 * 1024 * 1024,
      maxComputeWorkgroupsPerDimension: 65_535,
    };
    const scale = resolveFleetScale({
      search: '?sats=1048576',
      quality: 'high',
      adapterLimits: tight,
    });
    expect(scale.count).toBe(262_144);
    expect(scale.autoReduced).toBe(true);
  });

  it('returns 0 when even 16k cannot fit', () => {
    const tiny = {
      maxStorageBufferBindingSize: 1024,
      maxBufferSize: 1024,
      maxComputeWorkgroupsPerDimension: 1,
    };
    expect(resolveFleetScale({ adapterLimits: tiny }).count).toBe(0);
  });
});

describe('parseSatsParam / injectFleetCount', () => {
  it('parses and rejects invalid sats', () => {
    expect(parseSatsParam('?sats=65536')).toBe(65_536);
    expect(parseSatsParam('?sats=0')).toBeNull();
    expect(parseSatsParam('?sats=abc')).toBeNull();
    expect(parseSatsParam('')).toBeNull();
    expect(parseSatsParam('?sats=99999999')).toBe(FLEET_SIZE_MAX);
  });

  it('rewrites the 1M WGSL guard to the active count', () => {
    const src = 'if (i >= 1048576u) { return; }';
    expect(injectFleetCount(src, 65536)).toBe('if (i >= 65536u) { return; }');
  });

  it('1M fleet limits stay under a 128 MB storage binding', () => {
    const req = fleetLimitsForCount(FLEET_SIZE_MAX);
    expect(req.maxStorageBufferBindingSize).toBeLessThanOrEqual(128 * 1024 * 1024);
    expect(
      adapterFitsFleet(
        {
          maxStorageBufferBindingSize: 128 * 1024 * 1024,
          maxBufferSize: 128 * 1024 * 1024,
          maxComputeWorkgroupsPerDimension: 65_535,
        },
        FLEET_SIZE_MAX,
      ),
    ).toBe(true);
  });
});
