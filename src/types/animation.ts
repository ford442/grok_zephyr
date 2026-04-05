/**
 * Grok Zephyr - Animation and Visual Enhancement Types
 * 
 * Shared types for LOD, animations, atmosphere, and post-processing.
 */

import type { Vec3 } from './index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// ANIMATION SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

/** Available animation patterns */
export type AnimationPattern = 
  | 'chaos' 
  | 'grok' 
  | 'x' 
  | 'smile' 
  | 'rain' 
  | 'heartbeat' 
  | 'spiral' 
  | 'text' 
  | 'fireworks'
  | 'none';

/** Animation playback phases */
export type AnimationPhase = 'idle' | 'emerge' | 'playing' | 'transitioning' | 'fade';

/** Animation state interface */
export interface AnimationState {
  currentPattern: AnimationPattern;
  phase: AnimationPhase;
  progress: number;      // 0-1 progress within current phase
  speed: number;         // 0.25-4.0 playback speed
  loop: boolean;         // loop or play once
  elapsedTime: number;   // total elapsed time in current animation
  phaseStartTime: number; // when current phase started
  nextPattern: AnimationPattern | null; // queued next pattern
}

/** Animation configuration */
export interface AnimationConfig {
  defaultPattern: AnimationPattern;
  defaultSpeed: number;
  loopByDefault: boolean;
  transitionDuration: number; // seconds for pattern transitions
  phaseDurations: Record<Exclude<AnimationPhase, 'idle' | 'transitioning'>, number>;
}

/** Satellite feature assignment for pattern animations */
export type SatelliteFeature = 'none' | 'eye_left' | 'eye_right' | 'smile_curve' | 'heart' | 'text_pixel';

