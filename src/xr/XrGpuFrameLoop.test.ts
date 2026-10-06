import { afterEach, describe, expect, it, vi } from 'vitest';
import { createXrEyeUniformBuffer, viewportIsPartial } from '@/xr/XrGpuFrameLoop.js';
import { SCENE_UNI_BYTE_SIZE } from '@/shaders/schemas/sceneUni.js';

describe('XrGpuFrameLoop helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('allocates one scene Uni block per eye as a copy source', () => {
    vi.stubGlobal('GPUBufferUsage', { COPY_SRC: 0x4, COPY_DST: 0x8 });
    const createBuffer = vi.fn((d: GPUBufferDescriptor) => d);
    createXrEyeUniformBuffer({ createBuffer } as unknown as GPUDevice);
    const desc = createBuffer.mock.calls[0][0];
    expect(desc.size).toBe(SCENE_UNI_BYTE_SIZE * 2);
    expect(desc.usage).toBe(0x4 | 0x8);
  });

  it('detects side-by-side sub-image viewports vs. one layer per eye', () => {
    const tex = { width: 3664, height: 1920 } as GPUTexture;
    const layerTex = { width: 1832, height: 1920 } as GPUTexture;
    expect(viewportIsPartial({ x: 0, y: 0, width: 1832, height: 1920 }, tex)).toBe(true);
    expect(viewportIsPartial({ x: 1832, y: 0, width: 1832, height: 1920 }, tex)).toBe(true);
    expect(viewportIsPartial({ x: 0, y: 0, width: 1832, height: 1920 }, layerTex)).toBe(false);
  });
});
