import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/FrameLoop.js', () => ({
  startWebGLLoop: vi.fn(),
  startWebGPULoop: vi.fn(),
  stopLoop: vi.fn(),
}));
vi.mock('@/xr/XrGpuFrameLoop.js', () => ({
  createXrEyeUniformBuffer: vi.fn(() => ({ destroy: vi.fn() })),
  onXrGpuFrame: vi.fn(),
}));

import type { AppRuntime } from '@/app/AppRuntime.js';
import { startWebGLLoop, startWebGPULoop, stopLoop } from '@/app/FrameLoop.js';
import { XrSessionManager } from '@/xr/XrSessionManager.js';

type Listener = () => void;

function mockSession() {
  const listeners = new Set<Listener>();
  const session = {
    inputSources: [],
    addEventListener: vi.fn((type: string, cb: Listener) => {
      if (type === 'end') listeners.add(cb);
    }),
    removeEventListener: vi.fn((type: string, cb: Listener) => {
      if (type === 'end') listeners.delete(cb);
    }),
    requestReferenceSpace: vi.fn(() => Promise.resolve({})),
    updateRenderState: vi.fn(() => Promise.resolve()),
    requestAnimationFrame: vi.fn(() => 7),
    cancelAnimationFrame: vi.fn(),
    end: vi.fn(() => {
      for (const cb of [...listeners]) cb();
      return Promise.resolve();
    }),
  };
  return session;
}

const BLOOM = {
  threshold: 1.5,
  knee: 0.5,
  intensity: 1,
  levels: 5,
  anamorphicEnabled: false,
  anamorphicRatio: 0,
};

function gpuRuntime(overrides: Partial<Record<string, unknown>> = {}) {
  const context = {
    isXrCompatible: vi.fn(() => true),
    configureForXr: vi.fn(() =>
      Promise.resolve({ binding: {}, layer: {}, colorFormat: 'rgba8unorm' }),
    ),
    restoreCanvasPresentation: vi.fn(() => Promise.resolve()),
    getDevice: vi.fn(() => ({})),
  };
  const pipeline = {
    getCompositePipelineForFormat: vi.fn(() => Promise.resolve({})),
    getBloomConfig: vi.fn(() => ({ ...BLOOM })),
    setBloomConfig: vi.fn(),
  };
  const handleResize = vi.fn();
  const rt = {
    backend: 'webgpu',
    context,
    pipeline,
    webglRenderer: null,
    handleResize,
    simulation: { groundStations: { active: null }, clock: { simUtcMs: 0 } },
    ...overrides,
  };
  return { rt: rt as unknown as AppRuntime, context, pipeline, handleResize };
}

describe('XrSessionManager', () => {
  let session: ReturnType<typeof mockSession>;
  let requestSession: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    session = mockSession();
    requestSession = vi.fn(() => Promise.resolve(session));
    vi.stubGlobal('navigator', {
      xr: { isSessionSupported: vi.fn(() => Promise.resolve(true)), requestSession },
    });
    vi.stubGlobal('XRGPUBinding', class {});
    vi.stubGlobal('document', { getElementById: () => null });
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('enters VR on WebGPU through XRGPUBinding when the binding exists', async () => {
    const { rt, context, pipeline } = gpuRuntime();
    const xr = new XrSessionManager(rt);
    expect(xr.presentBackend()).toBe('webgpu');

    await xr.enter();

    expect(requestSession).toHaveBeenCalledTimes(1);
    const [mode, init] = requestSession.mock.calls[0] as [string, XRSessionInit];
    expect(mode).toBe('immersive-vr');
    expect(init.requiredFeatures).toContain('webgpu');
    expect(context.configureForXr).toHaveBeenCalledWith(session);
    expect(pipeline.getCompositePipelineForFormat).toHaveBeenCalledWith('rgba8unorm');
    expect(pipeline.setBloomConfig).toHaveBeenCalledWith({ levels: 2 });
    expect(stopLoop).toHaveBeenCalledWith(rt);
    expect(session.requestAnimationFrame).toHaveBeenCalled();
    expect(xr.isActive()).toBe(true);
  });

  it('exit restores the canvas swapchain and mono WebGPU loop without a reload', async () => {
    const { rt, context, pipeline, handleResize } = gpuRuntime();
    const xr = new XrSessionManager(rt);
    await xr.enter();
    await xr.exit();

    expect(session.cancelAnimationFrame).toHaveBeenCalledWith(7);
    expect(pipeline.setBloomConfig).toHaveBeenLastCalledWith(BLOOM);
    await vi.waitFor(() => expect(startWebGPULoop).toHaveBeenCalledWith(rt));
    expect(context.restoreCanvasPresentation).toHaveBeenCalled();
    expect(handleResize).toHaveBeenCalled();
    expect(startWebGLLoop).not.toHaveBeenCalled();
    expect(xr.getPhase()).toBe('idle');
  });

  it('refuses WebGPU VR when XRGPUBinding is missing', async () => {
    vi.stubGlobal('XRGPUBinding', undefined);
    const { rt } = gpuRuntime();
    const xr = new XrSessionManager(rt);
    expect(xr.presentBackend()).toBeNull();
    await expect(xr.enter()).rejects.toThrow(/XRGPUBinding|renderer=webgl/);
    expect(requestSession).not.toHaveBeenCalled();
  });

  it('refuses WebGPU VR when the device is not xrCompatible', () => {
    const { rt, context } = gpuRuntime();
    context.isXrCompatible.mockReturnValue(false);
    expect(new XrSessionManager(rt).presentBackend()).toBeNull();
  });

  it('keeps the WebGL XR path on the WebGL backend', async () => {
    const webgl = {
      makeXRCompatible: vi.fn(() => Promise.resolve()),
      getGL: vi.fn(() => ({})),
      getDebug: vi.fn(() => ({ showBloom: true })),
      setDebug: vi.fn(),
    };
    vi.stubGlobal(
      'XRWebGLLayer',
      class {
        framebuffer = null;
      },
    );
    const { rt, context } = gpuRuntime({ backend: 'webgl', webglRenderer: webgl });
    const xr = new XrSessionManager(rt);
    expect(xr.presentBackend()).toBe('webgl');

    await xr.enter();
    const [, init] = requestSession.mock.calls[0] as [string, XRSessionInit];
    expect(init.requiredFeatures).not.toContain('webgpu');
    expect(context.configureForXr).not.toHaveBeenCalled();
    expect(webgl.setDebug).toHaveBeenCalledWith(expect.objectContaining({ showBloom: false }));

    await xr.exit();
    expect(startWebGLLoop).toHaveBeenCalledWith(rt);
    expect(startWebGPULoop).not.toHaveBeenCalled();
  });

  it('ends a half-built session when entering fails', async () => {
    const { rt, context } = gpuRuntime();
    context.configureForXr.mockRejectedValueOnce(new Error('layer refused'));
    const xr = new XrSessionManager(rt);

    await expect(xr.enter()).rejects.toThrow('layer refused');
    expect(session.end).toHaveBeenCalled();
    expect(stopLoop).not.toHaveBeenCalled();
    expect(xr.getPhase()).toBe('idle');
  });
});
