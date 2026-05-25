/**
 * Grok Zephyr - Quality Preset System
 *
 * Defines four preset levels (Low / Balanced / High / Cinematic) that
 * control visual fidelity at runtime without requiring shader recompilation.
 * Settings are persisted to localStorage and can also be set via URL param
 * (?preset=low|balanced|high|cinematic).
 */

/** Available quality levels */
export type QualityLevel = 'low' | 'balanced' | 'high' | 'cinematic';

/** Trail rendering settings within a quality preset */
export interface TrailQualitySettings {
  enabled: boolean;
  maxLength: number;
  fadeOut: number;
  ribbonWidth: number;
}

/** Atmosphere rendering settings within a quality preset */
export interface AtmosphereQualitySettings {
  enabled: boolean;
  cloudAlpha: number;
  cloudSpeed: number;
  cloudScale: number;
  hazeStrength: number;
}

/** Full quality preset definition */
export interface QualityPreset {
  level: QualityLevel;
  label: string;
  description: string;
  trail: TrailQualitySettings;
  atmosphere: AtmosphereQualitySettings;
}

/** All built-in quality presets */
export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: {
    level: 'low',
    label: 'LOW',
    description: 'Minimal effects — best for low-end devices',
    trail: {
      enabled: false,
      maxLength: 0,
      fadeOut: 0,
      ribbonWidth: 0,
    },
    atmosphere: {
      enabled: false,
      cloudAlpha: 0,
      cloudSpeed: 0,
      cloudScale: 1.0,
      hazeStrength: 0,
    },
  },

  balanced: {
    level: 'balanced',
    label: 'BALANCED',
    description: 'Good performance/quality trade-off',
    trail: {
      enabled: true,
      maxLength: 30,
      fadeOut: 30,
      ribbonWidth: 6.0,
    },
    atmosphere: {
      enabled: true,
      cloudAlpha: 0.25,
      cloudSpeed: 0.015,
      cloudScale: 1.004,
      hazeStrength: 0.18,
    },
  },

  high: {
    level: 'high',
    label: 'HIGH',
    description: 'Full quality for modern discrete GPUs',
    trail: {
      enabled: true,
      maxLength: 45,
      fadeOut: 45,
      ribbonWidth: 8.0,
    },
    atmosphere: {
      enabled: true,
      cloudAlpha: 0.38,
      cloudSpeed: 0.02,
      cloudScale: 1.006,
      hazeStrength: 0.28,
    },
  },

  cinematic: {
    level: 'cinematic',
    label: 'CINEMATIC',
    description: 'Maximum fidelity — demos and screenshots',
    trail: {
      enabled: true,
      maxLength: 90,
      fadeOut: 60,
      ribbonWidth: 10.0,
    },
    atmosphere: {
      enabled: true,
      cloudAlpha: 0.50,
      cloudSpeed: 0.02,
      cloudScale: 1.008,
      hazeStrength: 0.40,
    },
  },
};

const STORAGE_KEY = 'grokzephyr-quality';

/**
 * Load the quality level the user last selected from localStorage.
 * Falls back to 'high' when nothing is stored or storage is unavailable.
 */
export function loadSavedQualityLevel(): QualityLevel {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as QualityLevel | null;
    if (saved && saved in QUALITY_PRESETS) return saved;
  } catch {
    // localStorage may be unavailable in some environments; ignore silently
  }
  return 'high';
}

/**
 * Persist the selected quality level to localStorage.
 */
export function saveQualityLevel(level: QualityLevel): void {
  try {
    localStorage.setItem(STORAGE_KEY, level);
  } catch {
    // ignore
  }
}

/**
 * Parse a quality level string from a URL search param value.
 * Returns null when the string does not match any known preset.
 */
export function parseQualityParam(value: string | null): QualityLevel | null {
  if (!value) return null;
  const lower = value.toLowerCase() as QualityLevel;
  return lower in QUALITY_PRESETS ? lower : null;
}
