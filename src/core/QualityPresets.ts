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
  scatteringLUT: boolean;
  cloudAlpha: number;
  cloudSpeed: number;
  cloudScale: number;
  hazeStrength: number;
}

/** Volumetric beam (god-ray) settings within a quality preset */
export interface VolumetricBeamQualitySettings {
  /** Enable the ray-marched volumetric beam pass. Only recommended for Cinematic. */
  enabled: boolean;
  /** Ray-march step count per beam (lower = faster, higher = more accurate). */
  maxSteps: number;
  /** Scattering density coefficient (0–1). */
  density: number;
  /** Beam light intensity multiplier. */
  intensity: number;
  /** Mie asymmetry g-factor (0 = isotropic, 1 = fully forward). */
  mieG: number;
  /** Volumetric beam radius in km. */
  beamRadius: number;
  /** Ambient light fraction added to every sample (0–0.2). */
  ambientFactor: number;
  /** Whether to apply Earth shadow occlusion. */
  earthShadow: boolean;
}

export type DepthOfFieldFocusMode = 'auto-center' | 'satellite-track' | 'surface-distance' | 'earth-center';

/** Depth-of-field settings within a quality preset */
export interface DepthOfFieldQualitySettings {
  enabled: boolean;
  focusMode: DepthOfFieldFocusMode;
  /** Used when focusMode = 'surface-distance' */
  surfaceDistanceKm: number;
  /** Maximum CoC radius in pixels at full resolution */
  maxBlurPx: number;
  /** CoC sensitivity scaling factor */
  cocScale: number;
  /** Focus interpolation rate (1/s) */
  transitionRate: number;
  /** Bilateral similarity shaping for CoC mismatch */
  depthSigma: number;
}

/** Motion blur settings within a quality preset */
export interface MotionBlurQualitySettings {
  enabled: boolean;
  /** Screen-space camera blur multiplier */
  cameraStrength: number;
  /** Per-satellite billboard stretch multiplier */
  satelliteStretch: number;
  /** Sample count along motion direction (8-16 recommended) */
  tapCount: number;
}

/** Full quality preset definition */
export interface QualityPreset {
  level: QualityLevel;
  label: string;
  description: string;
  trail: TrailQualitySettings;
  atmosphere: AtmosphereQualitySettings;
  /** Whether TAA should be enabled for this quality tier */
  taaEnabled: boolean;
  /** Volumetric beam (god-ray) pass settings */
  volumetricBeams: VolumetricBeamQualitySettings;
  /** Depth-of-field post effect settings */
  depthOfField: DepthOfFieldQualitySettings;
  /** Camera + per-satellite motion blur */
  motionBlur: MotionBlurQualitySettings;
}

/** All built-in quality presets */
export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: {
    level: 'low',
    label: 'LOW',
    description: 'Minimal effects — best for low-end devices',
    taaEnabled: false,
    trail: {
      enabled: false,
      maxLength: 0,
      fadeOut: 0,
      ribbonWidth: 0,
    },
    atmosphere: {
      enabled: false,
      scatteringLUT: false,
      cloudAlpha: 0,
      cloudSpeed: 0,
      cloudScale: 1.0,
      hazeStrength: 0,
    },
    volumetricBeams: {
      enabled: false,
      maxSteps: 4,
      density: 0.06,
      intensity: 1.5,
      mieG: 0.6,
      beamRadius: 80.0,
      ambientFactor: 0.05,
      earthShadow: false,
    },
    depthOfField: {
      enabled: false,
      focusMode: 'auto-center',
      surfaceDistanceKm: 1200,
      maxBlurPx: 0,
      cocScale: 0,
      transitionRate: 4.0,
      depthSigma: 1.6,
    },
    motionBlur: {
      enabled: false,
      cameraStrength: 0.0,
      satelliteStretch: 0.0,
      tapCount: 8,
    },
  },

  balanced: {
    level: 'balanced',
    label: 'BALANCED',
    description: 'Good performance/quality trade-off',
    taaEnabled: true,
    trail: {
      enabled: true,
      maxLength: 30,
      fadeOut: 30,
      ribbonWidth: 6.0,
    },
    atmosphere: {
      enabled: true,
      scatteringLUT: false,
      cloudAlpha: 0.25,
      cloudSpeed: 0.015,
      cloudScale: 1.004,
      hazeStrength: 0.18,
    },
    volumetricBeams: {
      enabled: false,
      maxSteps: 6,
      density: 0.07,
      intensity: 1.8,
      mieG: 0.65,
      beamRadius: 80.0,
      ambientFactor: 0.05,
      earthShadow: false,
    },
    depthOfField: {
      enabled: false,
      focusMode: 'auto-center',
      surfaceDistanceKm: 1200,
      maxBlurPx: 0,
      cocScale: 0,
      transitionRate: 4.0,
      depthSigma: 1.6,
    },
    motionBlur: {
      enabled: true,
      cameraStrength: 0.55,
      satelliteStretch: 0.35,
      tapCount: 8,
    },
  },

  high: {
    level: 'high',
    label: 'HIGH',
    description: 'Full quality for modern discrete GPUs',
    taaEnabled: true,
    trail: {
      enabled: true,
      maxLength: 45,
      fadeOut: 45,
      ribbonWidth: 8.0,
    },
    atmosphere: {
      enabled: true,
      scatteringLUT: true,
      cloudAlpha: 0.38,
      cloudSpeed: 0.02,
      cloudScale: 1.006,
      hazeStrength: 0.28,
    },
    volumetricBeams: {
      enabled: false,
      maxSteps: 8,
      density: 0.08,
      intensity: 2.0,
      mieG: 0.7,
      beamRadius: 80.0,
      ambientFactor: 0.05,
      earthShadow: true,
    },
    depthOfField: {
      enabled: false,
      focusMode: 'auto-center',
      surfaceDistanceKm: 1200,
      maxBlurPx: 0,
      cocScale: 0,
      transitionRate: 4.0,
      depthSigma: 1.6,
    },
    motionBlur: {
      enabled: true,
      cameraStrength: 0.8,
      satelliteStretch: 0.6,
      tapCount: 12,
    },
  },

  cinematic: {
    level: 'cinematic',
    label: 'CINEMATIC',
    description: 'Maximum fidelity — demos and screenshots',
    taaEnabled: true,
    trail: {
      enabled: true,
      maxLength: 90,
      fadeOut: 60,
      ribbonWidth: 10.0,
    },
    atmosphere: {
      enabled: true,
      scatteringLUT: true,
      cloudAlpha: 0.50,
      cloudSpeed: 0.02,
      cloudScale: 1.008,
      hazeStrength: 0.40,
    },
    volumetricBeams: {
      enabled: true,
      maxSteps: 8,
      density: 0.08,
      intensity: 2.0,
      mieG: 0.7,
      beamRadius: 80.0,
      ambientFactor: 0.05,
      earthShadow: true,
    },
    depthOfField: {
      enabled: true,
      focusMode: 'satellite-track',
      surfaceDistanceKm: 1400,
      maxBlurPx: 12,
      cocScale: 1.6,
      transitionRate: 3.0,
      depthSigma: 1.4,
    },
    motionBlur: {
      enabled: true,
      cameraStrength: 1.0,
      satelliteStretch: 0.85,
      tapCount: 16,
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
