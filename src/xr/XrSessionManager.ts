/**
 * WebXR session lifecycle for Grok Zephyr (WebGL path).
 */

import type { AppRuntime } from '@/app/AppRuntime.js';
import { startWebGLLoop, stopLoop } from '@/app/FrameLoop.js';
import { getXrSystem } from '@/xr/XrSupport.js';
import {
  bindXrKeyboard,
  createXrFrameLoopState,
  onXrFrame,
  unbindXrKeyboard,
  type XrFrameLoopState,
} from '@/xr/XrFrameLoop.js';
import { applyXrQuality, restoreXrQuality, type XrQualitySnapshot } from '@/xr/XrQuality.js';

export type XrSessionPhase = 'idle' | 'starting' | 'active' | 'ending';

export class XrSessionManager {
  private session: XRSession | null = null;
  private refSpace: XRReferenceSpace | null = null;
  private layer: XRWebGLLayer | null = null;
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

  async enter(): Promise<void> {
    if (this.phase !== 'idle') return;
    if (this.rt.backend !== 'webgl' || !this.rt.webglRenderer) {
      throw new Error('VR requires the WebGL renderer (?renderer=webgl).');
    }

    const xr = getXrSystem();
    if (!xr) {
      throw new Error('WebXR is not available in this browser.');
    }

    this.setPhase('starting');
    try {
      await this.rt.webglRenderer.makeXRCompatible();

      let session: XRSession;
      try {
        session = await xr.requestSession('immersive-vr', {
          requiredFeatures: ['local-floor'],
        });
      } catch {
        session = await xr.requestSession('immersive-vr', {
          requiredFeatures: ['local'],
        });
      }

      this.session = session;
      session.addEventListener('end', this.onSessionEnd);

      const gl = this.rt.webglRenderer.getGL();
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

      try {
        this.refSpace = await session.requestReferenceSpace('local-floor');
      } catch {
        this.refSpace = await session.requestReferenceSpace('local');
      }

      this.qualitySnapshot = applyXrQuality(this.rt.webglRenderer);
      this.hideDesktopChrome();
      stopLoop(this.rt);

      this.frameState = createXrFrameLoopState('horizon-720');
      this.keyHandler = bindXrKeyboard(this.rt, this.frameState);

      this.setPhase('active');
      this.scheduleFrame();
      console.log('[XR] Immersive VR session started (WebGL stereo).');
    } catch (err) {
      this.setPhase('idle');
      this.session = null;
      this.layer = null;
      this.refSpace = null;
      throw err;
    }
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
    const layer = this.layer;
    const frameState = this.frameState;
    if (!session || !refSpace || !layer || !frameState) return;

    frameState.rafHandle = session.requestAnimationFrame((time, frame) => {
      if (this.phase !== 'active' || !this.session) return;
      onXrFrame(this.rt, frameState, session, time, frame, refSpace, layer);
      this.scheduleFrame();
    });
  }

  private handleSessionEnded(): void {
    if (this.phase === 'idle') return;
    const session = this.session;
    if (session) {
      session.removeEventListener('end', this.onSessionEnd);
    }
    this.session = null;
    this.layer = null;
    this.refSpace = null;
    this.frameState = null;

    if (this.keyHandler) {
      unbindXrKeyboard(this.keyHandler);
      this.keyHandler = null;
    }

    restoreXrQuality(this.rt.webglRenderer, this.qualitySnapshot);
    this.qualitySnapshot = null;
    this.restoreDesktopChrome();

    if (this.rt.backend === 'webgl' && this.rt.webglRenderer) {
      startWebGLLoop(this.rt);
    }

    this.setPhase('idle');
    console.log('[XR] Session ended — mono loop restored.');
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
