
import { type TonemapMode } from '@/render/RenderPipeline.js';

export const CELESTRAK_GROUPS: Record<string, string> = {
  starlink: 'starlink',
  oneweb: 'oneweb',
  iridium: 'iridium',
  'iridium-next': 'iridium-NEXT',
  gps: 'gps-ops',
  galileo: 'galileo',
  stations: 'stations',
  active: 'active',
  visual: 'visual',
  weather: 'weather',
  noaa: 'noaa',
  goes: 'goes',
  resource: 'resource',
  sarsat: 'sarsat',
  disaster: 'disaster',
  search_rescue: 'search-rescue',
  cubesat: 'cubesat',
  amateur: 'amateur',
  x_comm: 'x-comm',
  other_comm: 'other-comm',
  intelsat: 'intelsat',
  ses: 'ses',
  geo: 'geo',
};

export const TIMING_ESTIMATES = {
  COMPUTE_ORBITAL: 1.5,
  COMPUTE_SMILE: 0.5,
  COMPUTE_SKY_STRIPS: 0.8,
  SCENE_EARTH: 1.5,
  SCENE_STARS: 0.2,
  SCENE_SATELLITES: 1.2,
  SCENE_TRAILS: 2.0,
  SCENE_PATTERNS: 1.0,
  SCENE_BEAMS: 2.5,
  BASE_BLOOM: 2.0,
  BASE_POST: 1.5,
};

export interface ExposureRuntimeSettings {
  manualExposure: number;
  adaptationSpeed: number;
  tonemapMode: TonemapMode;
}

export const EXPOSURE_STORAGE_KEY = 'grokzephyr-exposure';
export const DEFAULT_EXPOSURE_SETTINGS: ExposureRuntimeSettings = {
  manualExposure: 1.0,
  adaptationSpeed: 1.8,
  tonemapMode: 0,
};

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function parseSavedExposureSettings(): ExposureRuntimeSettings {
  try {
    const raw = localStorage.getItem(EXPOSURE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_EXPOSURE_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<ExposureRuntimeSettings>;

    const tonemapCandidate = Number(parsed.tonemapMode);
    const tonemapMode = (tonemapCandidate >= 0 && tonemapCandidate <= 3 ? tonemapCandidate : 0) as TonemapMode;
    return {
      manualExposure: clamp(Number(parsed.manualExposure) || 1.0, 0.1, 10.0),
      adaptationSpeed: clamp(Number(parsed.adaptationSpeed) || 1.8, 0.1, 5.0),
      tonemapMode
    };
  } catch {
    return { ...DEFAULT_EXPOSURE_SETTINGS };
  }
}

export function saveExposureSettings(settings: ExposureRuntimeSettings): void {
  try {
    localStorage.setItem(EXPOSURE_STORAGE_KEY, JSON.stringify(settings));
  } catch {
  }
}
