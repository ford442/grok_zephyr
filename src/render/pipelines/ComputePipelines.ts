import { fleetPipelineConstants } from '@/core/FleetScale.js';
import { RENDER } from '@/types/constants.js';
import type { PipelineBuildArgs } from './pipelineLayouts.js';

export async function createComputePipelines({ context, layouts, modules }: PipelineBuildArgs) {
  const depthFormat = context.getDepthFormat();
  const fleet = fleetPipelineConstants();
  const [compute,
    beamCompute,
    islCompute,
    islFiber,
    conjunctionClear,
    conjunctionBin,
    conjunctionPairs,
    conjunctionDraw,
    conjunctionDensity,
    satelliteCullSats,
    satelliteCullBeams,
    satelliteCullFinalize,
    autoExposureHistogram,
    autoExposureAdapt] = await Promise.all([
    context.createComputePipelineAsync({
      label: 'orbital',
      layout: layouts.computeLayout,
      compute: { module: modules.orbital, entryPoint: 'main', constants: fleet },
    }),
    context.createComputePipelineAsync({
      label: 'beam-compute',
      layout: layouts.beamComputeLayout,
      compute: { module: modules.beamCompute, entryPoint: 'main', constants: fleet },
    }),
    context.createComputePipelineAsync({
      label: 'isl-compute',
      layout: layouts.islComputeLayout,
      compute: { module: modules.islCompute, entryPoint: 'main', constants: fleet },
    }),
    context.createRenderPipelineAsync({
      label: 'isl-fiber',
      layout: layouts.islFiberLayout,
      vertex: { module: modules.islFiber, entryPoint: 'vs' },
      fragment: {
        module: modules.islFiber,
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT, blend: layouts.additiveBlend }],
      },
      primitive: { topology: 'triangle-strip' },
      depthStencil: {
        format: depthFormat,
        depthWriteEnabled: false,
        depthCompare: 'less',
      },
    }),
    context.createComputePipelineAsync({
      label: 'conjunction-clear',
      layout: layouts.conjunctionComputeLayout,
      compute: { module: modules.conjunctionCompute, entryPoint: 'clear_bins' },
    }),
    context.createComputePipelineAsync({
      label: 'conjunction-bin',
      layout: layouts.conjunctionComputeLayout,
      compute: { module: modules.conjunctionCompute, entryPoint: 'bin_sats' },
    }),
    context.createComputePipelineAsync({
      label: 'conjunction-pairs',
      layout: layouts.conjunctionComputeLayout,
      compute: { module: modules.conjunctionCompute, entryPoint: 'find_pairs' },
    }),
    context.createRenderPipelineAsync({
      label: 'conjunction-draw',
      layout: layouts.conjunctionDrawLayout,
      vertex: { module: modules.conjunctionDraw, entryPoint: 'vs' },
      fragment: {
        module: modules.conjunctionDraw,
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT, blend: layouts.additiveBlend }],
      },
      primitive: { topology: 'triangle-strip' },
      depthStencil: {
        format: depthFormat,
        depthWriteEnabled: false,
        depthCompare: 'less',
      },
    }),
    context.createRenderPipelineAsync({
      label: 'conjunction-density',
      layout: layouts.conjunctionDensityLayout,
      vertex: { module: modules.conjunctionDensity, entryPoint: 'vs' },
      fragment: {
        module: modules.conjunctionDensity,
        entryPoint: 'fs',
        targets: [{ format: RENDER.HDR_FORMAT, blend: layouts.additiveBlend }],
      },
      primitive: { topology: 'triangle-strip' },
      depthStencil: {
        format: depthFormat,
        depthWriteEnabled: false,
        depthCompare: 'less',
      },
    }),
    context.createComputePipelineAsync({
      label: 'satellite-cull-sats',
      layout: layouts.device.createPipelineLayout({ bindGroupLayouts: [layouts.satelliteCullLayout] }),
      compute: { module: modules.satelliteCull, entryPoint: 'cull_satellites', constants: fleet },
    }),
    context.createComputePipelineAsync({
      label: 'satellite-cull-beams',
      layout: layouts.device.createPipelineLayout({ bindGroupLayouts: [layouts.satelliteCullLayout] }),
      compute: { module: modules.satelliteCull, entryPoint: 'cull_beams', constants: fleet },
    }),
    context.createComputePipelineAsync({
      label: 'satellite-cull-finalize',
      layout: layouts.device.createPipelineLayout({ bindGroupLayouts: [layouts.satelliteCullLayout] }),
      compute: { module: modules.satelliteCull, entryPoint: 'finalize_indirect', constants: fleet },
    }),
    context.createComputePipelineAsync({
      label: 'auto-exposure-histogram',
      layout: layouts.device.createPipelineLayout({ bindGroupLayouts: [layouts.autoExposureHistogramLayout] }),
      compute: { module: modules.autoExposureHistogram, entryPoint: 'main' },
    }),
    context.createComputePipelineAsync({
      label: 'auto-exposure-adapt',
      layout: layouts.device.createPipelineLayout({ bindGroupLayouts: [layouts.autoExposureAdaptLayout] }),
      compute: { module: modules.autoExposureAdapt, entryPoint: 'main' },
    })
  ]);
  return { compute, beamCompute, islCompute, islFiber, conjunctionClear, conjunctionBin, conjunctionPairs, conjunctionDraw, conjunctionDensity, satelliteCullSats, satelliteCullBeams, satelliteCullFinalize, autoExposureHistogram, autoExposureAdapt };
}
