import { describe, expect, it } from 'vitest';
import {
  BEAM_VIEW_INTENSITY,
  beamViewIntensity,
  mergeVolumetricBeamConfig,
  volumetricPatternOverrides,
} from './BeamPatternProfile.js';

describe('BeamPatternProfile', () => {
  it('scales beam intensity per view mode', () => {
    expect(beamViewIntensity(3)).toBe(0.6);
    expect(beamViewIntensity(4)).toBe(1.3);
    expect(beamViewIntensity(2)).toBe(0.4);
    expect(BEAM_VIEW_INTENSITY[1]).toBe(1.0);
  });

  it('couples volumetric earthShadow to GROK and disables for CHAOS', () => {
    expect(volumetricPatternOverrides(0).earthShadow).toBe(false);
    expect(volumetricPatternOverrides(0).maxSteps).toBeLessThanOrEqual(6);
    expect(volumetricPatternOverrides(1).earthShadow).toBe(true);
    expect(volumetricPatternOverrides(2).density).toBeLessThan(
      volumetricPatternOverrides(1).density!,
    );
    expect(volumetricPatternOverrides(2).beamRadius).toBeLessThan(
      volumetricPatternOverrides(1).beamRadius!,
    );
  });

  it('merges quality preset with pattern overrides', () => {
    const merged = mergeVolumetricBeamConfig(
      {
        maxSteps: 8,
        density: 0.08,
        intensity: 2.0,
        mieG: 0.7,
        beamRadius: 80,
        ambientFactor: 0.05,
        earthShadow: true,
      },
      0,
    );
    expect(merged.earthShadow).toBe(false);
    expect(merged.density).toBeLessThan(0.08);
  });
});
