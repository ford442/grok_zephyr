/**
 * WebXR session lifecycle for Grok Zephyr.
 * Stage 3: WebGPU frame graph via `XRGPUBinding` when the UA has it.
 * Stage 2: WebGL2 + `XRWebGLLayer` on the WebGL backend.
 */

import type { AppRuntime } from '@/app/AppRuntime.js';
import { startWebGLLoop, startWebGPULoop, stopLoop } from '@/app/FrameLoop.js';
import {
  getXrSystem,
  hasXrGpuBinding,
  resolveXrBackend,
  type XrPresentBackend,
} from '@/xr/XrSupport.js';
import {
  createXrEyeUniformBuffer,
  onXrGpuFrame,
  type XrGpuSessionResources,
} from '@/xr/XrGpuFrameLoop.js';
import {
  bindXrKeyboard,
  createXrFrameLoopState,
  onXrFrame,
  unbindXrKeyboard,
  type XrFrameLoopState,
} from '@/xr/XrFrameLoop.js';
import {
  applyXrQuality,
  applyXrQualityGpu,
  restoreXrQuality,
  restoreXrQualityGpu,
  type XrQualitySnapshot,
} from '@/xr/XrQuality.js';

export type XrSessionPhase = 'idle' | 'starting' | 'active' | 'ending';

export class XrSessionManager {
  private session: XRSession | null = null;
  private refSpace: XRReferenceSpace | null = null;
  private layer: XRWebGLLayer | null = null;
  private gpu: XrGpuSessionResources | null = null;
  private activeBackend: XrPresentBackend | null = null;
  private phase: XrSessionPhase = 'idle';
  private frameState: XrFrameLoopState | null = null;
  private qualitySnapshot: XrQualitySnapshot | null = null;
  private keyHandler: ((ev: KeyboardEvent) => void) | null = null;
  private hiddenEls: { el: HTMLElement; prev: string }[] = [];
  private onPhaseChange: ((phase: XrSessionPhase) => void) | null = null;
  private readonly onSessionEnd = (): void => {
    this.handleSessionEnded();
  };

  constructor(private readonly rt: AppRuntime) {}

  getPhase(): XrSessionPhase {
    return this.phase;
  }

  isActive(): boolean {
    return this.phase === 'active';
  }

  setPhaseChangeListener(cb: ((phase: XrSessionPhase) => void) | null): void {
    this.onPhaseChange = cb;
  }

  private setPhase(phase: XrSessionPhase): void {
    this.phase = phase;
    this.onPhaseChange?.(phase);
  }

  /** Which backend would present if the user pressed Enter VR now. */
  presentBackend(): XrPresentBackend | null {
    const gpuReady =
      this.rt.backend === 'webgpu' &&
      hasXrGpuBinding() &&
      (this.rt.context?.isXrCompatible() ?? false);
    const resolved = resolveXrBackend(this.rt.backend, gpuReady);
    if (resolved === 'webgl' && !this.rt.webglRenderer) return null;
    return resolved;
  }

  async enter(): Promise<void> {
    if (this.phase !== 'idle') return;
    const backend = this.presentBackend();
    if (!backend) {
      throw new Error(
        'VR needs the WebXR WebGPU binding (XRGPUBinding) or the WebGL renderer (?renderer=webgl).',
      );
    }

    const xr = getXrSystem();
    if (!xr) {
      throw new Error('WebXR is not available in this browser.');
    }

    this.setPhase('starting');
    let session: XRSession | null = null;
    try {
      session = await this.requestImmersiveSession(xr, backend);
      this.session = session;
      session.addEventListener('end', this.onSessionEnd);

      if (backend === 'webgpu') {
        await this.attachGpuLayer(session);
      } else {
        await this.attachWebGLLayer(session);
      }

      try {
        this.refSpace = await session.requestReferenceSpace('local-floor');
      } catch {
        this.refSpace = await session.requestReferenceSpace('local');
      }

      this.qualitySnapshot =
        backend === 'webgpu'
          ? applyXrQualityGpu(this.rt.pipeline)
          : applyXrQuality(this.rt.webglRenderer);
      this.activeBackend = backend;
      this.hideDesktopChrome();
      stopLoop(this.rt);

      this.frameState = createXrFrameLoopState('horizon-720');
      this.keyHandler = bindXrKeyboard(this.rt, this.frameState);

      this.setPhase('active');
      this.scheduleFrame();
      console.log(
        `[XR] Immersive VR session started (${backend === 'webgpu' ? 'WebGPU XRGPUBinding' : 'WebGL'} stereo).`,
      );
    } catch (err) {
      if (session) {
        // A half-built session would otherwise stay presenting a blank layer.
        session.removeEventListener('end', this.onSessionEnd);
        void session.end().catch(() => undefined);
      }
      this.gpu?.eyeUniforms.destroy();
      this.gpu = null;
      this.activeBackend = null;
      this.session = null;
      this.layer = null;
      this.refSpace = null;
      this.setPhase('idle');
      throw err;
    }
  }

