
import { RenderPipeline } from '../RenderPipeline.js';
import { RENDER } from '@/types/constants.js';

export function createRenderTargets(pipeline: any, width: number, height: number): void {

    const device = this.context.getDevice();
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

    // Bloom pyramid mip levels: [0]=1/2, [1]=1/4, [2]=1/8, [3]=1/16, [4]=1/32
    const bloomMip: GPUTexture[] = [];
    const bloomMipViews: GPUTextureView[] = [];
    for (let i = 0; i < RenderPipeline.MAX_BLOOM_LEVELS; i++) {
      const scale = 1 << (i + 1); // 2, 4, 8, 16, 32
      const mw = Math.max(1, Math.floor(width / scale));
      const mh = Math.max(1, Math.floor(height / scale));
      const mip = mkTex(mw, mh, RENDER.HDR_FORMAT);
      bloomMip.push(mip);
      bloomMipViews.push(mip.createView());
    }

    // Intermediate composite target: the composite pass writes to this when
    // PostProcessStack is active, so the post-process stack can read from it.
    const surfaceFormat = this.context.getFormat();
    const compositeIntermediate = device.createTexture({
      size: [width, height],
      format: surfaceFormat,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    this.renderTargets = {
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