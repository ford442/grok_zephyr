/**
 * GPU buffers for satellite/beam visibility compaction and indirect draw.
 */

import type { WebGPUContext } from '@/core/WebGPUContext.js';
import { CONSTANTS } from '@/types/constants.js';
import { MAX_BEAMS } from './pipelines/types.js';

const INDIRECT_STRIDE = 16;

export class SatelliteCullBuffers {
  readonly visibleSatIndices: GPUBuffer;
  readonly visibleBeamIndices: GPUBuffer;
  readonly counters: GPUBuffer;
  readonly satDrawIndirect: GPUBuffer;
  readonly beamDrawIndirect: GPUBuffer;
  readonly visibleCountStaging: GPUBuffer;

  private counterClearData = new Uint32Array(2);

  constructor(context: WebGPUContext) {
    const device = context.getDevice();

    this.visibleSatIndices = device.createBuffer({
      label: 'visible-sat-indices',
      size: CONSTANTS.NUM_SATELLITES * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.visibleBeamIndices = device.createBuffer({
      label: 'visible-beam-indices',
      size: MAX_BEAMS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.counters = device.createBuffer({
      label: 'cull-counters',
      size: 8,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });

    this.satDrawIndirect = device.createBuffer({
      label: 'sat-draw-indirect',
      size: INDIRECT_STRIDE,
      usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.beamDrawIndirect = device.createBuffer({
      label: 'beam-draw-indirect',
      size: INDIRECT_STRIDE,
      usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.visibleCountStaging = device.createBuffer({
      label: 'visible-count-staging',
      size: 8,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const satIndirect = new Uint32Array([6, 0, 0, 0]);
    const beamIndirect = new Uint32Array([4, 0, 0, 0]);
    device.queue.writeBuffer(this.satDrawIndirect, 0, satIndirect);
    device.queue.writeBuffer(this.beamDrawIndirect, 0, beamIndirect);
  }

  resetCounters(device: GPUDevice): void {
    this.counterClearData[0] = 0;
    this.counterClearData[1] = 0;
    device.queue.writeBuffer(this.counters, 0, this.counterClearData);
  }

  scheduleVisibleCountReadback(encoder: GPUCommandEncoder): void {
    encoder.copyBufferToBuffer(this.counters, 0, this.visibleCountStaging, 0, 4);
  }

  async readVisibleSatelliteCount(): Promise<number | null> {
    const buffer = this.visibleCountStaging;
    try {
      await buffer.mapAsync(GPUMapMode.READ);
      const count = new Uint32Array(buffer.getMappedRange(), 0, 1)[0];
      buffer.unmap();
      return count;
    } catch {
      try {
        buffer.unmap();
      } catch {
        // ignore double-unmap
      }
      return null;
    }
  }

  destroy(): void {
    this.visibleSatIndices.destroy();
    this.visibleBeamIndices.destroy();
    this.counters.destroy();
    this.satDrawIndirect.destroy();
    this.beamDrawIndirect.destroy();
    this.visibleCountStaging.destroy();
  }
}
