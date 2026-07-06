/**
 * Per-pattern beam personality and per-view-mode intensity scaling.
 */

import type { VolumetricBeamConfig } from '@/render/VolumetricBeamRenderer.js';

/** Beam brightness multiplier keyed by view_mode index (0–5). */
export const BEAM_VIEW_INTENSITY: readonly number[] = [
  0.95, // Horizon
  1.0,  // God
  0.4,  // Fleet POV — motion clutter
  0.6,  // Ground — sky projections, not laser pointers
  1.3,  // Moon — distant ring emphasis
  0.75, // Skyline — city foreground competes
] as const;

/** Keep in sync with `viewBeamScale()` in beam.ts and volumetricBeams.ts. */

export function beamViewIntensity(viewModeIndex: number): number {
  const idx = Math.max(0, Math.min(BEAM_VIEW_INTENSITY.length - 1, viewModeIndex | 0));
  return BEAM_VIEW_INTENSITY[idx] ?? 1.0;
}

/** Pattern-specific volumetric overrides layered on the quality preset. */
export function volumetricPatternOverrides(
  patternMode: number,
): Partial<VolumetricBeamConfig> {
  switch (patternMode | 0) {
    case 0: // CHAOS — skip earth shadow for performance
      return {
        earthShadow: false,
        density: 0.055,
        maxSteps: 6,
        beamRadius: 95,
        intensity: 1.85,
      };
    case 1: // GROK — earth shadow god-rays
      return {
        earthShadow: true,
        density: 0.092,
        maxSteps: 8,
        beamRadius: 82,
        intensity: 2.25,
        mieG: 0.78,
      };
    case 2: // 𝕏 LOGO — tighter, lower density
      return {
        earthShadow: true,
        density: 0.048,
        maxSteps: 7,
        beamRadius: 58,
        intensity: 1.75,
        mieG: 0.62,
      };
    default:
      return {};
  }
}

/** Merge a quality-preset volumetric block with active pattern overrides. */
export function mergeVolumetricBeamConfig(
  preset: {
    maxSteps: number;
    density: number;
    intensity: number;
    mieG: number;
    beamRadius: number;
    ambientFactor: number;
    earthShadow: boolean;
  },
  patternMode: number,
): Partial<VolumetricBeamConfig> {
  return {
    maxSteps: preset.maxSteps,
    density: preset.density,
    intensity: preset.intensity,
    mieG: preset.mieG,
    beamRadius: preset.beamRadius,
    ambientFactor: preset.ambientFactor,
    earthShadow: preset.earthShadow,
    ...volumetricPatternOverrides(patternMode),
  };
}
