/**
 * Stars Pipeline - Starfield Background
 */

import type { Pipeline, PipelineContext } from './types.js';
import { SHADERS } from '@/shaders/index.js';

export class StarsPipeline implements Pipeline {
  create({ context }: PipelineContext): GPURenderPipeline {
    const device = context.getDevice();
    
    const shaderModule = device.createShaderModule({
      code: SHADERS.render.stars,
      label: 'Stars'
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
      label: 'Stars Pipeline'
    });
  }
}

export class EarthPipeline implements Pipeline {
  create({ context }: PipelineContext): GPURenderPipeline {
    const device = context.getDevice();
    
    const shaderModule = device.createShaderModule({
      code: SHADERS.render.earth,
      label: 'Earth'
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
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less'
      },
      label: 'Earth Pipeline'
    });
  }
}

export class AtmospherePipeline implements Pipeline {
  create({ context }: PipelineContext): GPURenderPipeline {
    const device = context.getDevice();
    
    const shaderModule = device.createShaderModule({
      code: SHADERS.render.atmosphere,
      label: 'Atmosphere'
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
        targets: [{ 
          format: 'rgba16float',
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
          }
        }]
      },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'less-equal'
      },
      label: 'Atmosphere Pipeline'
    });
  }
}
