import { describe, it, expect, vi } from 'vitest';
import { WebGPUErrorReporter } from '@/core/WebGPUErrorReporter.js';
import { WebGPUError } from '@/core/WebGPUContext.js';

function createMockDevice(): GPUDevice {
  const scopes: GPUErrorFilter[] = [];
  return {
    pushErrorScope: vi.fn((filter: GPUErrorFilter) => {
      scopes.push(filter);
    }),
    popErrorScope: vi.fn(() => {
      const filter = scopes.pop();
      if (filter === 'validation') {
        return Promise.resolve({ message: 'mock validation failure' } as GPUError);
      }
      return Promise.resolve(null);
    }),
  } as unknown as GPUDevice;
}

describe('WebGPUErrorReporter', () => {
  it('reports and throws when a validation scope captures an error', async () => {
    const reports: string[] = [];
    const reporter = new WebGPUErrorReporter((report) => {
      reports.push(`${report.kind}:${report.stage}`);
    });
    const device = createMockDevice();

    await expect(
      reporter.withScope(device, 'test-stage', () => {
        return 42;
      }),
    ).rejects.toBeInstanceOf(WebGPUError);

    expect(reports).toEqual(['validation:test-stage']);
  });
});
