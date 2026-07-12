/**
 * Render Uniform Buffers — GPU uniform buffer management and writes
 */

import type WebGPUContext from '@/core/WebGPUContext.js';
import type { BloomConfig } from '@/types/animation.js';
import { DEFAULT_BLOOM_CONFIG } from '@/types/animation.js';
import type { ImageTuningSettings } from '@/core/ImageTuning.js';
import { packSatelliteVisualUniform, SHIPPING_IMAGE_TUNING } from '@/core/ImageTuning.js';
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
        size: 16,
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
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'Bloom Composite Uniform',
      });
    }
    this.writeBloomCompositeUni();

    if (!this.tonemapUniformBuffer) {
      this.tonemapUniformBuffer = device.createBuffer({
        size: 16,
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
    device.queue.writeBuffer(this.autoExposureHistogramBuffer, 0, this.autoExposureHistogramClearData);

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
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'Auto Exposure Settings',
      });
    }
    this.writeAutoExposureSettingsUniform(1 / 60);

    this.bloomKawaseBuffers.forEach(b => b.destroy());
    this.bloomKawaseBuffers = [];
    for (let i = 0; i < MAX_BLOOM_LEVELS; i++) {
      const scale = 1 << i;
      const srcW = Math.max(1, Math.floor(width / scale));
      const srcH = Math.max(1, Math.floor(height / scale));

      const buf = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: `Bloom Kawase Uniform L${i}`,
      });
      const data = new Float32Array(4);
      data[0] = 1.0 / srcW;
      data[1] = 1.0 / srcH;
      data[2] = 0.0;
      data[3] = 0.0;
      device.queue.writeBuffer(buf, 0, data);
      this.bloomKawaseBuffers.push(buf);
    }

    if (!this.dofUniformBuffer) {
      this.dofUniformBuffer = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'DoF Uniform',
      });
    }
    this.writeDofUniform();

    if (!this.atmosphereSettingsBuffer) {
      this.atmosphereSettingsBuffer = device.createBuffer({
        size: 16,
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
        size: 160,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'Motion Blur Uniform',
      });
    }
  }

  resetKawaseBuffers(): void {
    this.bloomKawaseBuffers.forEach(b => b.destroy());
    this.bloomKawaseBuffers = [];
    this.motionBlurHistoryReady = false;
  }

  writeBloomThresholdUni(): void {
    if (!this.bloomThresholdUniformBuffer) return;
    const data = new Float32Array(4);
    data[0] = this.bloomConfig.threshold;
    data[1] = this.bloomConfig.knee;
    data[2] = this.imageTuning.enforceFloors ? 1.0 : 0.0;
    data[3] = 0.0;
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
    const ab = new ArrayBuffer(16);
    const f32 = new Float32Array(ab);
    const u32 = new Uint32Array(ab);
    f32[0] = this.bloomConfig.intensity;
    u32[1] = this.bloomConfig.anamorphicEnabled ? 1 : 0;
    f32[2] = this.bloomConfig.anamorphicRatio;
    f32[3] = 0.0;
    this.context.getDevice().queue.writeBuffer(this.bloomCompositeUniformBuffer, 0, ab);
  }

  writeTonemapUniform(): void {
    if (!this.tonemapUniformBuffer) return;
    const ab = new ArrayBuffer(16);
    const f32 = new Float32Array(ab);
    const u32 = new Uint32Array(ab);
    u32[0] = this.exposureSettings.autoEnabled ? 1 : 0;
    u32[1] = this.exposureSettings.tonemapMode;
    f32[2] = this.exposureSettings.manualExposure;
    f32[3] = 0.0;
    this.context.getDevice().queue.writeBuffer(this.tonemapUniformBuffer, 0, ab);
  }

  writeAutoExposureSettingsUniform(deltaTime: number): void {
    if (!this.autoExposureSettingsBuffer) return;
    const clampedDt = Math.max(0.0, Math.min(0.2, deltaTime));
    const ab = new ArrayBuffer(32);
    const f32 = new Float32Array(ab);
    const u32 = new Uint32Array(ab);
    f32[0] = clampedDt;
    f32[1] = this.exposureSettings.adaptationSpeed;
    f32[2] = this.exposureSettings.minExposure;
    f32[3] = this.exposureSettings.maxExposure;
    u32[4] = this.exposureSettings.autoEnabled ? 1 : 0;
    u32[5] = 0;
    u32[6] = 0;
    u32[7] = 0;
    this.context.getDevice().queue.writeBuffer(this.autoExposureSettingsBuffer, 0, ab);
  }

  writeDofUniform(): void {
    if (!this.dofUniformBuffer) return;
    const ab = new ArrayBuffer(32);
    const f32 = new Float32Array(ab);
    const u32 = new Uint32Array(ab);
    f32[0] = Math.max(1, this.dofFocusDistanceKm);
    f32[1] = Math.max(1, this.dofConfig.surfaceDistanceKm);
    f32[2] = Math.max(0, this.dofConfig.maxBlurPx);
    f32[3] = Math.max(0, this.dofConfig.cocScale);
    u32[4] = DOF_FOCUS_MODE[this.dofConfig.focusMode] ?? 0;
    f32[5] = Math.max(0.2, this.dofConfig.depthSigma);
    f32[6] = 10.0;
    f32[7] = 500000.0;
    this.context.getDevice().queue.writeBuffer(this.dofUniformBuffer, 0, ab);
  }

  writeAtmosphereScatteringUniform(): void {
    if (!this.atmosphereSettingsBuffer) return;
    const ab = new ArrayBuffer(16);
    const f32 = new Float32Array(ab);
    const u32 = new Uint32Array(ab);
    u32[0] = this.atmosphereScattering.enabled ? 1 : 0;
    u32[1] = 0;
    f32[2] = this.atmosphereScattering.hazeStrength;
    f32[3] = 0.0;
    this.context.getDevice().queue.writeBuffer(this.atmosphereSettingsBuffer, 0, ab);
  }

  writeGroundViewParams(): void {
    if (!this.groundParamsBuffer) return;
    this.context.getDevice().queue.writeBuffer(
      this.groundParamsBuffer,
      0,
      new Float32Array(this.groundViewParams),
    );
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
    const viewWeight = viewWeightOverride ?? (viewModeScale[viewModeIndex] ?? 0.5);
    const cameraStrength = this.motionBlurConfig.enabled ? this.motionBlurConfig.cameraStrength * viewWeight : 0.0;
    const satelliteStretch = this.motionBlurConfig.enabled ? this.motionBlurConfig.satelliteStretch * viewWeight : 0.0;

    const data = new ArrayBuffer(160);
    const f32 = new Float32Array(data);
    const u32 = new Uint32Array(data);
    f32.set(this.prevViewProjection, 0);
    f32.set(inverseViewProjection, 16);
    f32[32] = cameraStrength;
    f32[33] = satelliteStretch;
    f32[34] = Math.max(0.0, deltaTime);
    u32[35] = this.motionBlurConfig.tapCount;
    if (hostVelocity) {
      f32[36] = hostVelocity[0];
      f32[37] = hostVelocity[1];
      f32[38] = hostVelocity[2];
    }

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
    this.bloomKawaseBuffers.forEach(b => b.destroy());
    this.bloomKawaseBuffers = [];
  }
}
