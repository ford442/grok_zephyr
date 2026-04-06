/**
 * Compute Pipeline - Orbital Position Calculation
 */

import type { Pipeline, PipelineContext } from './types.js';
import { SHADERS } from '@/shaders/index.js';

export class OrbitalComputePipeline implements Pipeline {
  create({ context }: PipelineContext): GPUComputePipeline {
    const device = context.getDevice();
    
    const shaderModule = device.createShaderModule({
      code: SHADERS.compute.orbital,
      label: 'Orbital Compute'
    });
    
    return device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: shaderModule,
        entryPoint: 'main'
      },
      label: 'Orbital Compute Pipeline'
    });
  }
}

export class BeamComputePipeline implements Pipeline {
  create({ context }: PipelineContext): GPUComputePipeline {
    const device = context.getDevice();
    
    const shaderModule = device.createShaderModule({
      code: SHADERS.compute.beam,
      label: 'Beam Compute'
    });
    
    return device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: shaderModule,
        entryPoint: 'main'
      },
      label: 'Beam Compute Pipeline'
    });
  }
}
