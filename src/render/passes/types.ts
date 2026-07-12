/**
 * Pass encoding context shared across render passes
 */

import type WebGPUContext from '@/core/WebGPUContext.js';
import type { SatelliteBufferSet } from '@/core/SatelliteGPUBuffer.js';
import type { BloomConfig } from '@/types/animation.js';
import type { DepthOfFieldQualitySettings } from '@/core/QualityPresets.js';
import type { ExposureSettingsConfig, MotionBlurConfig, PipelineBindGroups, Pipelines, RenderTargets } from '../pipelines/types.js';
import type { RenderUniformBuffers } from '../RenderUniformBuffers.js';

export interface PassContext {
  context: WebGPUContext;
  buffers: SatelliteBufferSet;
  renderTargets: RenderTargets;
  bindGroups: PipelineBindGroups;
  pipelines: Pipelines;
  uniforms: RenderUniformBuffers;
  width: number;
  height: number;
  linearSampler: GPUSampler;
  bloomConfig: BloomConfig;
  bloomKawaseBuffers: GPUBuffer[];
  exposureSettings: ExposureSettingsConfig;
  motionBlurConfig: MotionBlurConfig;
  dofConfig: DepthOfFieldQualitySettings;
  dofUniformBuffer: GPUBuffer | null;
  autoExposureHistogramBuffer: GPUBuffer | null;
  autoExposureStateBuffer: GPUBuffer | null;
  autoExposureSettingsBuffer: GPUBuffer | null;
  autoExposureHistogramClearData: Uint32Array;
  motionBlurUniformBuffer: GPUBuffer | null;
  bloomThresholdUniformBuffer: GPUBuffer;
  bloomCompositeUniformBuffer: GPUBuffer;
  tonemapUniformBuffer: GPUBuffer;
  groundTerrainEnabled: boolean;
  skylineBindGroup: GPUBindGroup | null;
}
