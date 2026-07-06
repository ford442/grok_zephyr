import { describe, expect, it } from 'vitest';
import {
  VIEW_TUNING_PROFILES,
  SKYLINE_EMISSIVE_CORE_REF,
  blendViewTuningProfiles,
  formatTuningProfileLabel,
  getViewTuningProfile,
  interpolateViewTuningProfiles,
  resolveViewTuning,
  skylineEmissiveScale,
} from './ViewTuningProfile.js';

describe('VIEW_TUNING_PROFILES', () => {
  it('defines a documented profile for each of the 6 view modes', () => {
    expect(VIEW_TUNING_PROFILES).toHaveLength(6);
    for (let i = 0; i < 6; i++) {
      const profile = getViewTuningProfile(i);
      expect(profile.viewModeIndex).toBe(i);
      expect(profile.shortName.length).toBeGreaterThan(0);
      expect(profile.rationale.length).toBeGreaterThan(20);
      expect(profile.bloomThreshold).toBeGreaterThan(0);
      expect(profile.distanceCullKm).toBeGreaterThan(10_000);
    }
  });

  it('gives God View a tighter kernel than Ground View', () => {
    const god = getViewTuningProfile(1);
    const ground = getViewTuningProfile(3);
    expect(god.satCoreOuter).toBeLessThan(ground.satCoreOuter);
    expect(god.bloomThreshold).toBeLessThan(ground.bloomThreshold);
  });

  it('gives Fleet POV the tightest kernel to resist streak soup', () => {
    const fleet = getViewTuningProfile(2);
    const god = getViewTuningProfile(1);
    expect(fleet.satCoreInner).toBeLessThan(god.satCoreInner);
    expect(fleet.haloStrength).toBeLessThan(god.haloStrength);
    expect(fleet.bloomThreshold).toBeGreaterThan(god.bloomThreshold);
  });

  it('extends Moon View cull distance beyond the default shell', () => {
    const moon = getViewTuningProfile(4);
    const horizon = getViewTuningProfile(0);
    expect(moon.distanceCullKm).toBeGreaterThan(horizon.distanceCullKm);
    expect(moon.bloomThreshold).toBeLessThan(horizon.bloomThreshold);
  });

  it('gives Skyline lower bloom threshold than Ground for window emissives', () => {
    const skyline = getViewTuningProfile(5);
    const ground = getViewTuningProfile(3);
    expect(skyline.shortName).toBe('Skyline');
    expect(skyline.bloomThreshold).toBeLessThan(ground.bloomThreshold);
    expect(skyline.coreBoost).toBeGreaterThan(ground.coreBoost);
  });

  it('clamps out-of-range indices to the nearest profile', () => {
    expect(getViewTuningProfile(99).shortName).toBe('Skyline');
    expect(getViewTuningProfile(-1).shortName).toBe('Horizon');
  });
});

describe('profile interpolation', () => {
  it('smoothly blends numeric fields between profiles', () => {
    const god = getViewTuningProfile(1);
    const ground = getViewTuningProfile(3);
    const mid = interpolateViewTuningProfiles(god, ground, 0.5);
    expect(mid.bloomThreshold).toBeGreaterThan(god.bloomThreshold);
    expect(mid.bloomThreshold).toBeLessThan(ground.bloomThreshold);
    expect(mid.bloomIntensity).toBeGreaterThan(ground.bloomIntensity);
    expect(mid.bloomIntensity).toBeLessThan(god.bloomIntensity);
  });

  it('returns endpoints at t=0 and t=1', () => {
    const blendedStart = blendViewTuningProfiles(1, 3, 0);
    const blendedEnd = blendViewTuningProfiles(1, 3, 1);
    expect(blendedStart.shortName).toBe('God');
    expect(blendedEnd.shortName).toBe('Ground');
  });

  it('formats transition labels for the HUD', () => {
    expect(formatTuningProfileLabel(1, 3, 0)).toBe('God');
    expect(formatTuningProfileLabel(1, 3, 1)).toBe('Ground');
    expect(formatTuningProfileLabel(1, 3, 0.5)).toBe('God → Ground');
  });

  it('resolveViewTuning maps profiles into ImageTuningSettings', () => {
    const resolved = resolveViewTuning(4, 4, 1);
    expect(resolved.profileLabel).toBe('Moon');
    expect(resolved.settings.distanceCullKm).toBe(500_000);
    expect(resolved.settings.haloStrength).toBeCloseTo(0.28);
  });

  it('blends Ground and Skyline profiles during surface mode transitions', () => {
    const mid = blendViewTuningProfiles(3, 5, 0.5);
    const ground = getViewTuningProfile(3);
    const skyline = getViewTuningProfile(5);
    expect(mid.bloomThreshold).toBeGreaterThan(skyline.bloomThreshold);
    expect(mid.bloomThreshold).toBeLessThan(ground.bloomThreshold);
    expect(formatTuningProfileLabel(3, 5, 0.5)).toBe('Ground → Skyline');
  });

  it('derives skyline window emissive scale from coreBoost', () => {
    const skyline = getViewTuningProfile(5);
    expect(skylineEmissiveScale(skyline.coreBoost)).toBeCloseTo(skyline.coreBoost / SKYLINE_EMISSIVE_CORE_REF);
  });
});
