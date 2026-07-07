/**
 * Runtime image tuning — bloom threshold/knee/intensity and satellite point kernel.
 * Persisted to localStorage; seedable via URL query params.
 */

import { CULLING, RENDER } from '@/types/constants.js';
import {
  ANIMATION_MASTER_INTENSITY_DEFAULT,
  ANIMATION_MASTER_INTENSITY_MAX,
  ANIMATION_MASTER_INTENSITY_MIN,
} from '@/core/AnimationTuning.js';

export interface ImageTuningSettings {
  /** Luminance threshold for bloom extraction (0.5–3.0) */
  bloomThreshold: number;
  /** Soft-knee width around bloom threshold (0.01–0.3) */
  bloomKnee: number;
  /** Composite-pass bloom multiplier (0.0–3.0) */
  bloomIntensity: number;
  /** Satellite core outer smoothstep edge (0.20–0.55) */
  satCoreOuter: number;
  /** Satellite core inner smoothstep edge (0.02–0.30, must be < outer) */
  satCoreInner: number;
  /** Satellite halo strength in the point kernel (0.05–0.40) */
  haloStrength: number;
  /** Per-point core intensity boost (1.5–3.0) */
  coreBoost: number;
  /** Max world-space distance (km) for satellite rendering */
  distanceCullKm: number;
  /** Per-view animation amplitude (blended during mode transitions) */
  animationIntensity: number;
  /** Per-view animation contrast / gamma curve */
  animationContrast: number;
  /** Dev master multiplier on animationIntensity (0.25–2.0) */
  animationMasterIntensity: number;
  /** When true, shaders enforce shipping luminance/kernel floors */
  enforceFloors: boolean;
}

export const IMAGE_TUNING_STORAGE_KEY = 'zephyr.imageTuning';

