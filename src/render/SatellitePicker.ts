/**
 * WebGPU satellite picking — 16×16 r32uint readback on demand.
 */

import type { WebGPUContext } from '@/core/WebGPUContext.js';
import type { SatelliteBufferSet } from '@/core/SatelliteGPUBuffer.js';
import { SHADERS } from '@/shaders/index.js';
import { CONSTANTS } from '@/types/constants.js';
import { RENDER } from '@/types/constants.js';

const PICK_SIZE = 16;
const NO_HIT = 0xffffffff;

export class SatellitePicker {
  private pickPipeline: GPURenderPipeline | null = null;
  private pickBindGroupLayout: GPUBindGroupLayout | null = null;
  private pickTexture: GPUTexture | null = null;
  private pickDepth: GPUTexture | null = null;
  private readbackBuffer: GPUBuffer | null = null;
  private pickParamsBuffer: GPUBuffer | null = null;

  constructor(private readonly context: WebGPUContext) {}

  initialize(): void {
    const device = this.context.getDevice();

    this.pickBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      ],
    });

    this.pickTexture = device.createTexture({
      size: [PICK_SIZE, PICK_SIZE, 1],
      format: 'r32uint',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });

    this.pickDepth = device.createTexture({
      size: [PICK_SIZE, PICK_SIZE, 1],
      format: RENDER.DEPTH_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    this.readbackBuffer = device.createBuffer({
      size: PICK_SIZE * PICK_SIZE * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    this.pickParamsBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.pickPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.pickBindGroupLayout],
      }),
      vertex: {
        module: this.context.createShaderModule(SHADERS.render.satellitesPick, 'satellites-pick'),
        entryPoint: 'vs_pick',
      },
      fragment: {
        module: this.context.createShaderModule(SHADERS.render.satellitesPick, 'satellites-pick'),
        entryPoint: 'fs_pick',
        targets: [{ format: 'r32uint' }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: RENDER.DEPTH_FORMAT,
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });
  }

  async pickAt(
    buffers: SatelliteBufferSet,
    satelliteVisualUniformBuffer: GPUBuffer,
    clientX: number,
    clientY: number,
    canvas: HTMLCanvasElement,
  ): Promise<number> {
    if (
      !this.pickPipeline ||
      !this.pickBindGroupLayout ||
      !this.pickTexture ||
      !this.pickDepth ||
      !this.readbackBuffer ||
      !this.pickParamsBuffer
    ) {
      return -1;
    }

    const device = this.context.getDevice();
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);
    const px = (clientX - rect.left) * scaleX;
    const py = (clientY - rect.top) * scaleY;

    const centerNdcX = (px / canvas.width) * 2 - 1;
    const centerNdcY = 1 - (py / canvas.height) * 2;
    const scale = Math.max(canvas.width, canvas.height) / PICK_SIZE;

    const pickParams = new Float32Array([centerNdcX, centerNdcY, scale, 0]);
    device.queue.writeBuffer(this.pickParamsBuffer, 0, pickParams);

    const positionBuffer =
      buffers.positions instanceof GPUBuffer
        ? buffers.positions
        : (buffers.positions as { read: GPUBuffer }).read;

    const bindGroup = device.createBindGroup({
      layout: this.pickBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: buffers.uniforms } },
        { binding: 1, resource: { buffer: positionBuffer } },
        { binding: 2, resource: { buffer: this.pickParamsBuffer } },
        { binding: 3, resource: { buffer: satelliteVisualUniformBuffer } },
      ],
    });

    const encoder = device.createCommandEncoder({ label: 'satellite-pick' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.pickTexture.createView(),
          clearValue: { r: NO_HIT, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: this.pickDepth.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    pass.setPipeline(this.pickPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setViewport(0, 0, PICK_SIZE, PICK_SIZE, 0, 1);
    pass.draw(6, CONSTANTS.NUM_SATELLITES);
    pass.end();

    encoder.copyTextureToBuffer(
      { texture: this.pickTexture },
      { buffer: this.readbackBuffer, bytesPerRow: PICK_SIZE * 4 },
      { width: PICK_SIZE, height: PICK_SIZE },
    );

    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();

    await this.readbackBuffer.mapAsync(GPUMapMode.READ);
    const data = new Uint32Array(this.readbackBuffer.getMappedRange().slice(0));
    this.readbackBuffer.unmap();

    return pickClosestId(data, PICK_SIZE, PICK_SIZE);
  }

  destroy(): void {
    this.pickTexture?.destroy();
    this.pickDepth?.destroy();
    this.readbackBuffer?.destroy();
    this.pickParamsBuffer?.destroy();
    this.pickTexture = null;
    this.pickDepth = null;
    this.readbackBuffer = null;
    this.pickParamsBuffer = null;
    this.pickPipeline = null;
    this.pickBindGroupLayout = null;
  }
}

function pickClosestId(pixels: Uint32Array, width: number, height: number): number {
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  let bestId = -1;
  let bestDist = Number.POSITIVE_INFINITY;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const id = pixels[y * width + x];
      if (id === NO_HIT || id >= CONSTANTS.NUM_SATELLITES) continue;
      const dx = x - cx;
      const dy = y - cy;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        bestId = id;
      }
    }
  }

  return bestId;
}
