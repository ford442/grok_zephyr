import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveRendererBackend,
  resolveSatelliteCount,
  setRendererBackend,
} from './rendererSelection.js';
import { parseDebugFlags } from './WebGLDebug.js';
import { CONSTANTS } from '@/types/constants.js';

describe('rendererSelection', () => {
  it('defaults to webgpu when no param is present', () => {
    expect(resolveRendererBackend('')).toBe('webgpu');
  });

  it('honours ?renderer=webgl / ?renderer=webgpu', () => {
    expect(resolveRendererBackend('?renderer=webgl')).toBe('webgl');
    expect(resolveRendererBackend('?renderer=WebGPU')).toBe('webgpu');
  });

  it('ignores unknown renderer values', () => {
    expect(resolveRendererBackend('?renderer=vulkan')).toBe('webgpu');
  });

  it('clamps ?sats to [1, NUM_SATELLITES] and defaults to full count', () => {
    expect(resolveSatelliteCount('')).toBe(CONSTANTS.NUM_SATELLITES);
    expect(resolveSatelliteCount('?sats=50000')).toBe(50000);
    expect(resolveSatelliteCount('?sats=99999999')).toBe(CONSTANTS.NUM_SATELLITES);
    expect(resolveSatelliteCount('?sats=0')).toBe(CONSTANTS.NUM_SATELLITES);
    expect(resolveSatelliteCount('?sats=abc')).toBe(CONSTANTS.NUM_SATELLITES);
  });

  describe('setRendererBackend', () => {
    const storage = new Map<string, string>();

    beforeEach(() => {
      storage.clear();
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('persists backend choice to localStorage', () => {
      setRendererBackend('webgl');
      expect(storage.get('zephyr.renderer')).toBe('webgl');
      expect(resolveRendererBackend('')).toBe('webgl');
    });
  });
});

describe('parseDebugFlags', () => {
  it('parses comma-separated debug flags', () => {
    const opts = parseDebugFlags('?debug=wireframe,lod,nobloom');
    expect(opts.wireframeEarth).toBe(true);
    expect(opts.lodDebug).toBe(true);
    expect(opts.showBloom).toBe(false);
  });

  it('returns empty object when no debug param', () => {
    expect(parseDebugFlags('')).toEqual({});
  });
});
