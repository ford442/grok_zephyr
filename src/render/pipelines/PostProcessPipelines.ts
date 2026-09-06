import { RENDER } from '@/types/constants.js';
import type { PipelineBuildArgs } from './pipelineLayouts.js';

export async function createPostProcessPipelines({ context, layouts, modules }: PipelineBuildArgs) {
  const surfaceFormat = context.getFormat();
  const [bloomThreshold,
    bloomBlur,
    bloomDownsample,
    bloomUpsample,
    composite,
    dofDownsample,
    dofBlurH,
    dofBlurV,
    dofComposite,
    motionBlur] = await Promise.all([
    context.createRenderPipelineAsync({
      label: 'bloom-threshold',
      layout: layouts.device.createPipelineLayout({ bindGroupLayouts: [layouts.thresholdLayout] }),
      vertex: { module: modules.bloomThreshold, entryPoint: 'vs' },
      fragment: {
        module: modules.bloomThreshold,
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list' },
    }),
    context.createRenderPipelineAsync({
      label: 'bloom-blur',
      layout: layouts.device.createPipelineLayout({ bindGroupLayouts: [layouts.bloomLayout] }),
      vertex: { module: modules.bloomBlur, entryPoint: 'vs' },
      fragment: {
        module: modules.bloomBlur,
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list' },
    }),
    context.createRenderPipelineAsync({
      label: 'bloom-downsample',
      layout: layouts.device.createPipelineLayout({ bindGroupLayouts: [layouts.bloomLayout] }),
      vertex: { module: modules.bloomDownsample, entryPoint: 'vs' },
      fragment: {
        module: modules.bloomDownsample,
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list' },
    }),
    context.createRenderPipelineAsync({
      label: 'bloom-upsample',
      layout: layouts.device.createPipelineLayout({ bindGroupLayouts: [layouts.bloomLayout] }),
      vertex: { module: modules.bloomUpsample, entryPoint: 'vs' },
      fragment: {
        module: modules.bloomUpsample,
        entryPoint: 'fs',
        targets: [
          {
            format: RENDER.HDR_FORMAT,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
    }),
    context.createRenderPipelineAsync({
      label: 'composite',
      layout: layouts.device.createPipelineLayout({ bindGroupLayouts: [layouts.compositeLayout] }),
      vertex: { module: modules.composite, entryPoint: 'vs' },
      fragment: {
        module: modules.composite,
        entryPoint: 'fs',
        targets: [{ format: surfaceFormat }],
      },
      primitive: { topology: 'triangle-list' },
    }),
    context.createRenderPipelineAsync({
      label: 'dof-downsample',
      layout: layouts.device.createPipelineLayout({ bindGroupLayouts: [layouts.dofDownsampleLayout] }),
      vertex: { module: modules.dofDownsample, entryPoint: 'vs' },
      fragment: {
        module: modules.dofDownsample,
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list' },
    }),
    context.createRenderPipelineAsync({
      label: 'dof-blur-h',
      layout: layouts.device.createPipelineLayout({ bindGroupLayouts: [layouts.dofBlurLayout] }),
      vertex: { module: modules.dofBlur, entryPoint: 'vs' },
      fragment: {
        module: modules.dofBlur,
        entryPoint: 'fsHorizontal',
        targets: [{ format: RENDER.HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list' },
    }),
    context.createRenderPipelineAsync({
      label: 'dof-blur-v',
      layout: layouts.device.createPipelineLayout({ bindGroupLayouts: [layouts.dofBlurLayout] }),
      vertex: { module: modules.dofBlur, entryPoint: 'vs' },
      fragment: {
        module: modules.dofBlur,
        entryPoint: 'fsVertical',
        targets: [{ format: RENDER.HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list' },
    }),
    context.createRenderPipelineAsync({
      label: 'dof-composite',
      layout: layouts.device.createPipelineLayout({ bindGroupLayouts: [layouts.dofCompositeLayout] }),
      vertex: { module: modules.dofComposite, entryPoint: 'vs' },
      fragment: {
        module: modules.dofComposite,
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list' },
    }),
    context.createRenderPipelineAsync({
      label: 'motion-blur',
      layout: layouts.device.createPipelineLayout({ bindGroupLayouts: [layouts.motionBlurLayout] }),
      vertex: { module: modules.motionBlur, entryPoint: 'vs' },
      fragment: {
        module: modules.motionBlur,
        entryPoint: 'fs',
        targets: [{ format: 'rgba16float' }],
      },
      primitive: { topology: 'triangle-list' },
    })
  ]);
  return { bloomThreshold, bloomBlur, bloomDownsample, bloomUpsample, composite, dofDownsample, dofBlurH, dofBlurV, dofComposite, motionBlur };
}
