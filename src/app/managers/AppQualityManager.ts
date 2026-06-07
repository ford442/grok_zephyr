
import { GrokZephyrApp } from '@/app/GrokZephyrApp.js';
import { type QualityLevel, QUALITY_PRESETS, saveQualityLevel } from '@/core/QualityPresets.js';
import { saveExposureSettings } from '@/app/constants.js';
import { type TrailConfig } from '@/types/animation.js';

export class AppQualityManager {
  constructor(private app: GrokZephyrApp) {}

  public applyQualityPreset(level: QualityLevel): void {
    const preset = QUALITY_PRESETS[level];
    this.app.currentQualityLevel = level;
    const effectiveTrail = this.getEffectiveTrailConfig(level);

    // Apply trail settings
    if (this.app.trailRenderer) {
      if (effectiveTrail.enabled) {
        this.app.trailRenderer.setConfig(effectiveTrail);
        this.app.trailRenderer.enable();
      } else {
        this.app.trailRenderer.disable();
      }
    }

    // Apply earth & atmosphere settings
    if (this.app.earthAtmosphereRenderer) {
      this.app.earthAtmosphereRenderer.setQualityMode(preset.earthQuality);
    }

    // Pass trail fade parameters down through RenderPipeline
    // (Used for Bloom scaling)
    if (this.app.pipeline && effectiveTrail.enabled) {
      this.app.pipeline.setTrailFadeTime(effectiveTrail.fadeTime);
    }

    // Update UI state
    this.app.ui.setQualityPreset(level);
    if (this.app.trailToggleOverride !== null) {
      // (This assumes ui can update trails toggle independently)
    }

    // Save selection
    saveQualityLevel(level);
    console.log(`🎨 Quality preset: ${preset.label} — ${preset.description}`);
  }

  public getEffectiveTrailConfig(level: QualityLevel): TrailConfig {
    const base = QUALITY_PRESETS[level].trailConfig;
    if (this.app.trailToggleOverride !== null) {
      return { ...base, enabled: this.app.trailToggleOverride };
    }
    return base;
  }

  public applyExposureSettings(): void {
    if (!this.app.postProcessStack) return;
    this.app.postProcessStack.setExposureSettings(this.app.exposureSettings);
    saveExposureSettings(this.app.exposureSettings);
  }

}