import { describe, it, expect, vi } from 'vitest';
import { WebGPUErrorReporter, type WebGPUErrorReport } from '@/core/WebGPUErrorReporter.js';
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

function createMockShaderModule(
  messages: GPUCompilationMessage[],
): GPUShaderModule {
  return {
    getCompilationInfo: vi.fn(async () => ({ messages })),
  } as unknown as GPUShaderModule;
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

  it('throws WebGPUError on shader compilation errors', async () => {
    const reports: WebGPUErrorReport[] = [];
    const reporter = new WebGPUErrorReporter((report) => {
      reports.push(report);
    });
    const module = createMockShaderModule([
      {
        type: 'error',
        message: 'unexpected token',
        lineNum: 12,
        linePos: 4,
        offset: 0,
        length: 1,
      } as GPUCompilationMessage,
    ]);

    await expect(reporter.checkShaderModule(module, 'orbital')).rejects.toBeInstanceOf(WebGPUError);
    expect(reports).toEqual([
      expect.objectContaining({
        kind: 'shader',
        stage: 'shader:orbital',
        message: 'unexpected token',
        detail: ':12:4',
      }),
    ]);
  });

  it('ignores shader compilation warnings', async () => {
    const reports: WebGPUErrorReport[] = [];
    const reporter = new WebGPUErrorReporter((report) => {
      reports.push(report);
    });
    const module = createMockShaderModule([
      {
        type: 'warning',
        message: 'unused variable',
        lineNum: 3,
        linePos: 1,
        offset: 0,
        length: 1,
      } as GPUCompilationMessage,
    ]);

    await expect(reporter.checkShaderModule(module, 'stars')).resolves.toBeUndefined();
    expect(reports).toEqual([]);
  });
});
