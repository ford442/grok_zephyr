import { VolumetricBeamRenderer } from '@/render/VolumetricBeamRenderer.js';
import { QUALITY_PRESETS, saveQualityLevel, type QualityLevel } from '@/core/QualityPresets.js';
import { mergeVolumetricBeamConfig } from '@/core/BeamPatternProfile.js';
import { getEffectiveTrailConfig } from '@/app/FrameProfilerEstimates.js';
import { syncTaaToggleUi } from '@/app/GroundObserverUI.js';
import { getDrawableSize } from '@/app/MobilePresentation.js';
import type { AppRuntime } from '@/app/AppRuntime.js';

export function applyQualityPreset(rt: AppRuntime, level: QualityLevel): void {
  const preset = QUALITY_PRESETS[level];
  rt.simulation.currentQualityLevel = level;
  const effectiveTrail = getEffectiveTrailConfig(rt, level);

  if (rt.trailRenderer) {
    rt.trailRenderer.setConfig(effectiveTrail);
  }

  if (rt.earthAtmosphereRenderer) {
    rt.earthAtmosphereRenderer.setConfig({
      enabled: preset.atmosphere.enabled,
      cloudAlpha: preset.atmosphere.cloudAlpha,
      cloudSpeed: preset.atmosphere.cloudSpeed,
      cloudScale: preset.atmosphere.cloudScale,
      hazeStrength: preset.atmosphere.hazeStrength,
    });
  }
  rt.pipeline?.setAtmosphereScatteringConfig(
    preset.atmosphere.scatteringLUT,
    preset.atmosphere.hazeStrength,
  );
  rt.simulation.qualityAtmosphereHaze = preset.atmosphere.hazeStrength;
  rt.simulation.qualityAtmosphereScatteringEnabled = preset.atmosphere.scatteringLUT;

  if (rt.postProcessStack) {
    const taaEnabled = preset.taaEnabled;
    rt.simulation.taaEnabled = taaEnabled;
    rt.postProcessStack.enableTAA(taaEnabled);
    syncTaaToggleUi(rt);
  }

  rt.volumetricBeamQuality = preset.volumetricBeams;
  syncVolumetricBeamConfig(rt);

  rt.pipeline?.setDepthOfFieldConfig(preset.depthOfField);
  rt.pipeline?.setMotionBlurConfig(preset.motionBlur);

  rt.ui.setActiveQualityButton(level);
  rt.ui.setTrailsEnabled(effectiveTrail.enabled);
  rt.ui.setTrailLengthMode(rt.trailLengthMode);
  saveQualityLevel(level);

  console.log(`🎨 Quality preset: ${preset.label} — ${preset.description}`);
}

export function applyVolumetricBeamPreset(
  rt: AppRuntime,
  enabled: boolean,
  config: {
    maxSteps?: number;
    density?: number;
    intensity?: number;
    mieG?: number;
    beamRadius?: number;
    ambientFactor?: number;
    earthShadow?: boolean;
  } = {},
): void {
  if (!enabled) {
    if (rt.volumetricBeamRenderer) {
      rt.volumetricBeamRenderer.destroy();
      rt.volumetricBeamRenderer = null;
      console.log('✨ Volumetric beams: disabled');
    }
    return;
  }

  if (!rt.context || !rt.buffers || !rt.pipeline) return;

  const size = getDrawableSize(rt);
  if (!size) return;

  if (!rt.volumetricBeamRenderer) {
    const buffers = rt.buffers.getBuffers();
    rt.volumetricBeamRenderer = new VolumetricBeamRenderer(
      rt.context,
      buffers.beams,
      buffers.uniforms,
    );
    rt.volumetricBeamRenderer.initialize(size.width, size.height);
    console.log('✨ Volumetric beams: enabled (Cinematic)');
  }

  rt.volumetricBeamRenderer.setConfig(config);
}

export function syncVolumetricBeamConfig(rt: AppRuntime): void {
  if (!rt.volumetricBeamQuality) return;
  const merged = mergeVolumetricBeamConfig(
    rt.volumetricBeamQuality,
    rt.simulation.currentPatternMode,
  );
  applyVolumetricBeamPreset(rt, rt.volumetricBeamQuality.enabled, merged);
}
