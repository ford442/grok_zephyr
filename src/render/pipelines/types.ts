/**
 * Pipeline Types and Interfaces
 */

import type { WebGPUContext } from '@/core/WebGPUContext.js';
import type { SatelliteBufferSet } from '@/core/SatelliteGPUBuffer.js';
import type { DepthOfFieldFocusMode, DepthOfFieldQualitySettings } from '@/core/QualityPresets.js';

/** Render targets for HDR pipeline */
export interface RenderTargets {
  hdr: GPUTexture;
  depth: GPUTexture;
  bloomA: GPUTexture;
  bloomB: GPUTexture;
  motionBlur: GPUTexture;
  dofHalfA: GPUTexture;
  dofHalfB: GPUTexture;
  dofComposite: GPUTexture;
  /** Bloom pyramid mip levels: [0]=1/2, [1]=1/4, [2]=1/8, [3]=1/16, [4]=1/32 */
  bloomMip: GPUTexture[];
  bloomMipViews: GPUTextureView[];
  /** Intermediate target for the composite pass when PostProcessStack is active */
  compositeIntermediate: GPUTexture;

  // Cached views
  hdrView: GPUTextureView;
  depthView: GPUTextureView;
  bloomAView: GPUTextureView;
  bloomBView: GPUTextureView;
  motionBlurView: GPUTextureView;
  dofHalfAView: GPUTextureView;
  dofHalfBView: GPUTextureView;
  dofCompositeView: GPUTextureView;
  compositeIntermediateView: GPUTextureView;
}

/** Pipeline bind groups */
export interface PipelineBindGroups {
  compute: GPUBindGroup;
  beamCompute: GPUBindGroup;
  stars: GPUBindGroup;
  earth: GPUBindGroup;
  atmosphere: GPUBindGroup;
  satellites: GPUBindGroup;
  beam: GPUBindGroup;
  groundTerrain: GPUBindGroup;
  moonForeground: GPUBindGroup;
  moonEarthDisk: GPUBindGroup;
  bloomThreshold: GPUBindGroup;
  composite: GPUBindGroup;
}

/** Maximum number of laser beams */
export const MAX_BEAMS = 65536;

/** All render pipelines */
export interface Pipelines {
  compute: GPUComputePipeline;
  beamCompute: GPUComputePipeline;
  autoExposureHistogram: GPUComputePipeline;
  autoExposureAdapt: GPUComputePipeline;
  stars: GPURenderPipeline;
  earth: GPURenderPipeline;
  atmosphere: GPURenderPipeline;
  satellites: GPURenderPipeline;
  beam: GPURenderPipeline;
  groundTerrain: GPURenderPipeline;
  moonForeground: GPURenderPipeline;
  moonEarthDisk: GPURenderPipeline;
  skyline: GPURenderPipeline;
  bloomThreshold: GPURenderPipeline;
  bloomBlur: GPURenderPipeline;
  bloomDownsample: GPURenderPipeline;
  bloomUpsample: GPURenderPipeline;
  composite: GPURenderPipeline;
  dofDownsample: GPURenderPipeline;
  dofBlurH: GPURenderPipeline;
  dofBlurV: GPURenderPipeline;
  dofComposite: GPURenderPipeline;
  motionBlur: GPURenderPipeline;
}

/** Pipeline creation context */
export interface PipelineContext {
  context: WebGPUContext;
  buffers: SatelliteBufferSet;
  linearSampler: GPUSampler;
}

/** Base pipeline interface (legacy stub modules) */
export interface Pipeline {
  create(context: PipelineContext): GPUComputePipeline | GPURenderPipeline;
  createBindGroup?(
    context: PipelineContext,
    pipeline: GPUPipelineBase,
    ...args: unknown[]
  ): GPUBindGroup;
}

export const MAX_BLOOM_LEVELS = 5;
export const MIN_BLOOM_LEVELS = 2;

export const DOF_FOCUS_MODE: Record<DepthOfFieldFocusMode, number> = {
  'auto-center': 0,
  'satellite-track': 1,
  'surface-distance': 2,
  'earth-center': 3,
};

export const DEFAULT_DOF_CONFIG: DepthOfFieldQualitySettings = {
  enabled: false,
  focusMode: 'auto-center',
  surfaceDistanceKm: 1200,
  maxBlurPx: 0,
  cocScale: 0,
  transitionRate: 3.5,
  depthSigma: 1.5,
};

export type TonemapMode = 0 | 1 | 2 | 3; // 0=ACES, 1=AgX, 2=Reinhard, 3=Uncharted2

export interface AtmosphereScatteringConfig {
  enabled: boolean;
  hazeStrength: number;
}

export interface ExposureSettingsConfig {
  autoEnabled: boolean;
  manualExposure: number;
  adaptationSpeed: number;
  minExposure: number;
  maxExposure: number;
  tonemapMode: TonemapMode;
}

export interface MotionBlurConfig {
  enabled: boolean;
  cameraStrength: number;
  satelliteStretch: number;
  tapCount: number;
}

export const DEFAULT_ATMOSPHERE_SCATTERING: AtmosphereScatteringConfig = {
  enabled: false,
  hazeStrength: 0.28,
};

export const AUTO_EXPOSURE_HISTOGRAM_BINS = 64;

export const DEFAULT_EXPOSURE_SETTINGS: ExposureSettingsConfig = {
  autoEnabled: true,
  manualExposure: 1.0,
  adaptationSpeed: 1.8,
  minExposure: 0.1,
  maxExposure: 10.0,
  tonemapMode: 0,
};

export const DEFAULT_MOTION_BLUR_CONFIG: MotionBlurConfig = {
  enabled: true,
  cameraStrength: 0.75,
  satelliteStretch: 0.6,
  tapCount: 12,
};
