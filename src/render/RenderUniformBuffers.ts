/**
 * Render Uniform Buffers — GPU uniform buffer management and writes
 */

import type { WebGPUContext } from '@/core/WebGPUContext.js';
import type { BloomConfig } from '@/types/animation.js';
import { DEFAULT_BLOOM_CONFIG } from '@/types/animation.js';
import type { ImageTuningSettings } from '@/core/ImageTuning.js';
import { packSatelliteVisualUniform, SHIPPING_IMAGE_TUNING } from '@/core/ImageTuning.js';
import {
  ATMOSPHERE_SETTINGS_BYTE_SIZE,
  AUTO_EXPOSURE_SETTINGS_BYTE_SIZE,
  BLOOM_COMPOSITE_UNI_BYTE_SIZE,
  DOF_UNI_BYTE_SIZE,
  KAWASE_UNI_BYTE_SIZE,
  MOTION_BLUR_UNI_BYTE_SIZE,
  THRESHOLD_UNI_BYTE_SIZE,
  TONEMAP_UNI_BYTE_SIZE,
  packAtmosphereSettings,
  packAutoExposureSettings,
  packBloomCompositeUni,
  packDofUni,
  packKawaseUni,
  packMotionBlurUni,
  packThresholdUni,
  packTonemapUni,
} from '@/shaders/uniformLayouts.js';
import type { DepthOfFieldQualitySettings } from '@/core/QualityPresets.js';
import {
  AUTO_EXPOSURE_HISTOGRAM_BINS,
  DEFAULT_ATMOSPHERE_SCATTERING,
  DEFAULT_DOF_CONFIG,
  DEFAULT_EXPOSURE_SETTINGS,
  DEFAULT_MOTION_BLUR_CONFIG,
  DOF_FOCUS_MODE,
  MAX_BLOOM_LEVELS,
  type AtmosphereScatteringConfig,
  type ExposureSettingsConfig,
  type MotionBlurConfig,
} from './pipelines/types.js';

export class RenderUniformBuffers {
  private readonly context: WebGPUContext;

  bloomConfig: BloomConfig = { ...DEFAULT_BLOOM_CONFIG };
  imageTuning: ImageTuningSettings = { ...SHIPPING_IMAGE_TUNING };
  dofConfig: DepthOfFieldQualitySettings = { ...DEFAULT_DOF_CONFIG };
  dofFocusDistanceKm = 1000;
  atmosphereScattering: AtmosphereScatteringConfig = { ...DEFAULT_ATMOSPHERE_SCATTERING };
  exposureSettings: ExposureSettingsConfig = { ...DEFAULT_EXPOSURE_SETTINGS };
  motionBlurConfig: MotionBlurConfig = { ...DEFAULT_MOTION_BLUR_CONFIG };
  groundViewParams: [number, number, number, number] = [0, 0.4, 0.6, 1.0];

  readonly prevViewProjection = new Float32Array(16);
  motionBlurHistoryReady = false;
  readonly autoExposureHistogramClearData = new Uint32Array(AUTO_EXPOSURE_HISTOGRAM_BINS);

  bloomThresholdUniformBuffer: GPUBuffer | null = null;
  satelliteVisualUniformBuffer: GPUBuffer | null = null;
  bloomCompositeUniformBuffer: GPUBuffer | null = null;
  tonemapUniformBuffer: GPUBuffer | null = null;
  dofUniformBuffer: GPUBuffer | null = null;
  atmosphereSettingsBuffer: GPUBuffer | null = null;
  groundParamsBuffer: GPUBuffer | null = null;
  motionBlurUniformBuffer: GPUBuffer | null = null;
  autoExposureHistogramBuffer: GPUBuffer | null = null;
  autoExposureStateBuffer: GPUBuffer | null = null;
  autoExposureSettingsBuffer: GPUBuffer | null = null;
  bloomKawaseBuffers: GPUBuffer[] = [];

  constructor(context: WebGPUContext) {
    this.context = context;
  }

