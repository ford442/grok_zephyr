/**
 * HDR canvas presentation resolution for WebGPU swapchains.
 *
 * Chrome 129+ supports `rgba16float` canvases with `toneMapping.mode: 'extended'`.
 * Activation is gated by quality preset, `matchMedia('(dynamic-range: high)')`,
 * and optional `?hdr=0|1` URL / localStorage overrides.
 */

import type { QualityLevel } from '@/core/QualityPresets.js';
import { RENDER } from '@/types/constants.js';

export type PresentationMode = 'sdr' | 'hdr';

export interface CanvasPresentationOptions {
  format?: GPUTextureFormat;
  alphaMode?: GPUCanvasAlphaMode;
  colorSpace?: PredefinedColorSpace;
  toneMapping?: GPUCanvasToneMapping;
}

export interface ResolvedCanvasPresentation {
  mode: PresentationMode;
  format: GPUTextureFormat;
  alphaMode: GPUCanvasAlphaMode;
  colorSpace?: PredefinedColorSpace;
  toneMapping: GPUCanvasToneMapping;
}

const HDR_STORAGE_KEY = 'zephyr.hdr';

const QUALITY_LEVELS_ALLOWING_HDR: ReadonlySet<QualityLevel> = new Set(['high', 'cinematic']);

/** True when the OS reports an HDR-capable display. */
export function isHdrDisplay(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(dynamic-range: high)').matches;
}

/** Parse `?hdr=0|1` (and true/false/on/off aliases). Persists valid URL values. */
export function resolveHdrOverride(search: string = ''): boolean | null {
  const params = new URLSearchParams(search);
  const urlValue = params.get('hdr')?.toLowerCase();

  if (urlValue === '0' || urlValue === 'false' || urlValue === 'off') {
    try {
      localStorage.setItem(HDR_STORAGE_KEY, '0');
    } catch {
      // ignore
    }
    return false;
  }

  if (urlValue === '1' || urlValue === 'true' || urlValue === 'on') {
    try {
      localStorage.setItem(HDR_STORAGE_KEY, '1');
    } catch {
      // ignore
    }
    return true;
  }

  try {
    const stored = localStorage.getItem(HDR_STORAGE_KEY);
    if (stored === '0') return false;
    if (stored === '1') return true;
  } catch {
    // ignore
  }

  return null;
}

/** Whether the active quality tier allows HDR presentation. */
export function qualityAllowsHdr(qualityLevel: QualityLevel): boolean {
  return QUALITY_LEVELS_ALLOWING_HDR.has(qualityLevel);
}

/**
 * Decide if HDR canvas presentation should be requested before WebGPU context init.
 * URL override wins; otherwise high/cinematic + HDR display.
 */
export function shouldRequestHdrPresentation(
  qualityLevel: QualityLevel,
  search: string = typeof window !== 'undefined' ? window.location.search : '',
): boolean {
  const override = resolveHdrOverride(search);
  if (override !== null) return override;
  return qualityAllowsHdr(qualityLevel) && isHdrDisplay();
}

function preferredSdrFormat(): GPUTextureFormat {
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
    return navigator.gpu.getPreferredCanvasFormat();
  }
  return RENDER.SWAPCHAIN_FORMAT;
}

/** Build canvas presentation options passed into {@link WebGPUContext}. */
export function resolveCanvasPresentationOptions(
  qualityLevel: QualityLevel,
  search: string = typeof window !== 'undefined' ? window.location.search : '',
): CanvasPresentationOptions {
  if (!shouldRequestHdrPresentation(qualityLevel, search)) {
    return {
      format: preferredSdrFormat(),
      alphaMode: 'opaque',
      toneMapping: { mode: 'standard' },
    };
  }

  return {
    format: 'rgba16float',
    alphaMode: 'opaque',
    colorSpace: 'display-p3',
    toneMapping: { mode: 'extended' },
  };
}

/** Human-readable label for the performance dashboard. */
export function formatPresentationModeLabel(mode: PresentationMode): string {
  return mode === 'hdr' ? 'HDR (extended)' : 'SDR (standard)';
}
