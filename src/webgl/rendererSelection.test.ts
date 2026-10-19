import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveRendererBackend,
  resolveRendererChoice,
  resolveSatelliteCount,
  setRendererBackend,
  webgl2OptInHref,
  webgpuHref,
} from './rendererSelection.js';
import { parseDebugFlags } from './WebGLDebug.js';
import { webglContextAttributes } from './glUtils.js';
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

  describe('?webgl2 opt-in', () => {
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

    it('is never chosen without being asked for', () => {
      expect(resolveRendererChoice('')).toEqual({ backend: 'webgpu', source: 'default' });
      expect(resolveRendererChoice('?sats=1000')).toEqual({ backend: 'webgpu', source: 'default' });
    });

    it('selects WebGL2 only for ?webgl2=1 (and equivalents)', () => {
      for (const value of ['1', 'true', 'on', 'YES']) {
        expect(resolveRendererChoice(`?webgl2=${value}`)).toEqual({
          backend: 'webgl',
          source: 'url-webgl2',
        });
      }
      expect(resolveRendererBackend('?webgl2=maybe')).toBe('webgpu');
    });

    it('does not persist the opt-in, so the next visit is WebGPU again', () => {
      resolveRendererChoice('?webgl2=1');
      expect(storage.has('zephyr.renderer')).toBe(false);
      expect(resolveRendererBackend('')).toBe('webgpu');
    });

    it('lets ?webgl2=0 override a saved WebGL preference for this load', () => {
      storage.set('zephyr.renderer', 'webgl');
      expect(resolveRendererChoice('')).toEqual({ backend: 'webgl', source: 'stored' });
      expect(resolveRendererChoice('?webgl2=0').backend).toBe('webgpu');
      expect(storage.get('zephyr.renderer')).toBe('webgl');
    });

    it('keeps ?renderer= as the explicit, persisted choice and ranks it first', () => {
      expect(resolveRendererChoice('?renderer=webgl')).toEqual({
        backend: 'webgl',
        source: 'url-renderer',
      });
      expect(storage.get('zephyr.renderer')).toBe('webgl');
      expect(resolveRendererChoice('?renderer=webgpu&webgl2=1').backend).toBe('webgpu');
    });

    it('builds an opt-in link that keeps other params and drops ?renderer', () => {
      const url = new URL(webgl2OptInHref('https://x.test/zephyr/?sats=5000&renderer=webgpu'));
      expect(url.searchParams.get('webgl2')).toBe('1');
      expect(url.searchParams.get('sats')).toBe('5000');
      expect(url.searchParams.has('renderer')).toBe(false);
    });

    it('builds a back-to-WebGPU link that overwrites a saved WebGL preference', () => {
      const url = new URL(webgpuHref('https://x.test/?webgl2=1&sats=5000'));
      expect(url.searchParams.get('renderer')).toBe('webgpu');
      expect(url.searchParams.has('webgl2')).toBe(false);
      expect(url.searchParams.get('sats')).toBe('5000');
    });
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

describe('webglContextAttributes', () => {
  it('keeps failIfMajorPerformanceCaveat off by default (SwiftShader CI)', () => {
    expect(webglContextAttributes('')).toMatchObject({
      preserveDrawingBuffer: true,
      xrCompatible: true,
      failIfMajorPerformanceCaveat: false,
    });
    expect(webglContextAttributes('?renderer=webgl&sats=30000')).toMatchObject({
      failIfMajorPerformanceCaveat: false,
    });
  });

  it('opts into failIfMajorPerformanceCaveat with ?glcaveat=1', () => {
    expect(webglContextAttributes('?renderer=webgl&glcaveat=1').failIfMajorPerformanceCaveat).toBe(
      true,
    );
  });
});