  createBuffers(width: number, height: number): void {
    const device = this.context.getDevice();

    if (!this.bloomThresholdUniformBuffer) {
      this.bloomThresholdUniformBuffer = device.createBuffer({
        size: THRESHOLD_UNI_BYTE_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'Bloom Threshold Uniform',
      });
    }
    this.writeBloomThresholdUni();

    if (!this.satelliteVisualUniformBuffer) {
      this.satelliteVisualUniformBuffer = device.createBuffer({
        size: 48,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'Satellite Visual Uniform',
      });
    }
    this.writeSatelliteVisualUni();

    if (!this.bloomCompositeUniformBuffer) {
      this.bloomCompositeUniformBuffer = device.createBuffer({
        size: BLOOM_COMPOSITE_UNI_BYTE_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'Bloom Composite Uniform',
      });
    }
    this.writeBloomCompositeUni();

    if (!this.tonemapUniformBuffer) {
      this.tonemapUniformBuffer = device.createBuffer({
        size: TONEMAP_UNI_BYTE_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'Tonemap Uniform',
      });
    }
    this.writeTonemapUniform();

    if (!this.autoExposureHistogramBuffer) {
      this.autoExposureHistogramBuffer = device.createBuffer({
        size: AUTO_EXPOSURE_HISTOGRAM_BINS * Uint32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        label: 'Auto Exposure Histogram',
      });
    }
    device.queue.writeBuffer(
      this.autoExposureHistogramBuffer,
      0,
      this.autoExposureHistogramClearData,
    );

    if (!this.autoExposureStateBuffer) {
      this.autoExposureStateBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        label: 'Auto Exposure State',
      });
      const exposureSeed = new Float32Array([this.exposureSettings.manualExposure, 0, 0, 0]);
      device.queue.writeBuffer(this.autoExposureStateBuffer, 0, exposureSeed);
    }

    if (!this.autoExposureSettingsBuffer) {
      this.autoExposureSettingsBuffer = device.createBuffer({
        size: AUTO_EXPOSURE_SETTINGS_BYTE_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'Auto Exposure Settings',
      });
    }
    this.writeAutoExposureSettingsUniform(1 / 60);

    this.bloomKawaseBuffers.forEach((b) => b.destroy());
    this.bloomKawaseBuffers = [];
    for (let i = 0; i < MAX_BLOOM_LEVELS; i++) {
      const scale = 1 << i;
      const srcW = Math.max(1, Math.floor(width / scale));
      const srcH = Math.max(1, Math.floor(height / scale));

      const buf = device.createBuffer({
        size: KAWASE_UNI_BYTE_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: `Bloom Kawase Uniform L${i}`,
      });
      device.queue.writeBuffer(buf, 0, packKawaseUni(1.0 / srcW, 1.0 / srcH));
      this.bloomKawaseBuffers.push(buf);
    }

    if (!this.dofUniformBuffer) {
      this.dofUniformBuffer = device.createBuffer({
        size: DOF_UNI_BYTE_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'DoF Uniform',
      });
    }
    this.writeDofUniform();

    if (!this.atmosphereSettingsBuffer) {
      this.atmosphereSettingsBuffer = device.createBuffer({
        size: ATMOSPHERE_SETTINGS_BYTE_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'Atmosphere Scattering Uniform',
      });
    }
    this.writeAtmosphereScatteringUniform();

    if (!this.groundParamsBuffer) {
      this.groundParamsBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'Ground View Params',
      });
      this.writeGroundViewParams();
    }

    if (!this.motionBlurUniformBuffer) {
      this.motionBlurUniformBuffer = device.createBuffer({
        size: MOTION_BLUR_UNI_BYTE_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'Motion Blur Uniform',
      });
    }
  }

  resetKawaseBuffers(): void {
    this.bloomKawaseBuffers.forEach((b) => b.destroy());
    this.bloomKawaseBuffers = [];
    this.motionBlurHistoryReady = false;
  }

  writeBloomThresholdUni(): void {
    if (!this.bloomThresholdUniformBuffer) return;
    const data = packThresholdUni(
      this.bloomConfig.threshold,
      this.bloomConfig.knee,
      this.imageTuning.enforceFloors,
    );
    this.context.getDevice().queue.writeBuffer(this.bloomThresholdUniformBuffer, 0, data);
  }

  writeSatelliteVisualUni(): void {
    if (!this.satelliteVisualUniformBuffer) return;
    const p = packSatelliteVisualUniform(this.imageTuning);
    const data = new Float32Array(12);
    data.set(p);
    this.context.getDevice().queue.writeBuffer(this.satelliteVisualUniformBuffer, 0, data);
  }

  writeBloomCompositeUni(): void {
    if (!this.bloomCompositeUniformBuffer) return;
    const data = packBloomCompositeUni(
      this.bloomConfig.intensity,
      this.bloomConfig.anamorphicEnabled,
      this.bloomConfig.anamorphicRatio,
    );
    this.context.getDevice().queue.writeBuffer(this.bloomCompositeUniformBuffer, 0, data);
  }

  writeTonemapUniform(): void {
    if (!this.tonemapUniformBuffer) return;
    const data = packTonemapUni(
      this.exposureSettings.autoEnabled,
      this.exposureSettings.tonemapMode,
      this.exposureSettings.manualExposure,
    );
    this.context.getDevice().queue.writeBuffer(this.tonemapUniformBuffer, 0, data);
  }

  writeAutoExposureSettingsUniform(deltaTime: number): void {
    if (!this.autoExposureSettingsBuffer) return;
    const clampedDt = Math.max(0.0, Math.min(0.2, deltaTime));
    const data = packAutoExposureSettings(
      clampedDt,
      this.exposureSettings.adaptationSpeed,
      this.exposureSettings.minExposure,
      this.exposureSettings.maxExposure,
      this.exposureSettings.autoEnabled,
    );
    this.context.getDevice().queue.writeBuffer(this.autoExposureSettingsBuffer, 0, data);
  }

  writeDofUniform(): void {
    if (!this.dofUniformBuffer) return;
    const data = packDofUni(
      Math.max(1, this.dofFocusDistanceKm),
      Math.max(1, this.dofConfig.surfaceDistanceKm),
      Math.max(0, this.dofConfig.maxBlurPx),
      Math.max(0, this.dofConfig.cocScale),
      DOF_FOCUS_MODE[this.dofConfig.focusMode] ?? 0,
      Math.max(0.2, this.dofConfig.depthSigma),
    );
    this.context.getDevice().queue.writeBuffer(this.dofUniformBuffer, 0, data);
  }

  writeAtmosphereScatteringUniform(): void {
    if (!this.atmosphereSettingsBuffer) return;
    const data = packAtmosphereSettings(
      this.atmosphereScattering.enabled,
      this.atmosphereScattering.hazeStrength,
    );
    this.context.getDevice().queue.writeBuffer(this.atmosphereSettingsBuffer, 0, data);
  }

  writeGroundViewParams(): void {
    if (!this.groundParamsBuffer) return;
    this.context
      .getDevice()
      .queue.writeBuffer(this.groundParamsBuffer, 0, new Float32Array(this.groundViewParams));
  }

  writeMotionBlurFrameData(
    viewProjection: Float32Array,
    inverseViewProjection: Float32Array,
    viewModeIndex: number,
    deltaTime: number,
    viewWeightOverride?: number,
    hostVelocity?: readonly [number, number, number],
  ): void {
    if (!this.motionBlurUniformBuffer) return;

    if (!this.motionBlurHistoryReady) {
      this.prevViewProjection.set(viewProjection);
      this.motionBlurHistoryReady = true;
    }

    const viewModeScale = [0.55, 0.7, 1.0, 0.08, 0.22, 0.08];
    const viewWeight = viewWeightOverride ?? viewModeScale[viewModeIndex] ?? 0.5;
    const cameraStrength = this.motionBlurConfig.enabled
      ? this.motionBlurConfig.cameraStrength * viewWeight
      : 0.0;
    const satelliteStretch = this.motionBlurConfig.enabled
      ? this.motionBlurConfig.satelliteStretch * viewWeight
      : 0.0;

    const data = packMotionBlurUni(
      this.prevViewProjection,
      inverseViewProjection,
      cameraStrength,
      satelliteStretch,
      Math.max(0.0, deltaTime),
      this.motionBlurConfig.tapCount,
      hostVelocity,
    );

    this.context.getDevice().queue.writeBuffer(this.motionBlurUniformBuffer, 0, data);
    this.prevViewProjection.set(viewProjection);
  }

  destroy(): void {
    this.bloomThresholdUniformBuffer?.destroy();
    this.bloomThresholdUniformBuffer = null;
    this.satelliteVisualUniformBuffer?.destroy();
    this.satelliteVisualUniformBuffer = null;
    this.bloomCompositeUniformBuffer?.destroy();
    this.bloomCompositeUniformBuffer = null;
    this.tonemapUniformBuffer?.destroy();
    this.tonemapUniformBuffer = null;
    this.dofUniformBuffer?.destroy();
    this.dofUniformBuffer = null;
    this.atmosphereSettingsBuffer?.destroy();
    this.atmosphereSettingsBuffer = null;
    this.groundParamsBuffer?.destroy();
    this.groundParamsBuffer = null;
    this.motionBlurUniformBuffer?.destroy();
    this.motionBlurUniformBuffer = null;
    this.autoExposureHistogramBuffer?.destroy();
    this.autoExposureHistogramBuffer = null;
    this.autoExposureStateBuffer?.destroy();
    this.autoExposureStateBuffer = null;
    this.autoExposureSettingsBuffer?.destroy();
    this.autoExposureSettingsBuffer = null;
    this.bloomKawaseBuffers.forEach((b) => b.destroy());
    this.bloomKawaseBuffers = [];
  }
}
