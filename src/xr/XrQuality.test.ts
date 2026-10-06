import { describe, expect, it, vi } from 'vitest';
import type { BloomConfig } from '@/types/animation.js';
import { applyXrQualityGpu, restoreXrQualityGpu, XR_BLOOM_LEVELS } from '@/xr/XrQuality.js';

function bloomTarget(levels: number) {
  let config = { threshold: 1.5, knee: 0.5, intensity: 1, levels } as BloomConfig;
  return {
    getBloomConfig: vi.fn(() => ({ ...config })),
    setBloomConfig: vi.fn((c: Partial<BloomConfig>) => {
      config = { ...config, ...c };
    }),
    current: () => config,
  };
}

describe('XrQuality (WebGPU)', () => {
  it('clamps bloom to 2 levels in XR and restores the full config on exit', () => {
    const target = bloomTarget(5);
    const snapshot = applyXrQualityGpu(target);
    expect(target.current().levels).toBe(XR_BLOOM_LEVELS);
    restoreXrQualityGpu(target, snapshot);
    expect(target.current().levels).toBe(5);
  });

  it('never raises a lower bloom level', () => {
    const target = bloomTarget(2);
    applyXrQualityGpu(target);
    expect(target.current().levels).toBe(2);
  });

  it('is a no-op without a pipeline', () => {
    expect(applyXrQualityGpu(null)).toEqual({ webglDebug: null, gpuBloom: null });
    expect(() => restoreXrQualityGpu(null, null)).not.toThrow();
  });
});
