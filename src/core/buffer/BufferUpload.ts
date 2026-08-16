import type { WebGPUContext } from '@/core/WebGPUContext.js';
import { isBufferPair, type SatelliteBufferSet } from './bufferTypes.js';

/**
 * Double-buffered staging for async uploads.
 * Prevents CPU stall on MAP_WRITE buffers.
 */
export class StagingBuffer {
  private buffers: GPUBuffer[] = [];
  private index = 0;

  constructor(
    private device: GPUDevice,
    private size: number,
  ) {
    this.buffers = [this.createStagingBuffer(size, 0), this.createStagingBuffer(size, 1)];
  }

  private createStagingBuffer(size: number, idx: number): GPUBuffer {
    return this.device.createBuffer({
      label: `Staging Buffer ${idx} (${(size / 1024 / 1024).toFixed(1)} MB)`,
      size,
      usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC,
    });
  }

  async upload(data: ArrayBufferLike, targetBuffer: GPUBuffer, commandEncoder: GPUCommandEncoder) {
    const buf = this.buffers[this.index];
    await buf.mapAsync(GPUMapMode.WRITE);
    new Uint8Array(buf.getMappedRange()).set(new Uint8Array(data));
    buf.unmap();

    commandEncoder.copyBufferToBuffer(
      buf,
      0,
      targetBuffer,
      0,
      Math.min(this.size, data.byteLength),
    );
    this.index = 1 - this.index;
  }
}

export async function uploadDynamicSatelliteData(
  staging: StagingBuffer,
  buffers: SatelliteBufferSet,
  data: {
    position?: ArrayBufferLike;
    pattern?: ArrayBufferLike;
    color?: ArrayBufferLike;
  },
  commandEncoder: GPUCommandEncoder,
): Promise<void> {
  if (data.position) {
    const target = isBufferPair(buffers.positions) ? buffers.positions.write : buffers.positions;
    await staging.upload(data.position, target, commandEncoder);
  }
  if (data.pattern) {
    await staging.upload(data.pattern, buffers.patterns, commandEncoder);
  }
  if (data.color) {
    await staging.upload(data.color, buffers.colors, commandEncoder);
  }
}

export function writeBloomUniforms(
  context: WebGPUContext,
  buffers: SatelliteBufferSet,
  width: number,
  height: number,
): void {
  const createData = (horizontal: boolean): ArrayBuffer => {
    const buffer = new ArrayBuffer(32);
    const f32 = new Float32Array(buffer);
    const u32 = new Uint32Array(buffer);
    f32[0] = 1 / width;
    f32[1] = 1 / height;
    u32[2] = horizontal ? 1 : 0;
    u32[3] = 0;
    return buffer;
  };
  context.writeBuffer(buffers.bloomUniforms.horizontal, createData(true));
  context.writeBuffer(buffers.bloomUniforms.vertical, createData(false));
}

export function writeExtendedRange(
  device: GPUDevice,
  dest: GPUBuffer,
  data: Float32Array,
  startSat: number,
  endSat: number,
  floatsPerSat: number,
): void {
  const floatOffset = startSat * floatsPerSat;
  const chunk = data.slice(floatOffset, endSat * floatsPerSat);
  device.queue.writeBuffer(dest, floatOffset * 4, chunk.buffer, chunk.byteOffset, chunk.byteLength);
}
