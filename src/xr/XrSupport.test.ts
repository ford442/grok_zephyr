import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  getXrSystem,
  hasXrGpuBinding,
  isImmersiveVrSupported,
  resolveXrBackend,
} from '@/xr/XrSupport.js';

describe('XrSupport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null when navigator.xr is missing', () => {
    vi.stubGlobal('navigator', {});
    expect(getXrSystem()).toBeNull();
  });

  it('isImmersiveVrSupported is false without xr', async () => {
    vi.stubGlobal('navigator', {});
    expect(await isImmersiveVrSupported()).toBe(false);
  });

  it('isImmersiveVrSupported reads isSessionSupported', async () => {
    vi.stubGlobal('navigator', {
      xr: {
        isSessionSupported: vi.fn((mode: string) => Promise.resolve(mode === 'immersive-vr')),
        requestSession: vi.fn(),
      },
    });
    expect(await isImmersiveVrSupported()).toBe(true);
  });

  it('hasXrGpuBinding needs both navigator.xr and an XRGPUBinding constructor', () => {
    const xr = { isSessionSupported: vi.fn(), requestSession: vi.fn() };
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('XRGPUBinding', class {});
    expect(hasXrGpuBinding()).toBe(false);

    vi.stubGlobal('navigator', { xr });
    vi.stubGlobal('XRGPUBinding', undefined);
    expect(hasXrGpuBinding()).toBe(false);

    vi.stubGlobal('XRGPUBinding', class {});
    expect(hasXrGpuBinding()).toBe(true);
  });

  it('resolveXrBackend prefers WebGPU only when the binding is ready', () => {
    expect(resolveXrBackend('webgpu', true)).toBe('webgpu');
    expect(resolveXrBackend('webgpu', false)).toBeNull();
    expect(resolveXrBackend('webgl', false)).toBe('webgl');
    expect(resolveXrBackend('webgl', true)).toBe('webgl');
  });
});
