/**
 * Post-Process Pipelines (Bloom + Composite)
 */

import type { Pipeline, PipelineContext } from './types.js';
import { SHADERS } from '@/shaders/index.js';

export class BloomThresholdPipeline implements Pipeline {
  create({ context }: PipelineContext): GPURenderPipeline {
    const device = context.getDevice();
    
    const shaderModule = device.createShaderModule({
      code: SHADERS.render.postProcess.bloomThreshold,
      label: 'Bloom Threshold'
    });
    
    return device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vs'
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs',
        targets: [{ format: 'rgba16float' }]
      },
      label: 'Bloom Threshold Pipeline'
    });
  }
}

export class BloomBlurPipeline implements Pipeline {
  create({ context }: PipelineContext): GPURenderPipeline {
    const device = context.getDevice();
    
    const shaderModule = device.createShaderModule({
      code: SHADERS.render.postProcess.bloomBlur,
      label: 'Bloom Blur'
    });
    
    return device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vs'
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs',
        targets: [{ format: 'rgba16float' }]
      },
      label: 'Bloom Blur Pipeline'
    });
  }
}

export class CompositePipeline implements Pipeline {
  create({ context }: PipelineContext): GPURenderPipeline {
    const device = context.getDevice();
    
    const shaderModule = device.createShaderModule({
      code: SHADERS.render.postProcess.composite,
      label: 'Composite'
    });
    
    return device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vs'
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs',
        targets: [{ format: 'bgra8unorm' }]
      },
      label: 'Composite Pipeline'
    });
  }
}
