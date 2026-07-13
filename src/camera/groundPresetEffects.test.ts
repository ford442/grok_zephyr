import { describe, expect, it } from 'vitest';
import { GROUND_OBSERVER_PRESETS, GroundObserverPreset } from '@/camera/GroundObserverCamera.js';
import {
  blendGroundPresetEffects,
  extractGroundPresetEffects,
  groundPresetMotionBlurWeight,
  GROUND_PRESET_BLEND_SEC,
  kelvinToColorGrading,
  kelvinToRgb,
} from '@/camera/groundPresetEffects.js';

describe('groundPresetEffects', () => {
  it('warms low Kelvin grades and cools high Kelvin grades', () => {
    const warm = kelvinToColorGrading(2700);
    const cool = kelvinToColorGrading(6500);
    expect(warm.gain[0]).toBeGreaterThan(warm.gain[2]);
    expect(cool.gain[2]).toBeGreaterThan(cool.gain[0]);
  });

  it('maps beach vs airplane scatter correctly', () => {
    const beach = extractGroundPresetEffects(
      GROUND_OBSERVER_PRESETS[GroundObserverPreset.BEACH_NIGHT],
    );
    const plane = extractGroundPresetEffects(
      GROUND_OBSERVER_PRESETS[GroundObserverPreset.AIRPLANE_WINDOW],
    );
    expect(beach.atmosphericScatter).toBeGreaterThan(plane.atmosphericScatter);
    expect(beach.colorTemperature).toBeLessThan(plane.colorTemperature);
  });

  it('blends preset fields over 200ms cross-fade', () => {
    const from = extractGroundPresetEffects(
      GROUND_OBSERVER_PRESETS[GroundObserverPreset.HOUSE_WINDOW],
    );
    const to = extractGroundPresetEffects(
      GROUND_OBSERVER_PRESETS[GroundObserverPreset.BEACH_NIGHT],
    );
    const mid = blendGroundPresetEffects(from, to, 0.5);
    expect(mid.colorTemperature).toBeLessThan(from.colorTemperature);
    expect(mid.colorTemperature).toBeGreaterThan(to.colorTemperature);
    expect(mid.atmosphericScatter).toBeCloseTo(
      (from.atmosphericScatter + to.atmosphericScatter) / 2,
      5,
    );
  });

  it('enables car motion blur weight from parallax strength', () => {
    const car = extractGroundPresetEffects(
      GROUND_OBSERVER_PRESETS[GroundObserverPreset.CAR_WINDSHIELD],
    );
    const weight = groundPresetMotionBlurWeight(car);
    expect(weight).toBeDefined();
    expect(weight!).toBeGreaterThan(0.2);
  });

  it('kelvinToRgb is monotonic warm→cool on blue channel', () => {
    const warm = kelvinToRgb(2700);
    const cool = kelvinToRgb(6500);
    expect(cool[2]).toBeGreaterThan(warm[2]);
  });
});

describe('GROUND_PRESET_BLEND_SEC', () => {
  it('matches the 200ms cross-fade requirement', () => {
    expect(GROUND_PRESET_BLEND_SEC).toBe(0.2);
  });
});