/** Per-satellite animation data (packed into GPU buffer) */
export interface SatelliteAnimationData {
  feature: SatelliteFeature;
  featureParam: number;  // additional parameter (e.g., position along curve)
  baseColor: [number, number, number];
  targetColor: [number, number, number];
  phaseOffset: number;   // random offset for wave effects
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOD (LEVEL OF DETAIL) SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

/** LOD tier distances in kilometers */
export interface LODDistances {
  tier0: number;  // < 500km: 4x4 MSAA sub-pixel grid
  tier1: number;  // < 2000km: 2x2 clustered points
  tier2: number;  // < 8000km: Single pixel with TAA
  tier3: number;  // >= 8000km: Impostor billboard clusters
}

/** LOD configuration */
export interface LODConfig {
  tierDistances: [number, number, number]; // thresholds between tiers
  msaaSamples: number;
  taaEnabled: boolean;
  clusterSize: number;      // satellites per impostor cluster (tier 3)
  motionBlurEnabled: boolean;
}

/** LOD tier info passed to shaders */
export interface LODTierData {
  tier: number;
  blendFactor: number;  // for smooth transitions between tiers
  pointSize: number;
}

/** TAA (Temporal Anti-Aliasing) configuration */
export interface TAAConfig {
  enabled: boolean;
  jitterStrength: number;   // Halton sequence jitter amount
  historyWeight: number;    // blend factor for history (0.8-0.95)
  neighborhoodClamp: boolean;
  velocityReprojection: boolean;
}

/** Halton sequence generator for TAA jitter */
export interface HaltonSequence {
  base2: number[];
  base3: number[];
  index: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ATMOSPHERE & LIGHTING
// ═══════════════════════════════════════════════════════════════════════════════

/** Atmospheric scattering parameters */
export interface AtmosphereParams {
  rayleighScale: number;
  mieScale: number;
  sunDirection: Vec3;
  sunIntensity: number;
  cityLightsIntensity: number;
  twilightGradient: [Vec3, Vec3, Vec3]; // zenith, horizon, ground colors
}

/** Lens effects configuration */
export interface LensEffectsConfig {
  chromaticAberration: {
    enabled: boolean;
    strength: number;      // RGB split amount at screen edges
  };
  lensFlare: {
    enabled: boolean;
    intensity: number;
    anamorphic: boolean;   // horizontal streaks
  };
  starburst: {
    enabled: boolean;
    points: number;        // 6 for typical camera
    intensity: number;
  };
  vignetting: {
    enabled: boolean;
    intensity: number;
    smoothness: number;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// VOLUMETRIC EFFECTS
// ═══════════════════════════════════════════════════════════════════════════════

/** Volumetric beam configuration */
export interface VolumetricBeamConfig {
  enabled: boolean;
  maxSteps: number;         // ray march steps (8 for performance)
  stepSize: number;         // km per step
  density: number;          // scattering density
  mieAsymmetry: number;     // g parameter (-1 to 1)
}

/** Trail configuration */
export interface TrailConfig {
  enabled: boolean;
  maxLength: number;        // seconds of trail history
  fadeOut: number;          // seconds to fade
  colorByShell: boolean;    // color-code by orbital shell
  ribbonWidth: number;      // km width of trail ribbon
}

/** Trail vertex data */
export interface TrailPoint {
  position: Vec3;
  timestamp: number;
  intensity: number;
  shellIndex: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST-PROCESSING
// ═══════════════════════════════════════════════════════════════════════════════

/** Color grading controls (lift/gamma/gain) */
export interface ColorGrading {
  lift: Vec3;
  gamma: Vec3;
  gain: Vec3;
  saturation: number;
  contrast: number;
  brightness: number;
}

/** Film grain configuration */
export interface FilmGrainConfig {
  enabled: boolean;
  intensity: number;        // 0-1, typically 0.02 (2%)
  seed: number;
}

/** Sharpness filter config */
export interface SharpnessConfig {
  enabled: boolean;
  strength: number;         // 0-1
  radius: number;           // pixel radius
}

/** Auto-exposure configuration */
export interface AutoExposureConfig {
  enabled: boolean;
  targetLuminance: number;  // target average luminance
  adaptationSpeed: number;  // seconds to adapt
  minExposure: number;
  maxExposure: number;
}

/** Full post-process stack configuration */
export interface PostProcessConfig {
  colorGrading: ColorGrading;
  filmGrain: FilmGrainConfig;
  sharpness: SharpnessConfig;
  autoExposure: AutoExposureConfig;
  tonemapping: 'aces' | 'reinhard' | 'filmic';
}

// ═══════════════════════════════════════════════════════════════════════════════
// PERFORMANCE & QUALITY
// ═══════════════════════════════════════════════════════════════════════════════

/** Quality preset levels */
export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';

/** Quality settings bundle */
export interface QualitySettings {
  lod: LODConfig;
  taa: TAAConfig;
  atmosphere: AtmosphereParams;
  lens: LensEffectsConfig;
  beams: VolumetricBeamConfig;
  trails: TrailConfig;
  postProcess: PostProcessConfig;
}

/** Performance profiler data */
export interface PipelineTiming {
  computePass: number;
  beamComputePass: number;
  scenePass: number;
  bloomPasses: number;
  compositePass: number;
  totalFrame: number;
}

/** Adaptive quality controller */
export interface AdaptiveQuality {
  enabled: boolean;
  targetFPS: number;
  minQuality: QualityPreset;
  maxQuality: QualityPreset;
  fpsHistory: number[];
  lastAdjustment: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEFAULT CONFIGURATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/** Default LOD configuration for RTX 3060 @ 60fps */
export const DEFAULT_LOD_CONFIG: LODConfig = {
  tierDistances: [500, 2000, 8000],
  msaaSamples: 4,
  taaEnabled: true,
  clusterSize: 16,
  motionBlurEnabled: true,
};

/** Default TAA configuration */
export const DEFAULT_TAA_CONFIG: TAAConfig = {
  enabled: true,
  jitterStrength: 0.5,
  historyWeight: 0.88,
  neighborhoodClamp: true,
  velocityReprojection: true,
};

/** Default animation configuration */
export const DEFAULT_ANIMATION_CONFIG: AnimationConfig = {
  defaultPattern: 'grok',
  defaultSpeed: 1.0,
  loopByDefault: true,
  transitionDuration: 2.0,
  phaseDurations: {
    emerge: 3.0,
    playing: 8.0,
    fade: 2.0,
  },
};

/** Default post-process configuration */
export const DEFAULT_POSTPROCESS_CONFIG: PostProcessConfig = {
  colorGrading: {
    lift: [0.0, 0.02, 0.03],
    gamma: [1.0, 1.0, 1.0],
    gain: [1.05, 1.0, 0.95],
    saturation: 1.1,
    contrast: 1.05,
    brightness: 0.0,
  },
  filmGrain: {
    enabled: true,
    intensity: 0.02,
    seed: 0,
  },
  sharpness: {
    enabled: true,
    strength: 0.3,
    radius: 1.0,
  },
  autoExposure: {
    enabled: false,
    targetLuminance: 0.18,
    adaptationSpeed: 1.0,
    minExposure: 0.125,
    maxExposure: 8.0,
  },
  tonemapping: 'aces',
};

/** Quality presets */
export const QUALITY_PRESETS: Record<QualityPreset, Partial<QualitySettings>> = {
  low: {
    lod: { ...DEFAULT_LOD_CONFIG, taaEnabled: false, motionBlurEnabled: false },
    taa: { ...DEFAULT_TAA_CONFIG, enabled: false },
    beams: { enabled: false, maxSteps: 4, stepSize: 50.0, density: 0.1, mieAsymmetry: 0.7 },
    trails: { enabled: true, maxLength: 2, fadeOut: 1.0, colorByShell: true, ribbonWidth: 20.0 },
  },
  medium: {
    lod: { ...DEFAULT_LOD_CONFIG, taaEnabled: true, motionBlurEnabled: false },
    taa: DEFAULT_TAA_CONFIG,
    beams: { enabled: true, maxSteps: 6, stepSize: 40.0, density: 0.15, mieAsymmetry: 0.75 },
    trails: { enabled: true, maxLength: 5, fadeOut: 2.0, colorByShell: true, ribbonWidth: 30.0 },
  },
  high: {
    lod: DEFAULT_LOD_CONFIG,
    taa: DEFAULT_TAA_CONFIG,
    beams: { enabled: true, maxSteps: 8, stepSize: 30.0, density: 0.2, mieAsymmetry: 0.8 },
    trails: { enabled: true, maxLength: 10, fadeOut: 3.0, colorByShell: true, ribbonWidth: 40.0 },
  },
  ultra: {
    lod: { ...DEFAULT_LOD_CONFIG, msaaSamples: 8 },
    taa: { ...DEFAULT_TAA_CONFIG, historyWeight: 0.92 },
    beams: { enabled: true, maxSteps: 16, stepSize: 20.0, density: 0.3, mieAsymmetry: 0.85 },
    trails: { enabled: true, maxLength: 20, fadeOut: 5.0, colorByShell: true, ribbonWidth: 50.0 },
  },
};
