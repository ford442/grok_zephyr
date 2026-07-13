import { WebGPUError } from '@/core/WebGPUContext.js';

export type WebGPUErrorKind =
  | 'validation'
  | 'out-of-memory'
  | 'uncaptured'
  | 'shader'
  | 'initialization';

export interface WebGPUErrorReport {
  stage: string;
  kind: WebGPUErrorKind;
  message: string;
  detail?: string;
}

export type WebGPUErrorReportHandler = (report: WebGPUErrorReport) => void;

/**
 * Routes WebGPU validation/OOM scopes, shader compilation, and uncaptured errors
 * into a single structured reporting path.
 */
export class WebGPUErrorReporter {
  constructor(private readonly onReport: WebGPUErrorReportHandler) {}

  report(report: WebGPUErrorReport): void {
    console.error(`[WebGPU:${report.stage}] ${report.message}`);
    this.onReport(report);
  }

  attachUncapturedErrorListener(device: GPUDevice): void {
    device.onuncapturederror = (event: GPUUncapturedErrorEvent) => {
      const err = event.error;
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : 'Unknown GPU error';
      this.report({
        stage: 'runtime',
        kind: 'uncaptured',
        message,
      });
    };
  }

  async withScope<T>(device: GPUDevice, stage: string, fn: () => T | Promise<T>): Promise<T> {
    device.pushErrorScope('out-of-memory');
    device.pushErrorScope('validation');
    try {
      const result = await fn();
      const validationError = await device.popErrorScope();
      const oomError = await device.popErrorScope();
      if (oomError) {
        this.report({ stage, kind: 'out-of-memory', message: oomError.message });
        throw new WebGPUError(`GPU out of memory during ${stage}: ${oomError.message}`);
      }
      if (validationError) {
        this.report({ stage, kind: 'validation', message: validationError.message });
        throw new WebGPUError(`GPU validation failed during ${stage}: ${validationError.message}`);
      }
      return result;
    } catch (error) {
      await this.drainErrorScopes(device);
      throw error;
    }
  }

  async checkShaderModule(module: GPUShaderModule, label: string): Promise<void> {
    const info = await module.getCompilationInfo();
    for (const message of info.messages) {
      if (message.type !== 'error') continue;
      const location = message.lineNum > 0 ? `:${message.lineNum}:${message.linePos}` : '';
      this.report({
        stage: `shader:${label}`,
        kind: 'shader',
        message: message.message,
        detail: location,
      });
      throw new WebGPUError(`Shader compilation failed (${label}${location}): ${message.message}`);
    }
  }

  private async drainErrorScopes(device: GPUDevice): Promise<void> {
    for (let i = 0; i < 2; i++) {
      try {
        await device.popErrorScope();
      } catch {
        break;
      }
    }
  }
}
