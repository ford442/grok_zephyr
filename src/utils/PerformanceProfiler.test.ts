import { describe, expect, it, vi } from 'vitest';
import { PerformanceProfiler } from './PerformanceProfiler.js';
import { passTimestampWrites } from '@/render/passes/passTimestamps.js';

vi.stubGlobal('GPUBufferUsage', { QUERY_RESOLVE: 1, COPY_SRC: 2, COPY_DST: 4, MAP_READ: 8 });

function fakeDevice(features: string[]): GPUDevice {
  return {
    features: new Set(features),
    createQuerySet: vi.fn(() => ({ destroy: vi.fn() })),
    createBuffer: vi.fn(() => ({ destroy: vi.fn(), mapState: 'unmapped' })),
  } as unknown as GPUDevice;
}

describe('PerformanceProfiler pass timestamps', () => {
  it('vends consecutive timestampWrites only inside a scope', () => {
    const profiler = new PerformanceProfiler();
    profiler.initialize(fakeDevice(['timestamp-query']));

    expect(passTimestampWrites()).toBeUndefined();
    profiler.beginGPUTimestamp('orbital');
    const a = passTimestampWrites();
    profiler.endGPUTimestamp('orbital');
    profiler.beginGPUTimestamp('bloom');
    const b = passTimestampWrites();
    profiler.endGPUTimestamp('bloom');

    expect(a).toMatchObject({ beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 });
    expect(b).toMatchObject({ beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 });
    expect(passTimestampWrites()).toBeUndefined();

    const encoder = { resolveQuerySet: vi.fn(), copyBufferToBuffer: vi.fn() };
    profiler.resolveTimestamps(encoder as unknown as GPUCommandEncoder);
    expect(encoder.resolveQuerySet).toHaveBeenCalledWith(a!.querySet, 0, 4, expect.anything(), 0);
    profiler.destroy();
  });

  it('vends nothing without timestamp-query', () => {
    const profiler = new PerformanceProfiler();
    profiler.initialize(fakeDevice([]));
    profiler.beginGPUTimestamp('scene');
    expect(passTimestampWrites()).toBeUndefined();
    profiler.endGPUTimestamp('scene');
  });
});
