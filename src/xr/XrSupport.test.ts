import { describe, expect, it, vi, afterEach } from 'vitest';
import { getXrSystem, isImmersiveVrSupported } from '@/xr/XrSupport.js';

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
});
