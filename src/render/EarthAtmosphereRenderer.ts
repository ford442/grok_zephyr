import type { WebGPUContext } from '@/core/WebGPUContext.js';
import { SHADERS } from '@/shaders/index.js';

export interface GroundViewConfig {
  enabled: boolean;
  cloudSpeed: number;
  cloudAlpha: number;
  cloudScale: number;
  hazeStrength: number;
}

export class EarthAtmosphereRenderer {
  private context: WebGPUContext;
  private config: GroundViewConfig;
  private pipeline: GPURenderPipeline | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private uniformBuffer: GPUBuffer | null = null;

  constructor(context: WebGPUContext, config: Partial<GroundViewConfig> = {}) {
    this.context = context;
    this.config = {
      enabled: true,
      cloudSpeed: 0.02,
      cloudAlpha: 0.4,
      cloudScale: 1.007,
      hazeStrength: 0.28,
      ...config,
    };
  }

  async initialize(uniformBuffer: GPUBuffer): Promise<void> {
    this.uniformBuffer = uniformBuffer;
    await this.createPipeline();
  }

  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * Update atmosphere rendering configuration.
   * Changes take effect on the next rendered frame.
   */
  setConfig(config: Partial<GroundViewConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getEnabled(): boolean {
    return this.config.enabled;
  }

  encode(
    pass: GPURenderPassEncoder,
    earthVertexBuffer: GPUBuffer,
    earthIndexBuffer: GPUBuffer,
    earthIndexCount: number,
  ): void {
    if (!this.config.enabled || !this.pipeline || !this.bindGroup) return;

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, earthVertexBuffer);
    pass.setIndexBuffer(earthIndexBuffer, 'uint32');
    pass.drawIndexed(earthIndexCount);
  }

  private async createPipeline(): Promise<void> {
    const device = this.context.getDevice();

    const layout = device.createPipelineLayout({
      bindGroupLayouts: [
        device.createBindGroupLayout({
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
              buffer: { type: 'uniform' },
            },
          ],
        }),
      ],
    });

    const shaderModule = this.context.createShaderModule(
      SHADERS.render.atmosphereClouds,
      'earth-atmosphere-clouds',
    );
    await this.context.awaitShaderCompilation();

    const vertexLayout: GPUVertexBufferLayout = {
      arrayStride: 24,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' },
      ],
    };

    this.pipeline = await this.context.createRenderPipelineAsync({
      label: 'earth-atmosphere-clouds',
      layout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs',
        buffers: [vertexLayout],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs',
        targets: [
          {
            format: 'rgba16float',
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
        ],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'front',
      },
      depthStencil: {
        format: this.context.getDepthFormat(),
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
      },
    });

    if (!this.uniformBuffer) {
      throw new Error('EarthAtmosphereRenderer requires a shared uniform buffer.');
    }

    this.bindGroup = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
  }

  destroy(): void {
    this.pipeline = null;
    this.bindGroup = null;
    this.uniformBuffer = null;
  }
}
