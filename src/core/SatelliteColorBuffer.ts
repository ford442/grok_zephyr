/**
 * Satellite Color Buffer Manager
 *
 * Per-satellite RGBA data pipeline using packed rgba8unorm (u32 per satellite).
 *
 * ═══════════════════════════════════════════════════════════════════
 * MEMORY BUDGET ANALYSIS
 * ═══════════════════════════════════════════════════════════════════
 *
 * 67 MB total GPU budget breakdown:
 *
 * Existing buffers:
 *   Orbital elements:  1,048,576 × 16 B = 16.00 MB (vec4f)
 *   Position buffer:   1,048,576 × 16 B = 16.00 MB (vec4f)
 *   Uniform:           256 B            =  0.00 MB
 *   Bloom uniforms:    64 B             =  0.00 MB
 *   Beam storage:      65,536 × 32 B   =  2.00 MB
 *   Beam params:       16 B             =  0.00 MB
 *                                       ─────────
 *   Subtotal:                            34.00 MB
 *
 * New color buffer options:
 *
 *   Option A: vec4f per satellite (REJECTED)
 *     1,048,576 × 16 B = 16.00 MB → total 50 MB
 *     Wasteful: 4 floats when we only need 4 bytes of color.
 *
 *   Option B: rgba8unorm packed as u32 (SELECTED) ✓
 *     1,048,576 × 4 B = 4.00 MB → total 38 MB
 *     4× more compact. CPU writes Uint32Array, GPU unpacks.
 *     Leaves 29 MB headroom for render targets.
 *
 *   Option C: Two buffers (color + blink state)
 *     Color:  1,048,576 × 4 B = 4.00 MB (rgba8unorm)
 *     Blink:  1,048,576 × 4 B = 4.00 MB (u32 timing data)
 *     Total:                     8.00 MB → total 42 MB
 *     Still well within budget, enables independent blink control.
 *
 * Render targets (at 1920×1080, rgba16float):
 *   HDR:    1920×1080×8 = 16.59 MB
 *   BloomA: 1920×1080×8 = 16.59 MB
 *   BloomB: 1920×1080×8 = 16.59 MB
 *   Depth:  1920×1080×4 =  8.29 MB
 *                        ─────────
 *   Render targets:       58.06 MB
 *
 * Grand total with Option B: 38 + 58 = 96 MB
 *   (render targets don't count against the 67 MB "buffer" budget;
 *    they're texture memory. The 67 MB refers to storage/uniform buffers.)
 *
 * ═══════════════════════════════════════════════════════════════════
 * CPU-SIDE PACKING
 * ═══════════════════════════════════════════════════════════════════
 *
 * Each satellite's color is packed as:
 *   u32 = R | (G << 8) | (B << 16) | (A << 24)
 *
 * The alpha channel (A) controls brightness/on-off for blink patterns:
 *   A = 0:   satellite is dark (off)
 *   A = 255: satellite is at full brightness (on)
 *   A = 1-254: intermediate brightness for antialiasing/gradients
 *
 * The CPU can update the entire 4 MB buffer per frame via
 * device.queue.writeBuffer() — well within the ~6 GB/s PCIe bandwidth.
 * At 60fps: 4 MB × 60 = 240 MB/s, trivial.
 *
 * ═══════════════════════════════════════════════════════════════════
 */

import type WebGPUContext from './WebGPUContext.js';
import { CONSTANTS } from '@/types/constants.js';

/** Pack RGBA (0-255 each) into a single u32 */
export function packRGBA8(r: number, g: number, b: number, a: number): number {
  return ((r & 0xFF)) |
         ((g & 0xFF) << 8) |
         ((b & 0xFF) << 16) |
         ((a & 0xFF) << 24);
}

/** Unpack u32 to [R, G, B, A] (0-255 each) */
export function unpackRGBA8(packed: number): [number, number, number, number] {
  return [
    (packed >>> 0) & 0xFF,
    (packed >>> 8) & 0xFF,
    (packed >>> 16) & 0xFF,
    (packed >>> 24) & 0xFF,
  ];
}

/**
 * Manages the per-satellite RGBA color buffer.
 *
 * Buffer layout: array<u32> with 1 entry per satellite.
 * Total size: NUM_SATELLITES × 4 bytes = 4 MB.
 *
 * The CPU fills this buffer each frame with arbitrary RGBA per satellite,
 * enabling:
 *   - Text/image projection (each sat = 1 pixel)
 *   - Blink patterns (alpha = on/off)
 *   - Shell-based coloring
 *   - Dynamic color animation
 */
