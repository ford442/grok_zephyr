/**
 * Render Targets Manager
 * Creates and manages HDR render targets
 */

import type WebGPUContext from '@/core/WebGPUContext.js';
import { RENDER } from '@/types/constants.js';
import { MAX_BLOOM_LEVELS, type RenderTargets } from './pipelines/types.js';

export class RenderTargetManager {
  private context: WebGPUContext;
  private targets: RenderTargets | null = null;
  private width = 0;
  private height = 0;

  constructor(context: WebGPUContext) {
    this.context = context;
  }

  /**
   * Create or recreate render targets for given size
   */
  initialize(width: number, height: number): RenderTargets {
    if (this.targets && (this.width !== width || this.height !== height)) {
      this.destroy();
    }

    if (!this.targets) {
      this.width = width;
      this.height = height;
      this.targets = createRenderTargets(this.context, width, height);
    }

    return this.targets;
  }

  getTargets(): RenderTargets | null {
    return this.targets;
  }

  destroy(): void {
    if (!this.targets) return;
    destroyRenderTargets(this.targets);
    this.targets = null;
  }
}

export function createRenderTargets(
  context: WebGPUContext,
  width: number,
  height: number,
): RenderTargets {
  const device = context.getDevice();
  const mkTex = (w: number, h: number, format: GPUTextureFormat): GPUTexture => {
    return device.createTexture({
      size: [w, h],
      format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
  };

  const hdr = mkTex(width, height, RENDER.HDR_FORMAT);
  const depth = device.createTexture({
    size: [width, height],
    format: RENDER.DEPTH_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const bloomA = mkTex(width, height, RENDER.HDR_FORMAT);
  const bloomB = mkTex(width, height, RENDER.HDR_FORMAT);
  const motionBlur = mkTex(width, height, RENDER.HDR_FORMAT);
  const dofW = Math.max(1, Math.floor(width / 2));
  const dofH = Math.max(1, Math.floor(height / 2));
  const dofHalfA = mkTex(dofW, dofH, RENDER.HDR_FORMAT);
  const dofHalfB = mkTex(dofW, dofH, RENDER.HDR_FORMAT);
  const dofComposite = mkTex(width, height, RENDER.HDR_FORMAT);

  const bloomMip: GPUTexture[] = [];
  const bloomMipViews: GPUTextureView[] = [];
  for (let i = 0; i < MAX_BLOOM_LEVELS; i++) {
    const scale = 1 << (i + 1);
    const mw = Math.max(1, Math.floor(width / scale));
    const mh = Math.max(1, Math.floor(height / scale));
    const mip = mkTex(mw, mh, RENDER.HDR_FORMAT);
    bloomMip.push(mip);
    bloomMipViews.push(mip.createView());
  }

  const surfaceFormat = context.getFormat();
  const compositeIntermediate = device.createTexture({
    size: [width, height],
    format: surfaceFormat,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  });

  return {
    hdr,
    depth,
    bloomA,
    bloomB,
    motionBlur,
    dofHalfA,
    dofHalfB,
    dofComposite,
    bloomMip,
    bloomMipViews,
    compositeIntermediate,
    hdrView: hdr.createView(),
    depthView: depth.createView(),
    bloomAView: bloomA.createView(),
    bloomBView: bloomB.createView(),
    motionBlurView: motionBlur.createView(),
    dofHalfAView: dofHalfA.createView(),
    dofHalfBView: dofHalfB.createView(),
    dofCompositeView: dofComposite.createView(),
    compositeIntermediateView: compositeIntermediate.createView(),
  };
}

export function destroyRenderTargets(targets: RenderTargets): void {
  targets.hdr.destroy();
  targets.depth.destroy();
  targets.bloomA.destroy();
  targets.bloomB.destroy();
  targets.motionBlur.destroy();
  targets.dofHalfA.destroy();
  targets.dofHalfB.destroy();
  targets.dofComposite.destroy();
  targets.bloomMip.forEach(t => t.destroy());
  targets.compositeIntermediate.destroy();
}
