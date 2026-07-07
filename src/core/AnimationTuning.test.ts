import { describe, expect, it } from 'vitest';
import {
  ANIMATION_LUMINANCE_TARGETS,
  ANIMATION_MASTER_INTENSITY_DEFAULT,
  formatLuminanceTargetAnnotation,
  resolveEffectiveAnimationTuning,
} from './AnimationTuning.js';
import {
  blendViewTuningProfiles,
  getViewTuningProfile,
  interpolateViewTuningProfiles,
} from './ViewTuningProfile.js';

describe('ANIMATION_LUMINANCE_TARGETS', () => {
  it('documents targets for all 3 patterns across 6 view modes', () => {
    const patterns = ['smile', 'digital_rain', 'heartbeat'] as const;
    for (let mode = 0; mode < 6; mode++) {
      for (const pattern of patterns) {
        const target = ANIMATION_LUMINANCE_TARGETS.find(
          (t) => t.viewModeIndex === mode && t.pattern === pattern,
        );
        expect(target, `missing target for ${pattern} mode ${mode}`).toBeDefined();
        expect(target!.featureLuminance).toBeGreaterThan(target!.backgroundLuminance);
        expect(target!.notes.length).toBeGreaterThan(10);
      }
    }
  });

  it('annotates smile Ground vs God luminance expectations', () => {
    const ground = formatLuminanceTargetAnnotation(3, 'smile');
    const god = formatLuminanceTargetAnnotation(1, 'smile');
    expect(ground).toContain('Ground');
    expect(ground).toContain('2.5');
    expect(god).toContain('God');
    expect(god).toContain('1.9');
  });

  it('annotates digital rain Moon as faint vs Horizon medium', () => {
    const moon = formatLuminanceTargetAnnotation(4, 'digital_rain');
    const horizon = formatLuminanceTargetAnnotation(0, 'digital_rain');
    const moonTarget = ANIMATION_LUMINANCE_TARGETS.find(
      (t) => t.viewModeIndex === 4 && t.pattern === 'digital_rain',
    )!;
    const horizonTarget = ANIMATION_LUMINANCE_TARGETS.find(
      (t) => t.viewModeIndex === 0 && t.pattern === 'digital_rain',
    )!;
    expect(moonTarget.featureLuminance).toBeLessThan(horizonTarget.featureLuminance);
    expect(moon).toContain('Faint');
    expect(horizon).toContain('Medium');
  });

  it('annotates heartbeat Fleet diastole visibility', () => {
    const fleet = formatLuminanceTargetAnnotation(2, 'heartbeat');
    expect(fleet).toContain('Fleet POV');
    expect(fleet).toContain('Diastole');
  });
});

describe('resolveEffectiveAnimationTuning', () => {
  it('multiplies profile intensity by master slider', () => {
    const ground = getViewTuningProfile(3);
    const resolved = resolveEffectiveAnimationTuning(ground, 1.5);
    expect(resolved.animationIntensity).toBeCloseTo(ground.animationIntensity * 1.5);
    expect(resolved.animationContrast).toBe(ground.animationContrast);
  });

  it('defaults master intensity to 1.0', () => {
    const horizon = getViewTuningProfile(0);
    const resolved = resolveEffectiveAnimationTuning(horizon);
    expect(resolved.animationIntensity).toBeCloseTo(horizon.animationIntensity);
  });

  it('clamps master intensity to safe range', () => {
    const horizon = getViewTuningProfile(0);
    const low = resolveEffectiveAnimationTuning(horizon, 0.1);
    const high = resolveEffectiveAnimationTuning(horizon, 5.0);
    expect(low.animationIntensity).toBeGreaterThanOrEqual(0.25);
    expect(high.animationIntensity).toBeLessThanOrEqual(2.5);
  });
});

describe('view profile animation blending', () => {
  it('smoothly blends animation fields during God → Ground transition', () => {
    const god = getViewTuningProfile(1);
    const ground = getViewTuningProfile(3);
    const mid = interpolateViewTuningProfiles(god, ground, 0.5);
    expect(mid.animationIntensity).toBeGreaterThan(god.animationIntensity);
    expect(mid.animationIntensity).toBeLessThan(ground.animationIntensity);
    expect(mid.animationContrast).toBeLessThan(god.animationContrast);
    expect(mid.animationContrast).toBeGreaterThan(ground.animationContrast);
  });

  it('returns endpoint animation values at t=0 and t=1', () => {
    const start = blendViewTuningProfiles(2, 4, 0);
    const end = blendViewTuningProfiles(2, 4, 1);
    expect(start.animationIntensity).toBeCloseTo(getViewTuningProfile(2).animationIntensity);
    expect(end.animationIntensity).toBeCloseTo(getViewTuningProfile(4).animationIntensity);
  });

  it('gives Fleet POV lower contrast than God for heartbeat diastole lift', () => {
    const fleet = getViewTuningProfile(2);
    const god = getViewTuningProfile(1);
    expect(fleet.animationContrast).toBeLessThan(god.animationContrast);
    expect(fleet.animationContrast).toBeLessThan(ANIMATION_MASTER_INTENSITY_DEFAULT);
  });

  it('gives Ground higher animation intensity than God', () => {
    const ground = getViewTuningProfile(3);
    const god = getViewTuningProfile(1);
    expect(ground.animationIntensity).toBeGreaterThan(god.animationIntensity);
  });
});