  private async requestImmersiveSession(
    xr: NonNullable<ReturnType<typeof getXrSystem>>,
    backend: XrPresentBackend,
  ): Promise<XRSession> {
    // WebGPU sessions must opt in to the binding ('webgpu') and composition layers.
    const gpuFeatures = backend === 'webgpu' ? ['webgpu'] : [];
    const gpuOptional = backend === 'webgpu' ? ['layers'] : [];
    try {
      return await xr.requestSession('immersive-vr', {
        requiredFeatures: [...gpuFeatures, 'local-floor'],
        optionalFeatures: gpuOptional,
      });
    } catch {
      return await xr.requestSession('immersive-vr', {
        requiredFeatures: [...gpuFeatures, 'local'],
        optionalFeatures: gpuOptional,
      });
    }
  }

  private async attachWebGLLayer(session: XRSession): Promise<void> {
    const webgl = this.rt.webglRenderer!;
    await webgl.makeXRCompatible();
    const gl = webgl.getGL();
    // XRWebGLLayer is a browser global when WebXR is available.
    const XRLayerCtor = (
      globalThis as unknown as { XRWebGLLayer: typeof XRWebGLLayer }
    ).XRWebGLLayer;
    this.layer = new XRLayerCtor(session, gl, {
      antialias: false,
      depth: true,
      stencil: false,
      alpha: false,
      framebufferScaleFactor: 0.85,
    });
    await session.updateRenderState({ baseLayer: this.layer });
  }

  private async attachGpuLayer(session: XRSession): Promise<void> {
    const context = this.rt.context;
    const pipeline = this.rt.pipeline;
    if (!context || !pipeline) {
      throw new Error('WebGPU renderer is not initialized.');
    }
    const presentation = await context.configureForXr(session);
    const compositePipeline = await pipeline.getCompositePipelineForFormat(
      presentation.colorFormat,
    );
    this.gpu = {
      presentation,
      compositePipeline,
      eyeUniforms: createXrEyeUniformBuffer(context.getDevice()),
    };
  }

  async exit(): Promise<void> {
    if (!this.session || this.phase === 'idle' || this.phase === 'ending') return;
    this.setPhase('ending');
    try {
      await this.session.end();
    } catch {
      this.handleSessionEnded();
    }
  }

  private scheduleFrame(): void {
    const session = this.session;
    const refSpace = this.refSpace;
    const frameState = this.frameState;
    if (!session || !refSpace || !frameState) return;
    const gpu = this.gpu;
    const layer = this.layer;
    if (!gpu && !layer) return;

    frameState.rafHandle = session.requestAnimationFrame((time, frame) => {
      if (this.phase !== 'active' || !this.session) return;
      if (gpu) {
        onXrGpuFrame(this.rt, frameState, session, time, frame, refSpace, gpu);
      } else if (layer) {
        onXrFrame(this.rt, frameState, session, time, frame, refSpace, layer);
      }
      this.scheduleFrame();
    });
  }

  private handleSessionEnded(): void {
    if (this.phase === 'idle') return;
    const session = this.session;
    if (session) {
      session.removeEventListener('end', this.onSessionEnd);
      if (this.frameState) session.cancelAnimationFrame(this.frameState.rafHandle);
    }
    const backend = this.activeBackend;
    const gpu = this.gpu;
    this.session = null;
    this.layer = null;
    this.gpu = null;
    this.activeBackend = null;
    this.refSpace = null;
    this.frameState = null;

    if (this.keyHandler) {
      unbindXrKeyboard(this.keyHandler);
      this.keyHandler = null;
    }

    this.restoreDesktopChrome();

    if (backend === 'webgpu') {
      restoreXrQualityGpu(this.rt.pipeline, this.qualitySnapshot);
      this.qualitySnapshot = null;
      gpu?.eyeUniforms.destroy();
      void this.restoreWebGPUPresentation();
    } else {
      restoreXrQuality(this.rt.webglRenderer, this.qualitySnapshot);
      this.qualitySnapshot = null;
      if (this.rt.backend === 'webgl' && this.rt.webglRenderer) {
        startWebGLLoop(this.rt);
      }
    }

    this.setPhase('idle');
    console.log('[XR] Session ended — mono loop restored.');
  }

  /**
   * Back to the canvas swapchain without a reload: re-assert the canvas
   * configuration, resize the frame graph from the eye size back to the canvas,
   * and restart the mono loop. Device loss during XR is left to the app's
   * existing recovery path (`recoverContext`).
   */
  private async restoreWebGPUPresentation(): Promise<void> {
    try {
      await this.rt.context?.restoreCanvasPresentation();
    } catch (err) {
      console.warn('[XR] Canvas reconfigure after XR failed:', err);
    }
    this.rt.handleResize();
    startWebGPULoop(this.rt);
  }

  private hideDesktopChrome(): void {
    this.hiddenEls = [];
    for (const id of ['controls', 'hud', 'ground-preset-selector', 'ground-station-panel']) {
      const el = document.getElementById(id);
      if (!el) continue;
      this.hiddenEls.push({ el, prev: el.style.display });
      el.style.display = 'none';
    }
  }

  private restoreDesktopChrome(): void {
    for (const { el, prev } of this.hiddenEls) {
      el.style.display = prev;
    }
    this.hiddenEls = [];
  }
}