/** Shipping defaults aligned with the satellite clarity sharpening pass (#73). */
export const SHIPPING_IMAGE_TUNING: ImageTuningSettings = {
  bloomThreshold: 1.5,
  bloomKnee: 0.05,
  bloomIntensity: RENDER.BLOOM_INTENSITY,
  satCoreOuter: 0.40,
  satCoreInner: 0.10,
  haloStrength: 0.20,
  coreBoost: 2.5,
  distanceCullKm: CULLING.MAX_DISTANCE,
  animationIntensity: 1.0,
  animationContrast: 1.0,
  animationMasterIntensity: ANIMATION_MASTER_INTENSITY_DEFAULT,
  enforceFloors: true,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseFloatParam(
  raw: string | null,
  min: number,
  max: number,
  fallback: number,
): number {
  if (raw === null || raw === '') return fallback;
  const val = Number(raw);
  if (!Number.isFinite(val)) return fallback;
  return clamp(val, min, max);
}

function normalizeCoreEdges(outer: number, inner: number): { outer: number; inner: number } {
  const o = clamp(outer, 0.20, 0.55);
  const i = clamp(inner, 0.02, 0.30);
  return i < o ? { outer: o, inner: i } : { outer: o, inner: Math.max(0.02, o - 0.05) };
}

/** Pack GPU uniform for satellite fragment kernel (32 bytes). */
export function packSatelliteVisualUniform(tuning: ImageTuningSettings): Float32Array {
  const { outer, inner } = normalizeCoreEdges(tuning.satCoreOuter, tuning.satCoreInner);
  const haloOuter = Math.min(0.58, outer + 0.10);
  const haloInner = Math.min(haloOuter - 0.02, inner + 0.25);
  const haloStrength = clamp(tuning.haloStrength, 0.05, 0.40);
  const coreBoost = clamp(tuning.coreBoost, 1.5, 3.0);
  const distanceCullKm = clamp(tuning.distanceCullKm, 10_000, 600_000);
  const animationIntensity = clamp(tuning.animationIntensity, 0.25, 2.5);
  const animationContrast = clamp(tuning.animationContrast, 0.5, 1.5);
  return new Float32Array([
    outer,
    inner,
    haloOuter,
    haloInner,
    haloStrength,
    coreBoost,
    distanceCullKm,
    animationIntensity,
    animationContrast,
  ]);
}

function loadStored(): Partial<ImageTuningSettings> {
  try {
    const raw = localStorage.getItem(IMAGE_TUNING_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<ImageTuningSettings>;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Resolve image tuning from URL params, localStorage, and shipping defaults.
 * `?dev=1` disables shader floors so sliders use the full configured range.
 */
export function resolveImageTuning(search = ''): ImageTuningSettings {
  const params = new URLSearchParams(search);
  const stored = loadStored();
  const devMode = params.get('dev') === '1';

  const bloomThreshold = parseFloatParam(
    params.get('bloomThreshold'),
    0.5,
    3.0,
    typeof stored.bloomThreshold === 'number' ? stored.bloomThreshold : SHIPPING_IMAGE_TUNING.bloomThreshold,
  );
  const bloomKnee = parseFloatParam(
    params.get('bloomKnee'),
    0.01,
    0.3,
    typeof stored.bloomKnee === 'number' ? stored.bloomKnee : SHIPPING_IMAGE_TUNING.bloomKnee,
  );
  const bloomIntensity = parseFloatParam(
    params.get('bloomIntensity'),
    0.0,
    3.0,
    typeof stored.bloomIntensity === 'number' ? stored.bloomIntensity : SHIPPING_IMAGE_TUNING.bloomIntensity,
  );

  const satCoreOuter = parseFloatParam(
    params.get('satCore'),
    0.20,
    0.55,
    typeof stored.satCoreOuter === 'number' ? stored.satCoreOuter : SHIPPING_IMAGE_TUNING.satCoreOuter,
  );
  const satCoreInner = parseFloatParam(
    params.get('satFalloff') ?? params.get('satCoreInner'),
    0.02,
    0.30,
    typeof stored.satCoreInner === 'number' ? stored.satCoreInner : SHIPPING_IMAGE_TUNING.satCoreInner,
  );
  const { outer, inner } = normalizeCoreEdges(satCoreOuter, satCoreInner);

  return {
    bloomThreshold,
    bloomKnee,
    bloomIntensity,
    satCoreOuter: outer,
    satCoreInner: inner,
    haloStrength:
      typeof stored.haloStrength === 'number'
        ? clamp(stored.haloStrength, 0.05, 0.40)
        : SHIPPING_IMAGE_TUNING.haloStrength,
    coreBoost:
      typeof stored.coreBoost === 'number'
        ? clamp(stored.coreBoost, 1.5, 3.0)
        : SHIPPING_IMAGE_TUNING.coreBoost,
    distanceCullKm:
      typeof stored.distanceCullKm === 'number'
        ? clamp(stored.distanceCullKm, 10_000, 600_000)
        : SHIPPING_IMAGE_TUNING.distanceCullKm,
    animationIntensity: SHIPPING_IMAGE_TUNING.animationIntensity,
    animationContrast: SHIPPING_IMAGE_TUNING.animationContrast,
    animationMasterIntensity: parseFloatParam(
      params.get('animIntensity'),
      ANIMATION_MASTER_INTENSITY_MIN,
      ANIMATION_MASTER_INTENSITY_MAX,
      typeof stored.animationMasterIntensity === 'number'
        ? stored.animationMasterIntensity
        : SHIPPING_IMAGE_TUNING.animationMasterIntensity,
    ),
    enforceFloors: devMode ? false : (stored.enforceFloors ?? SHIPPING_IMAGE_TUNING.enforceFloors),
  };
}

/** Persist slider values (excluding dev-mode floor override). */
export function saveImageTuning(settings: ImageTuningSettings): void {
  try {
    const { enforceFloors: _ef, ...persisted } = settings;
    localStorage.setItem(IMAGE_TUNING_STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    // localStorage may be unavailable; ignore persistence failures.
  }
}
