/**
 * Post-process pipeline factory — creates render pipelines for the post-process stack.
 */

import type { PostProcessConfig, TAAConfig } from '@/types/animation.js';
import taaStackShader from '@/shaders/postProcess/taaStack.wgsl';
import lensStackShader from '@/shaders/postProcess/lensStack.wgsl';
import gradingStackShader from '@/shaders/postProcess/gradingStack.wgsl';
import grainStackShader from '@/shaders/postProcess/grainStack.wgsl';
import sharpnessStackShader from '@/shaders/postProcess/sharpnessStack.wgsl';
import tonemapStackShader from '@/shaders/postProcess/tonemapStack.wgsl';

/** Post-process pass types */
export type PassType = 'taa' | 'lens' | 'grading' | 'grain' | 'sharpness' | 'tonemap';

/** Post-process pass */
export interface PostProcessPass {
  type: PassType;
  enabled: boolean;
  pipeline: GPURenderPipeline;
  bindGroup: GPUBindGroup;
  target?: GPUTexture;
}

export interface PostProcessPipelineOptions {
  device: GPUDevice;
  surfaceFormat: GPUTextureFormat;
  skipFinalTonemap: boolean;
  taaConfig: TAAConfig;
  config: PostProcessConfig;
  isLensEnabled: () => boolean;
}

const HDR_TARGET: GPUColorTargetState = { format: 'rgba16float' };

function createFullscreenPipeline(
  device: GPUDevice,
  shaderCode: string,
  label: string | undefined,
  target: GPUColorTargetState,
  fragmentEntryPoint = 'fs'
): GPURenderPipeline {
  const shader = device.createShaderModule({
    label,
    code: shaderCode,
  });

  return device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: shader, entryPoint: 'vs' },
    fragment: { module: shader, entryPoint: fragmentEntryPoint, targets: [target] },
    primitive: { topology: 'triangle-list' },
  });
}

function createTAAPipeline(
  device: GPUDevice,
  taaConfig: TAAConfig
): PostProcessPass {
  const pipeline = createFullscreenPipeline(device, taaStackShader, 'TAA', HDR_TARGET);

  return {
    type: 'taa',
    enabled: taaConfig.enabled,
    pipeline,
    bindGroup: null as unknown as GPUBindGroup,
  };
}

function createLensPipeline(
  device: GPUDevice,
  isLensEnabled: () => boolean
): PostProcessPass {
  const pipeline = createFullscreenPipeline(device, lensStackShader, 'LensEffects', HDR_TARGET);

  return {
    type: 'lens',
    enabled: isLensEnabled(),
    pipeline,
    bindGroup: null as unknown as GPUBindGroup,
  };
}

function createGradingPipeline(device: GPUDevice): PostProcessPass {
  const pipeline = createFullscreenPipeline(device, gradingStackShader, 'ColorGrading', HDR_TARGET);

  return {
    type: 'grading',
    enabled: true,
    pipeline,
    bindGroup: null as unknown as GPUBindGroup,
  };
}

function createGrainPipeline(
  device: GPUDevice,
  config: PostProcessConfig
): PostProcessPass {
  const pipeline = createFullscreenPipeline(device, grainStackShader, 'FilmGrain', HDR_TARGET);

  return {
    type: 'grain',
    enabled: config.filmGrain.enabled,
    pipeline,
    bindGroup: null as unknown as GPUBindGroup,
  };
}

function createSharpnessPipeline(
  device: GPUDevice,
  config: PostProcessConfig
): PostProcessPass {
  const pipeline = createFullscreenPipeline(device, sharpnessStackShader, 'Sharpness', HDR_TARGET);

  return {
    type: 'sharpness',
    enabled: config.sharpness.enabled,
    pipeline,
    bindGroup: null as unknown as GPUBindGroup,
  };
}

function createTonemapPipeline(
  device: GPUDevice,
  surfaceFormat: GPUTextureFormat,
  skipFinalTonemap: boolean
): PostProcessPass {
  const pipeline = createFullscreenPipeline(
    device,
    tonemapStackShader,
    skipFinalTonemap ? 'TonemapPassthrough' : 'TonemapACES',
    { format: surfaceFormat },
    skipFinalTonemap ? 'fs_passthrough' : 'fs'
  );

  return {
    type: 'tonemap',
    enabled: true,
    pipeline,
    bindGroup: null as unknown as GPUBindGroup,
  };
}

/**
 * Create all post-process render pipelines.
 */
export function createPostProcessPipelines(
  options: PostProcessPipelineOptions
): Map<PassType, PostProcessPass> {
  const { device, surfaceFormat, skipFinalTonemap, taaConfig, config, isLensEnabled } = options;
  const passes = new Map<PassType, PostProcessPass>();

  passes.set('taa', createTAAPipeline(device, taaConfig));
  passes.set('lens', createLensPipeline(device, isLensEnabled));
  passes.set('grading', createGradingPipeline(device));
  passes.set('grain', createGrainPipeline(device, config));
  passes.set('sharpness', createSharpnessPipeline(device, config));
  passes.set('tonemap', createTonemapPipeline(device, surfaceFormat, skipFinalTonemap));

  return passes;
}
