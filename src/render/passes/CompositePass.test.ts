import { describe, expect, it, vi } from 'vitest';
import { encodeCompositePass } from './CompositePass.js';
import type { FrameContext } from './types.js';

function mockEncoder() {
  const pass = {
    setViewport: vi.fn(),
    setScissorRect: vi.fn(),
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    draw: vi.fn(),
    end: vi.fn(),
  };
  const encoder = { beginRenderPass: vi.fn(() => pass) };
  return { encoder: encoder as unknown as GPUCommandEncoder, pass, begin: encoder.beginRenderPass };
}

const swapchainPipeline = { label: 'composite' } as unknown as GPURenderPipeline;
const ctx = {
  width: 1280,
  height: 720,
  pipelines: { composite: swapchainPipeline },
  bindGroups: { composite: {} },
} as unknown as FrameContext;
const view = {} as GPUTextureView;

describe('encodeCompositePass', () => {
  it('clears the whole swapchain attachment by default', () => {
    const { encoder, pass, begin } = mockEncoder();
    encodeCompositePass(encoder, ctx, view, 1280, 720);
    const desc = (begin.mock.calls[0] as unknown as [GPURenderPassDescriptor])[0];
    const color = [...desc.colorAttachments][0]!;
    expect(color.loadOp).toBe('clear');
    expect(pass.setViewport).toHaveBeenCalledWith(0, 0, 1280, 720, 0, 1);
    expect(pass.setScissorRect).not.toHaveBeenCalled();
    expect(pass.setPipeline).toHaveBeenCalledWith(swapchainPipeline);
  });

  it('draws one side-by-side XR eye without clearing the other', () => {
    const { encoder, pass, begin } = mockEncoder();
    const xrPipeline = { label: 'composite-rgba8unorm' } as unknown as GPURenderPipeline;
    encodeCompositePass(encoder, ctx, view, 1832, 1920, undefined, {
      pipeline: xrPipeline,
      viewportX: 1832,
      viewportY: 0,
      preserveOutside: true,
    });
    const desc = (begin.mock.calls[0] as unknown as [GPURenderPassDescriptor])[0];
    expect([...desc.colorAttachments][0]!.loadOp).toBe('load');
    expect(pass.setViewport).toHaveBeenCalledWith(1832, 0, 1832, 1920, 0, 1);
    expect(pass.setScissorRect).toHaveBeenCalledWith(1832, 0, 1832, 1920);
    expect(pass.setPipeline).toHaveBeenCalledWith(xrPipeline);
  });
});
