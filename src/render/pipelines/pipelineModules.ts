/**
 * One GPUShaderModule per WGSL source (WebGPUContext already caches by code).
 */
import type { WebGPUContext } from '@/core/WebGPUContext.js';
import { SHADERS } from '@/shaders/index.js';
import { buildBloomDownsample } from '@/shaders/render/postProcess/bloomDownsample.js';

export interface PipelineShaderModules {
  satelliteCull: GPUShaderModule;
  orbital: GPUShaderModule;
  beamCompute: GPUShaderModule;
  islCompute: GPUShaderModule;
  islFiber: GPUShaderModule;
  conjunctionCompute: GPUShaderModule;
  conjunctionDraw: GPUShaderModule;
  conjunctionDensity: GPUShaderModule;
  autoExposureHistogram: GPUShaderModule;
  autoExposureAdapt: GPUShaderModule;
  stars: GPUShaderModule;
  earth: GPUShaderModule;
  atmosphere: GPUShaderModule;
  satellites: GPUShaderModule;
  satellitesCulled: GPUShaderModule;
  beam: GPUShaderModule;
  beamCulled: GPUShaderModule;
  ground: GPUShaderModule;
  moonForeground: GPUShaderModule;
  moonEarthDisk: GPUShaderModule;
  skyline: GPUShaderModule;
  bloomThreshold: GPUShaderModule;
  bloomBlur: GPUShaderModule;
  bloomDownsample: GPUShaderModule;
  bloomUpsample: GPUShaderModule;
  composite: GPUShaderModule;
  dofDownsample: GPUShaderModule;
  dofBlur: GPUShaderModule;
  dofComposite: GPUShaderModule;
  motionBlur: GPUShaderModule;
}

export function createPipelineModules(context: WebGPUContext): PipelineShaderModules {
  const shader = (code: string, label: string): GPUShaderModule =>
    context.createShaderModule(code, label);

  return {
    satelliteCull: shader(SHADERS.compute.satelliteCull, 'satellite-cull'),
    orbital: shader(SHADERS.compute.orbital, 'orbital'),
    beamCompute: shader(SHADERS.compute.beam, 'beam-compute'),
    islCompute: shader(SHADERS.compute.isl, 'isl-compute'),
    islFiber: shader(SHADERS.render.isl, 'isl-fiber'),
    conjunctionCompute: shader(SHADERS.compute.conjunction, 'conjunction-compute'),
    conjunctionDraw: shader(SHADERS.render.conjunction, 'conjunction-draw'),
    conjunctionDensity: shader(SHADERS.render.conjunctionDensity, 'conjunction-density'),
    autoExposureHistogram: shader(
      SHADERS.render.postProcess.autoExposureHistogram,
      'auto-exposure-histogram',
    ),
    autoExposureAdapt: shader(
      SHADERS.render.postProcess.autoExposureAdapt,
      'auto-exposure-adapt',
    ),
    stars: shader(SHADERS.render.stars, 'stars'),
    earth: shader(SHADERS.render.earth, 'earth'),
    atmosphere: shader(SHADERS.render.atmosphere, 'atmosphere'),
    satellites: shader(SHADERS.render.satellites, 'satellites'),
    satellitesCulled: shader(SHADERS.render.satellitesCulled, 'satellites-culled'),
    beam: shader(SHADERS.render.beam, 'beam-render'),
    beamCulled: shader(SHADERS.render.beamCulled, 'beam-culled'),
    ground: shader(SHADERS.render.ground, 'ground-terrain'),
    moonForeground: shader(SHADERS.render.moonForeground, 'moon-foreground'),
    moonEarthDisk: shader(SHADERS.render.moonEarthDisk, 'moon-earth-disk'),
    skyline: shader(SHADERS.render.skyline, 'skyline-city'),
    bloomThreshold: shader(SHADERS.render.postProcess.bloomThreshold, 'bloom-threshold'),
    bloomBlur: shader(SHADERS.render.postProcess.bloomBlur, 'bloom-blur'),
    bloomDownsample: shader(
      buildBloomDownsample(context.getCapabilities()?.shaderF16Bloom ?? false),
      'bloom-downsample',
    ),
    bloomUpsample: shader(SHADERS.render.postProcess.bloomUpsample, 'bloom-upsample'),
    composite: shader(SHADERS.render.postProcess.composite, 'composite'),
    dofDownsample: shader(SHADERS.render.postProcess.dofDownsample, 'dof-downsample'),
    dofBlur: shader(SHADERS.render.postProcess.dofBlur, 'dof-blur'),
    dofComposite: shader(SHADERS.render.postProcess.dofComposite, 'dof-composite'),
    motionBlur: shader(SHADERS.render.postProcess.motionBlur, 'motion-blur'),
  };
}
