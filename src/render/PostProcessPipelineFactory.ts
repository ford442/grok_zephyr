/**
 * Post-process pipeline factory — creates render pipelines for the post-process stack.
 */

import type { WebGPUContext } from '@/core/WebGPUContext.js';
import type { PostProcessConfig, TAAConfig } from '@/types/animation.js';
import { TAA_STACK_SHADER as taaStackShader } from '@/shaders/postProcess/taaStack.js';
import { LENS_STACK_SHADER as lensStackShader } from '@/shaders/postProcess/lensStack.js';
import { GRADING_STACK_SHADER as gradingStackShader } from '@/shaders/postProcess/gradingStack.js';
import { GRAIN_STACK_SHADER as grainStackShader } from '@/shaders/postProcess/grainStack.js';
import { SHARPNESS_STACK_SHADER as sharpnessStackShader } from '@/shaders/postProcess/sharpnessStack.js';
import { TONEMAP_STACK_SHADER as tonemapStackShader } from '@/shaders/postProcess/tonemapStack.js';

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
  context: WebGPUContext;
  surfaceFormat: GPUTextureFormat;
  skipFinalTonemap: boolean;
  taaConfig: TAAConfig;
  config: PostProcessConfig;
  isLensEnabled: () => boolean;
}

const HDR_TARGET: GPUColorTargetState = { format: 'rgba16float' };

async function createFullscreenPipeline(
  context: WebGPUContext,
  shaderCode: string,
  label: string,
  target: GPUColorTargetState,
  fragmentEntryPoint = 'fs',
): Promise<GPURenderPipeline> {
  const shader = context.createShaderModule(shaderCode, label);
  await context.awaitShaderCompilation();
  return context.createRenderPipelineAsync({
    label,
    layout: 'auto',
    vertex: { module: shader, entryPoint: 'vs' },
    fragment: { module: shader, entryPoint: fragmentEntryPoint, targets: [target] },
    primitive: { topology: 'triangle-list' },
  });
}

async function createTAAPipeline(
  context: WebGPUContext,
  taaConfig: TAAConfig,
): Promise<PostProcessPass> {
  const pipeline = await createFullscreenPipeline(context, taaStackShader, 'TAA', HDR_TARGET);

  return {
    type: 'taa',
    enabled: taaConfig.enabled,
    pipeline,
    bindGroup: null as unknown as GPUBindGroup,
  };
}

async function createLensPipeline(
  context: WebGPUContext,
  isLensEnabled: () => boolean,
): Promise<PostProcessPass> {
  const pipeline = await createFullscreenPipeline(
    context,
    lensStackShader,
    'LensEffects',
    HDR_TARGET,
  );

  return {
    type: 'lens',
    enabled: isLensEnabled(),
    pipeline,
    bindGroup: null as unknown as GPUBindGroup,
  };
}

async function createGradingPipeline(context: WebGPUContext): Promise<PostProcessPass> {
  const pipeline = await createFullscreenPipeline(
    context,
    gradingStackShader,
    'ColorGrading',
    HDR_TARGET,
  );

  return {
    type: 'grading',
    enabled: true,
    pipeline,
    bindGroup: null as unknown as GPUBindGroup,
  };
}

async function createGrainPipeline(
  context: WebGPUContext,
  config: PostProcessConfig,
): Promise<PostProcessPass> {
  const pipeline = await createFullscreenPipeline(
    context,
    grainStackShader,
    'FilmGrain',
    HDR_TARGET,
  );

  return {
    type: 'grain',
    enabled: config.filmGrain.enabled,
    pipeline,
    bindGroup: null as unknown as GPUBindGroup,
  };
}

async function createSharpnessPipeline(
  context: WebGPUContext,
  config: PostProcessConfig,
): Promise<PostProcessPass> {
  const pipeline = await createFullscreenPipeline(
    context,
    sharpnessStackShader,
    'Sharpness',
    HDR_TARGET,
  );

  return {
    type: 'sharpness',
    enabled: config.sharpness.enabled,
    pipeline,
    bindGroup: null as unknown as GPUBindGroup,
  };
}

async function createTonemapPipeline(
  context: WebGPUContext,
  surfaceFormat: GPUTextureFormat,
  skipFinalTonemap: boolean,
): Promise<PostProcessPass> {
  const pipeline = await createFullscreenPipeline(
    context,
    tonemapStackShader,
    skipFinalTonemap ? 'TonemapPassthrough' : 'TonemapACES',
    { format: surfaceFormat },
    skipFinalTonemap ? 'fs_passthrough' : 'fs',
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
export async function createPostProcessPipelines(
  options: PostProcessPipelineOptions,
): Promise<Map<PassType, PostProcessPass>> {
  const { context, surfaceFormat, skipFinalTonemap, taaConfig, config, isLensEnabled } = options;
  const passes = new Map<PassType, PostProcessPass>();

  const [taa, lens, grading, grain, sharpness, tonemap] = await Promise.all([
    createTAAPipeline(context, taaConfig),
    createLensPipeline(context, isLensEnabled),
    createGradingPipeline(context),
    createGrainPipeline(context, config),
    createSharpnessPipeline(context, config),
    createTonemapPipeline(context, surfaceFormat, skipFinalTonemap),
  ]);
  passes.set('taa', taa);
  passes.set('lens', lens);
  passes.set('grading', grading);
  passes.set('grain', grain);
  passes.set('sharpness', sharpness);
  passes.set('tonemap', tonemap);

  return passes;
}
