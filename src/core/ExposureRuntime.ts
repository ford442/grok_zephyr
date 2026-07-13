import type { TonemapMode } from '@/render/RenderPipeline.js';
import { clamp } from '@/utils/math.js';
import type { AppRuntime } from '@/app/AppRuntime.js';

export type ExposureMode = 'auto' | 'manual';

export interface ExposureRuntimeSettings {
  mode: ExposureMode;
  manualExposure: number;
  adaptationSpeed: number;
  tonemapMode: TonemapMode;
}

const EXPOSURE_STORAGE_KEY = 'grokzephyr-exposure';

export const DEFAULT_EXPOSURE_SETTINGS: ExposureRuntimeSettings = {
  mode: 'auto',
  manualExposure: 1.0,
  adaptationSpeed: 1.8,
  tonemapMode: 0,
};

export function parseSavedExposureSettings(): ExposureRuntimeSettings {
  try {
    const raw = localStorage.getItem(EXPOSURE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_EXPOSURE_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<ExposureRuntimeSettings>;
    const mode: ExposureMode = parsed.mode === 'manual' ? 'manual' : 'auto';
    const tonemapCandidate = Number(parsed.tonemapMode);
    const tonemapMode: TonemapMode = (
      tonemapCandidate >= 0 && tonemapCandidate <= 3 ? tonemapCandidate : 0
    ) as TonemapMode;
    return {
      mode,
      manualExposure: clamp(Number(parsed.manualExposure) || 1.0, 0.1, 10.0),
      adaptationSpeed: clamp(Number(parsed.adaptationSpeed) || 1.8, 0.1, 5.0),
      tonemapMode,
    };
  } catch {
    return { ...DEFAULT_EXPOSURE_SETTINGS };
  }
}

export function saveExposureSettings(settings: ExposureRuntimeSettings): void {
  try {
    localStorage.setItem(EXPOSURE_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage may be unavailable; ignore persistence failures.
  }
}

export function applyExposureSettings(rt: AppRuntime): void {
  rt.exposureSettings.manualExposure = clamp(rt.exposureSettings.manualExposure, 0.1, 10.0);
  rt.exposureSettings.adaptationSpeed = clamp(rt.exposureSettings.adaptationSpeed, 0.1, 5.0);
  rt.pipeline?.setExposureSettings({
    autoEnabled: rt.exposureSettings.mode === 'auto',
    manualExposure: rt.exposureSettings.manualExposure,
    adaptationSpeed: rt.exposureSettings.adaptationSpeed,
    tonemapMode: rt.exposureSettings.tonemapMode,
  });
  rt.ui.setExposureControls(rt.exposureSettings);
  saveExposureSettings(rt.exposureSettings);
}
