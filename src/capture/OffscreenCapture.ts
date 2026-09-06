/**
 * Skip swapchain present (`getCurrentTexture`) and composite into an offscreen
 * texture that can be mapped for Playwright / software WebGPU.
 *
 * Headless Chrome in this environment cannot present a canvas swapchain;
 * compute + render to a texture still works. Enable with `?capture=offscreen`.
 */
export function isOffscreenCaptureEnabled(search: string = window.location.search): boolean {
  return new URLSearchParams(search).get('capture') === 'offscreen';
}

export class OffscreenCapture {
  private texture: GPUTexture | null = null;
  private view: GPUTextureView | null = null;
  private readback: GPUBuffer | null = null;
  private width = 0;
  private height = 0;
  private bytesPerRow = 0;
  private pending: Array<(url: string) => void> = [];
  private lastDataUrl: string | null = null;

  constructor(
    private readonly device: GPUDevice,
    private readonly format: GPUTextureFormat,
  ) {}

  getColorView(width: number, height: number): GPUTextureView {
    this.ensureSize(width, height);
    return this.view!;
  }

  wantsReadback(): boolean {
    return this.pending.length > 0;
  }

  encodeReadback(encoder: GPUCommandEncoder): void {
    if (!this.texture || !this.readback || !this.wantsReadback()) return;
    encoder.copyTextureToBuffer(
      { texture: this.texture },
      { buffer: this.readback, bytesPerRow: this.bytesPerRow, rowsPerImage: this.height },
      { width: this.width, height: this.height, depthOrArrayLayers: 1 },
    );
  }

  async finishReadback(): Promise<void> {
    if (!this.readback || !this.wantsReadback()) return;
    await this.readback.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(this.readback.getMappedRange());
    const packed = this.unpackRgba(src);
    this.readback.unmap();
    const dataUrl = this.encodePng(packed);
    this.lastDataUrl = dataUrl;
    const waiters = this.pending.splice(0);
    for (const resolve of waiters) resolve(dataUrl);
  }

  capture(): Promise<string> {
    if (this.lastDataUrl && this.pending.length === 0) {
      // Still wait one frame so the latest composite is included.
    }
    return new Promise((resolve) => {
      this.pending.push(resolve);
    });
  }

  destroy(): void {
    this.texture?.destroy();
    this.readback?.destroy();
    this.texture = null;
    this.view = null;
    this.readback = null;
  }

  private ensureSize(width: number, height: number): void {
    if (this.texture && this.width === width && this.height === height) return;
    this.texture?.destroy();
    this.readback?.destroy();
    this.width = width;
    this.height = height;
    this.bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    this.texture = this.device.createTexture({
      label: 'offscreen-capture',
      size: { width, height },
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    this.view = this.texture.createView();
    this.readback = this.device.createBuffer({
      label: 'offscreen-readback',
      size: this.bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  private unpackRgba(src: Uint8Array): Uint8ClampedArray {
    const out = new Uint8ClampedArray(this.width * this.height * 4);
    const bgra = this.format === 'bgra8unorm' || this.format === 'bgra8unorm-srgb';
    for (let y = 0; y < this.height; y++) {
      const row = y * this.bytesPerRow;
      for (let x = 0; x < this.width; x++) {
        const i = row + x * 4;
        const o = (y * this.width + x) * 4;
        const b0 = src[i] ?? 0;
        const b1 = src[i + 1] ?? 0;
        const b2 = src[i + 2] ?? 0;
        const b3 = src[i + 3] ?? 255;
        if (bgra) {
          out[o] = b2;
          out[o + 1] = b1;
          out[o + 2] = b0;
          out[o + 3] = b3;
        } else {
          out[o] = b0;
          out[o + 1] = b1;
          out[o + 2] = b2;
          out[o + 3] = b3;
        }
      }
    }
    return out;
  }

  private encodePng(rgba: Uint8ClampedArray): string {
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable for offscreen PNG');
    const image = ctx.createImageData(this.width, this.height);
    image.data.set(rgba);
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
  }
}
