import { describe, expect, it } from 'vitest';
import { WebGPUCompatibilityManager } from '@/ui/WebGPUCompatibilityManager.js';

describe('WebGPUCompatibilityManager results', () => {
  it('offers the opt-in WebGL2 renderer after a WebGPU init failure', () => {
    const result = WebGPUCompatibilityManager.createInitFailureResult(
      'webgpu',
      'No WebGPU adapter found.',
    );
    expect(result.offerWebgl2).toBe(true);
    expect(result.message).toContain('No WebGPU adapter found.');
    expect(result.title).toBeUndefined();
  });

  it('does not offer WebGL2 again when WebGL2 is what failed', () => {
    const result = WebGPUCompatibilityManager.createInitFailureResult('webgl2', 'No context.');
    expect(result.offerWebgl2).toBe(false);
    expect(result.title).toMatch(/WebGL2/);
    expect(result.message).toContain('No context.');
  });
});
