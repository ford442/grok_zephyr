/**
 * Minimal WebXR type surface for environments whose TS DOM lib lacks XR.
 * Browsers provide the real implementations at runtime.
 */

interface XRSessionInit {
  requiredFeatures?: string[];
  optionalFeatures?: string[];
}

interface XRRigidTransform {
  readonly matrix: Float32Array;
  readonly inverse: XRRigidTransform;
}

interface XRView {
  readonly eye: 'left' | 'right' | 'none';
  readonly projectionMatrix: Float32Array;
  readonly transform: XRRigidTransform;
}

interface XRViewerPose {
  readonly views: ReadonlyArray<XRView>;
}

interface XRFrame {
  getViewerPose(referenceSpace: XRReferenceSpace): XRViewerPose | null;
  getPose(
    space: XRSpace,
    baseSpace: XRReferenceSpace,
  ): { transform: XRRigidTransform } | null;
}

interface XRSpace {}

interface XRReferenceSpace extends XRSpace {
  getOffsetReferenceSpace(originOffset: XRRigidTransform): XRReferenceSpace;
}

interface XRViewport {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface XRWebGLLayerInit {
  antialias?: boolean;
  depth?: boolean;
  stencil?: boolean;
  alpha?: boolean;
  ignoreDepthValues?: boolean;
  framebufferScaleFactor?: number;
}

declare class XRWebGLLayer {
  constructor(
    session: XRSession,
    context: WebGLRenderingContext | WebGL2RenderingContext,
    layerInit?: XRWebGLLayerInit,
  );
  readonly framebuffer: WebGLFramebuffer | null;
  readonly framebufferWidth: number;
  readonly framebufferHeight: number;
  getViewport(view: XRView): XRViewport | null;
}

interface XRInputSource {
  readonly gamepad: Gamepad | null;
  readonly targetRaySpace: XRSpace;
  readonly gripSpace: XRSpace | null;
  readonly handedness: 'none' | 'left' | 'right';
}

interface XRRenderStateInit {
  baseLayer?: XRWebGLLayer | null;
  depthNear?: number;
  depthFar?: number;
  inlineVerticalFieldOfView?: number;
}

interface XRSession extends EventTarget {
  readonly inputSources: ReadonlyArray<XRInputSource>;
  requestReferenceSpace(
    type: 'local' | 'local-floor' | 'bounded-floor' | 'unbounded' | 'viewer',
  ): Promise<XRReferenceSpace>;
  updateRenderState(state: XRRenderStateInit): Promise<void> | void;
  requestAnimationFrame(
    callback: (time: number, frame: XRFrame) => void,
  ): number;
  cancelAnimationFrame(handle: number): void;
  end(): Promise<void>;
}

interface XRSystem {
  isSessionSupported(mode: string): Promise<boolean>;
  requestSession(mode: string, options?: XRSessionInit): Promise<XRSession>;
}

interface Navigator {
  readonly xr?: XRSystem;
}

interface WebGL2RenderingContext {
  makeXRCompatible(): Promise<void>;
}
