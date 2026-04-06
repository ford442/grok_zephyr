/**
 * Satellite and Beam Pipelines
 */

import type { Pipeline, PipelineContext } from './types.js';
import { SHADERS } from '@/shaders/index.js';

export class SatellitesPipeline implements Pipeline {
  create({ context }: PipelineContext): GPURenderPipeline {
    const device = context.getDevice();
    
    const shaderModule = device.createShaderModule({
      code: SHADERS.render.satellites,
      label: 'Satellites'
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
            color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }
          }
        }]
      },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less'
      },
      label: 'Satellites Pipeline'
    });
  }
}

export class BeamPipeline implements Pipeline {
  create({ context }: PipelineContext): GPURenderPipeline {
    const device = context.getDevice();
    
    const shaderModule = device.createShaderModule({
      code: SHADERS.render.beam,
      label: 'Beam'
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
            color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }
          }
        }]
      },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'less-equal'
      },
      label: 'Beam Pipeline'
    });
  }
}

export class GroundTerrainPipeline implements Pipeline {
  create({ context }: PipelineContext): GPURenderPipeline {
    const device = context.getDevice();
    
    const shaderModule = device.createShaderModule({
      code: SHADERS.render.ground,
      label: 'Ground Terrain'
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
      label: 'Ground Terrain Pipeline'
    });
  }
}
