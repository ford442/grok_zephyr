/**
 * Ground observer preset → runtime post-process / atmosphere values.
 */

import type { ColorGrading } from '@/types/animation.js';
import type { GroundObserverConfig } from '@/camera/GroundObserverCamera.js';

/** Cross-fade duration when switching ground presets (seconds). */
export const GROUND_PRESET_BLEND_SEC = 0.2;

/** Resolved per-preset values consumed by the render loop. */
export interface GroundPresetRuntimeEffects {
  colorTemperature: number;
  vignette: number;
  bloomIntensity: number;
  motionBlur: number;
  atmosphericScatter: number;
  parallaxStrength: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Approximate black-body RGB in 0–1 (Tanner Helland curve). */
export function kelvinToRgb(kelvin: number): [number, number, number] {
  const temp = clamp(kelvin, 1000, 40000) / 100;
  let r: number;
  let g: number;
  let b: number;

  if (temp <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(temp) - 161.1195681661;
    b = temp <= 19 ? 0 : 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
    b = 255;
  }

  return [clamp(r / 255, 0, 1), clamp(g / 255, 0, 1), clamp(b / 255, 0, 1)];
}

/** Map color temperature (Kelvin) to lift/gamma/gain for PostProcessStack grading. */
export function kelvinToColorGrading(kelvin: number): Pick<ColorGrading, 'lift' | 'gamma' | 'gain'> {
  const neutral = kelvinToRgb(5500);
  const target = kelvinToRgb(kelvin);
  const gain: [number, number, number] = [
    target[0] / Math.max(neutral[0], 1e-4),
    target[1] / Math.max(neutral[1], 1e-4),
    target[2] / Math.max(neutral[2], 1e-4),
  ];

  const warmth = (kelvin - 5500) / 5500;
  const lift: [number, number, number] = [
    Math.max(0, warmth * 0.045),
    warmth > 0 ? warmth * 0.012 : -warmth * 0.006,
    warmth < 0 ? -warmth * 0.045 : -warmth * 0.01,
  ];
  const gamma: [number, number, number] = [
    warmth > 0 ? 1.0 + warmth * 0.1 : 1.0,
    1.0,
    warmth < 0 ? 1.0 - warmth * 0.08 : 1.0,
  ];

  return { lift, gamma, gain };
}

/** Extract runtime effect fields from a preset config. */
export function extractGroundPresetEffects(config: GroundObserverConfig): GroundPresetRuntimeEffects {
  return {
    colorTemperature: config.effects.colorTemperature ?? 5500,
    vignette: config.effects.vignette ?? 0,
    bloomIntensity: config.effects.bloomIntensity ?? 1.0,
    motionBlur: config.effects.motionBlur ?? 0,
    atmosphericScatter: config.atmosphericScatter,
    parallaxStrength: config.parallax.strength,
  };
}

/** Smoothly blend two resolved preset effect bundles. */
export function blendGroundPresetEffects(
  from: GroundPresetRuntimeEffects,
  to: GroundPresetRuntimeEffects,
  t: number,
): GroundPresetRuntimeEffects {
  const s = clamp(t, 0, 1);
  return {
    colorTemperature: lerp(from.colorTemperature, to.colorTemperature, s),
    vignette: lerp(from.vignette, to.vignette, s),
    bloomIntensity: lerp(from.bloomIntensity, to.bloomIntensity, s),
    motionBlur: lerp(from.motionBlur, to.motionBlur, s),
    atmosphericScatter: lerp(from.atmosphericScatter, to.atmosphericScatter, s),
    parallaxStrength: lerp(from.parallaxStrength, to.parallaxStrength, s),
  };
}

/** Motion-blur view weight override for presets that request directional blur. */
export function groundPresetMotionBlurWeight(effects: GroundPresetRuntimeEffects): number | undefined {
  if (effects.motionBlur <= 0) return undefined;
  return effects.motionBlur * (1 + effects.parallaxStrength * 4);
}
