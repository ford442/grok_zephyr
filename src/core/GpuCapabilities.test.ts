import { describe, expect, it } from 'vitest';
import {
  adapterPowerFallbackOrder,
  buildCapabilityProfile,
  chooseAdapterCandidate,
  formatGpuCapabilityLine,
  REQUESTED_OPTIONAL_FEATURES,
  selectDepthFormat,
  selectOptionalFeatures,
  type AdapterSnapshot,
} from './GpuCapabilities.js';

function snapshot(partial: {
  features?: string[];
  storage?: number;
  buffer?: number;
  groups?: number;
  maxTextureDimension2D?: number;
  vendor?: string;
  isFallbackAdapter?: boolean;
}): AdapterSnapshot {
  const limits: AdapterSnapshot['limits'] & { maxTextureDimension2D?: number } = {
    maxStorageBufferBindingSize: partial.storage ?? 128 * 1024 * 1024,
    maxBufferSize: partial.buffer ?? 128 * 1024 * 1024,
    maxComputeWorkgroupsPerDimension: partial.groups ?? 65_535,
  };
  if (partial.maxTextureDimension2D !== undefined) {
    limits.maxTextureDimension2D = partial.maxTextureDimension2D;
  }
  return {
    features: new Set(partial.features ?? ['timestamp-query']),
    limits,
    vendor: partial.vendor ?? 'TestGPU',
    architecture: 'unit',
    isFallbackAdapter: partial.isFallbackAdapter,
  };
}

describe('GpuCapabilities', () => {
  it('requests only catalog optional features and never invents required ones', () => {
    expect(REQUESTED_OPTIONAL_FEATURES).toContain('timestamp-query');
    expect(REQUESTED_OPTIONAL_FEATURES).toContain('shader-f16');
    const { enabled, missing } = selectOptionalFeatures(
      snapshot({ features: ['timestamp-query'] }),
    );
    expect(enabled).toEqual(['timestamp-query']);
    expect(missing).toContain('shader-f16');
  });

  it('uses depth24plus on fallback / low / small-maxDim adapters', () => {
    expect(selectDepthFormat(snapshot({ isFallbackAdapter: true }), 'high')).toBe('depth24plus');
    expect(selectDepthFormat(snapshot({}), 'low')).toBe('depth24plus');
    expect(selectDepthFormat(snapshot({ maxTextureDimension2D: 4096 }), 'high')).toBe('depth24plus');
    expect(selectDepthFormat(snapshot({}), 'high')).toBe('depth32float');
  });

  it('enables f16 bloom only when shader-f16 is present', () => {
    const withF16 = buildCapabilityProfile(snapshot({ features: ['shader-f16', 'timestamp-query'] }));
    expect(withF16.shaderF16Bloom).toBe(true);
    const without = buildCapabilityProfile(snapshot({ features: ['timestamp-query'] }));
    expect(without.shaderF16Bloom).toBe(false);
  });

  it('prefers high-performance when both adapters can run 1M sats', () => {
    const capable = snapshot({ features: ['timestamp-query'] });
    const chosen = chooseAdapterCandidate(
      [
        { preference: 'low-power', snapshot: capable },
        { preference: 'high-performance', snapshot: capable },
      ],
      { quality: 'high' },
    );
    expect(chosen?.preference).toBe('high-performance');
    expect(chosen?.profile.fleet.count).toBe(1_048_576);
  });

  it('falls back to the adapter that still has a sat budget', () => {
    const tiny = snapshot({
      storage: 1024,
      buffer: 1024,
      groups: 1,
      vendor: 'Tiny',
    });
    const ok = snapshot({ vendor: 'OkGPU' });
    const chosen = chooseAdapterCandidate(
      [
        { preference: 'high-performance', snapshot: tiny },
        { preference: 'low-power', snapshot: ok },
      ],
      { quality: 'high' },
    );
    expect(chosen?.preference).toBe('low-power');
    expect(chosen?.profile.vendor).toBe('OkGPU');
    expect(chosen?.profile.fleet.count).toBeGreaterThan(0);
  });

  it('formats a compact GPU dashboard line', () => {
    const profile = buildCapabilityProfile(
      snapshot({ features: ['timestamp-query', 'shader-f16'], vendor: 'Acme' }),
      { quality: 'low' },
    );
    expect(formatGpuCapabilityLine(profile)).toMatch(/GPU: Acme unit \/ ts\+f16 \/ 65,536 sats/);
  });

  it('tries high-performance then low-power by default', () => {
    expect(adapterPowerFallbackOrder()).toEqual(['high-performance', 'low-power']);
    expect(adapterPowerFallbackOrder('low-power')).toEqual(['low-power', 'high-performance']);
  });
});
