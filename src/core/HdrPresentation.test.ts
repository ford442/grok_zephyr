import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatPresentationModeLabel,
  isHdrDisplay,
  qualityAllowsHdr,
  resolveCanvasPresentationOptions,
  resolveHdrOverride,
  shouldRequestHdrPresentation,
} from './HdrPresentation.js';

describe('HdrPresentation', () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    });
    vi.stubGlobal('window', {
      matchMedia: (query: string) => ({
        matches: query === '(dynamic-range: high)',
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
      location: { search: '' },
    });
    vi.stubGlobal('navigator', {
      gpu: { getPreferredCanvasFormat: () => 'bgra8unorm' },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects HDR displays via matchMedia', () => {
    expect(isHdrDisplay()).toBe(true);
  });

  it('parses ?hdr=0|1 and persists overrides', () => {
    expect(resolveHdrOverride('?hdr=1')).toBe(true);
    expect(storage.get('zephyr.hdr')).toBe('1');
    expect(resolveHdrOverride('')).toBe(true);

    expect(resolveHdrOverride('?hdr=0')).toBe(false);
    expect(storage.get('zephyr.hdr')).toBe('0');
  });

  it('ignores invalid hdr values', () => {
    expect(resolveHdrOverride('?hdr=maybe')).toBeNull();
  });

  it('gates HDR behind high/cinematic quality unless forced', () => {
    expect(qualityAllowsHdr('high')).toBe(true);
    expect(qualityAllowsHdr('cinematic')).toBe(true);
    expect(qualityAllowsHdr('balanced')).toBe(false);

    expect(shouldRequestHdrPresentation('high', '')).toBe(true);
    expect(shouldRequestHdrPresentation('balanced', '')).toBe(false);
    expect(shouldRequestHdrPresentation('balanced', '?hdr=1')).toBe(true);
    expect(shouldRequestHdrPresentation('high', '?hdr=0')).toBe(false);
  });

  it('resolves SDR canvas options by default on balanced quality', () => {
    const opts = resolveCanvasPresentationOptions('balanced', '');
    expect(opts.format).toBe('bgra8unorm');
    expect(opts.toneMapping).toEqual({ mode: 'standard' });
  });

  it('resolves HDR canvas options on high quality + HDR display', () => {
    const opts = resolveCanvasPresentationOptions('high', '');
    expect(opts.format).toBe('rgba16float');
    expect(opts.toneMapping).toEqual({ mode: 'extended' });
    expect(opts.colorSpace).toBe('display-p3');
  });

  it('formats presentation labels', () => {
    expect(formatPresentationModeLabel('sdr')).toBe('SDR (standard)');
    expect(formatPresentationModeLabel('hdr')).toBe('HDR (extended)');
  });
});
