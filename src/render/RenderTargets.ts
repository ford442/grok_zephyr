/**
 * Render Targets Manager
 * Creates and manages HDR render targets
 */

import type WebGPUContext from '@/core/WebGPUContext.js';
import type { RenderTargets } from './pipelines/types.js';

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
    // Recreate if size changed
    if (this.targets && (this.width !== width || this.height !== height)) {
      this.destroy();
    }

    if (!this.targets) {
      this.width = width;
      this.height = height;
      this.targets = this.createTargets(width, height);
    }

    return this.targets;
  }

  private createTargets(width: number, height: number): RenderTargets {
    const device = this.context.getDevice();

    // HDR target (16-bit float for bloom)
    const hdr = device.createTexture({
      size: { width, height },
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      label: 'HDR Target'
    });

    // Depth buffer
    const depth = device.createTexture({
      size: { width, height },
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      label: 'Depth Buffer'
    });

    // Bloom targets (half res)
    const bloomWidth = Math.max(1, Math.floor(width / 2));
    const bloomHeight = Math.max(1, Math.floor(height / 2));

    const bloomA = device.createTexture({
      size: { width: bloomWidth, height: bloomHeight },
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      label: 'Bloom A'
    });

    const bloomB = device.createTexture({
      size: { width: bloomWidth, height: bloomHeight },
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      label: 'Bloom B'
    });

    return {
      hdr,
      depth,
      bloomA,
      bloomB,
      hdrView: hdr.createView(),
      depthView: depth.createView(),
      bloomAView: bloomA.createView(),
      bloomBView: bloomB.createView()
    };
  }

  getTargets(): RenderTargets | null {
    return this.targets;
  }

  destroy(): void {
    if (this.targets) {
      this.targets.hdr.destroy();
      this.targets.depth.destroy();
      this.targets.bloomA.destroy();
      this.targets.bloomB.destroy();
      this.targets = null;
    }
  }
}
