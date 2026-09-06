/**
 * Pipeline factory — layouts + cached shader modules + per-pass create*Async.
 */
import type { WebGPUContext } from '@/core/WebGPUContext.js';
import type { Pipelines } from './types.js';
import { createPipelineLayouts } from './pipelineLayouts.js';
import { createPipelineModules } from './pipelineModules.js';
import { createComputePipelines } from './ComputePipelines.js';
import { createScenePipelines } from './ScenePipelines.js';
import { createPostProcessPipelines } from './PostProcessPipelines.js';

export async function createPipelines(context: WebGPUContext): Promise<Pipelines> {
  const layouts = createPipelineLayouts(context);
  const modules = createPipelineModules(context);
  await context.awaitShaderCompilation();
  const args = { context, layouts, modules };
  const [compute, scene, post] = await Promise.all([
    createComputePipelines(args),
    createScenePipelines(args),
    createPostProcessPipelines(args),
  ]);
  return { ...compute, ...scene, ...post };
}