export class SatelliteColorBuffer {
  private context: WebGPUContext;
  private gpuBuffer: GPUBuffer | null = null;
  private cpuData: Uint32Array;

  /** Buffer size in bytes */
  readonly bufferSize: number;

  constructor(context: WebGPUContext) {
    this.context = context;
    this.bufferSize = CONSTANTS.NUM_SATELLITES * 4; // 4 bytes per u32
    this.cpuData = new Uint32Array(CONSTANTS.NUM_SATELLITES);
  }

  /**
   * Initialize the GPU buffer.
   * Returns the GPUBuffer for binding in the render pipeline.
   */
  initialize(): GPUBuffer {
    this.gpuBuffer = this.context.createBuffer(
      this.bufferSize,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );

    console.log(
      `[SatelliteColorBuffer] Initialized: ${(this.bufferSize / 1024 / 1024).toFixed(2)} MB ` +
      `for ${CONSTANTS.NUM_SATELLITES.toLocaleString()} satellites (rgba8unorm packed u32)`
    );

    // Initialize all satellites to white, full brightness
    this.cpuData.fill(packRGBA8(255, 255, 255, 255));
    this.upload();

    return this.gpuBuffer;
  }

  /**
   * Get the GPU buffer for pipeline binding.
   */
  getBuffer(): GPUBuffer {
    if (!this.gpuBuffer) {
      throw new Error('Color buffer not initialized. Call initialize() first.');
    }
    return this.gpuBuffer;
  }

  /**
   * Get the CPU-side data for direct manipulation.
   * Modify this array, then call upload() to push to GPU.
   */
  getData(): Uint32Array {
    return this.cpuData;
  }

  /**
   * Set a single satellite's color.
   * r, g, b, a are in range [0, 255].
   */
  setSatelliteColor(index: number, r: number, g: number, b: number, a: number): void {
    this.cpuData[index] = packRGBA8(r, g, b, a);
  }

  /**
   * Set a range of satellites from an ImageData-like RGBA array.
   * Useful for projecting a 1024×1024 image where each pixel = 1 satellite.
   *
   * @param startIndex First satellite index
   * @param rgbaData Uint8Array with 4 bytes per pixel (RGBA order)
   * @param pixelCount Number of pixels to write
   */
  setFromImageData(startIndex: number, rgbaData: Uint8Array, pixelCount: number): void {
    for (let i = 0; i < pixelCount; i++) {
      const srcIdx = i * 4;
      this.cpuData[startIndex + i] = packRGBA8(
        rgbaData[srcIdx],
        rgbaData[srcIdx + 1],
        rgbaData[srcIdx + 2],
        rgbaData[srcIdx + 3]
      );
    }
  }

  /**
   * Set all satellites to a uniform color.
   */
  setAll(r: number, g: number, b: number, a: number): void {
    const packed = packRGBA8(r, g, b, a);
    this.cpuData.fill(packed);
  }

  /**
   * Set all satellites dark (off).
   */
  clearAll(): void {
    this.cpuData.fill(0); // R=0, G=0, B=0, A=0
  }

  /**
   * Upload the CPU data to GPU.
   * Call this once per frame after modifying cpuData.
   *
   * Bandwidth: 4 MB per upload.
   * At 60fps = 240 MB/s — trivial for modern PCIe/USB.
   */
  upload(): void {
    if (!this.gpuBuffer) return;
    this.context.writeBuffer(this.gpuBuffer, this.cpuData);
  }

  /**
   * Upload a sub-range of the buffer (for partial updates).
   * Useful when only a few satellites change per frame.
   */
  uploadRange(startIndex: number, count: number): void {
    if (!this.gpuBuffer) return;
    const byteOffset = startIndex * 4;
    const data = new Uint32Array(this.cpuData.buffer, byteOffset, count);
    this.context.getDevice().queue.writeBuffer(
      this.gpuBuffer,
      byteOffset,
      data as GPUAllowSharedBufferSource
    );
  }

  /**
   * Get memory usage in bytes.
   */
  getMemoryUsage(): number {
    return this.bufferSize;
  }

  /**
   * Destroy the GPU buffer.
   */
  destroy(): void {
    this.gpuBuffer?.destroy();
    this.gpuBuffer = null;
  }
}

export default SatelliteColorBuffer;
