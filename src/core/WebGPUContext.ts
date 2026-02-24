/**
 * Grok Zephyr - WebGPU Context Manager
 * 
 * Handles WebGPU adapter and device initialization,
 * canvas context setup, and error handling.
 */

import { CONSTANTS, RENDER } from '@/types/constants.js';

/** WebGPU context initialization result */
export interface WebGPUInitResult {
  device: GPUDevice;
  adapter: GPUAdapter;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  presentationFormat: GPUTextureFormat;
}

/** WebGPU context options */
export interface WebGPUContextOptions {
  powerPreference?: GPUPowerPreference;
  requiredFeatures?: GPUFeatureName[];
  requiredLimits?: Record<string, number>;
}

/**
 * WebGPU Context Manager
 * 
 * Handles initialization of the WebGPU environment including:
 * - Adapter and device creation
 * - Canvas context configuration
 * - Feature detection and limits
 */
export class WebGPUContext {
  private device: GPUDevice | null = null;
  private adapter: GPUAdapter | null = null;
  private context: GPUCanvasContext | null = null;
  private format: GPUTextureFormat = RENDER.SWAPCHAIN_FORMAT;
  private canvas: HTMLCanvasElement;
  private options: WebGPUContextOptions;
  private lostHandler: ((info: GPUDeviceLostInfo) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, options: WebGPUContextOptions = {}) {
    this.canvas = canvas;
    this.options = {
      powerPreference: 'high-performance',
      requiredFeatures: [],
      ...options,
    };
  }

  /**
   * Check if WebGPU is supported in the current browser
   */
  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'gpu' in navigator;
  }

  /**
   * Initialize WebGPU context
   * @throws Error if WebGPU is not supported or initialization fails
   */
  async initialize(): Promise<WebGPUInitResult> {
    if (!WebGPUContext.isSupported()) {
      throw new WebGPUError(
        'WebGPU is not supported in this browser. ' +
        'Please use Chrome 113+, Edge 113+, or Firefox Nightly with WebGPU enabled.'
      );
    }

    try {
      // Request adapter
      this.adapter = await navigator.gpu.requestAdapter({
        powerPreference: this.options.powerPreference,
      });

      if (!this.adapter) {
        throw new WebGPUError('No WebGPU adapter found. Your GPU may not support WebGPU.');
      }

      // Log adapter info for debugging
      const adapterInfo = await this.adapter.requestAdapterInfo();
      console.log('[WebGPU] Adapter:', adapterInfo.vendor, adapterInfo.architecture);

      // Calculate required buffer sizes for 1M satellites
      const requiredStorageSize = CONSTANTS.NUM_SATELLITES * 16 + 16;

      // Request device with appropriate limits
      this.device = await this.adapter.requestDevice({
        requiredFeatures: this.options.requiredFeatures,
        requiredLimits: {
          maxStorageBufferBindingSize: Math.min(
            this.adapter.limits.maxStorageBufferBindingSize,
            requiredStorageSize
          ),
          maxBufferSize: Math.min(
            this.adapter.limits.maxBufferSize,
            requiredStorageSize
          ),
          ...this.options.requiredLimits,
        },
      });

      // Handle device loss
      this.lostHandler = (info) => {
        console.error('[WebGPU] Device lost:', info.reason, info.message);
        if (info.reason === 'destroyed') {
          console.log('[WebGPU] Device was intentionally destroyed');
        } else {
          // Attempt recovery
          console.log('[WebGPU] Attempting to reinitialize...');
          this.initialize().catch(console.error);
        }
      };
      this.device.lost.then(this.lostHandler);

      // Setup canvas context
      this.context = this.canvas.getContext('webgpu');
      if (!this.context) {
        throw new WebGPUError('Failed to create WebGPU canvas context');
      }

      // Get preferred canvas format
      this.format = navigator.gpu.getPreferredCanvasFormat();

      // Configure context
      this.context.configure({
        device: this.device,
        format: this.format,
        alphaMode: 'opaque',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
      });

      console.log('[WebGPU] Context initialized successfully');
      console.log(`[WebGPU] Format: ${this.format}`);
      console.log(`[WebGPU] Max storage buffer: ${this.device.limits.maxStorageBufferBindingSize} bytes`);

      return {
        device: this.device,
        adapter: this.adapter,
        context: this.context,
        format: this.format,
        presentationFormat: this.format,
      };
    } catch (error) {
      if (error instanceof WebGPUError) {
        throw error;
      }
      throw new WebGPUError(
        `Failed to initialize WebGPU: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get the GPU device
   */
  getDevice(): GPUDevice {
    if (!this.device) {
      throw new WebGPUError('WebGPU not initialized. Call initialize() first.');
    }
    return this.device;
  }

  /**
   * Get the GPU adapter
   */
  getAdapter(): GPUAdapter {
    if (!this.adapter) {
      throw new WebGPUError('WebGPU not initialized. Call initialize() first.');
    }
    return this.adapter;
  }

  /**
   * Get the canvas context
   */
  getContext(): GPUCanvasContext {
    if (!this.context) {
      throw new WebGPUError('WebGPU not initialized. Call initialize() first.');
    }
    return this.context;
  }

  /**
   * Get the swapchain format
   */
  getFormat(): GPUTextureFormat {
    return this.format;
  }

  /**
   * Create a shader module from WGSL code
   */
  createShaderModule(code: string, label?: string): GPUShaderModule {
    const device = this.getDevice();
    const module = device.createShaderModule({
      code,
      label,
    });

    // Check for compilation errors
    module.getCompilationInfo().then((info) => {
      for (const message of info.messages) {
        const location = message.lineNum > 0 ? `:${message.lineNum}:${message.linePos}` : '';
        const text = `[Shader${location}] ${message.message}`;
        if (message.type === 'error') {
          console.error(text);
        } else if (message.type === 'warning') {
          console.warn(text);
        } else {
          console.log(text);
        }
      }
    });

    return module;
  }

  /**
   * Create a buffer with proper alignment
   */
  createBuffer(
    size: number,
    usage: GPUBufferUsageFlags,
    mappedAtCreation = false
  ): GPUBuffer {
    const device = this.getDevice();
    // Align to 256 bytes for uniform buffers
    const alignedSize = usage & GPUBufferUsage.UNIFORM
      ? Math.ceil(size / 256) * 256
      : size;
    
    return device.createBuffer({
      size: alignedSize,
      usage,
      mappedAtCreation,
    });
  }

  /**
   * Create a uniform buffer
   */
  createUniformBuffer(size: number): GPUBuffer {
    return this.createBuffer(size, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  }

  /**
   * Create a storage buffer
   */
  createStorageBuffer(size: number, readOnly = false): GPUBuffer {
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    if (!readOnly) {
      return this.createBuffer(size, usage | GPUBufferUsage.COPY_SRC);
    }
    return this.createBuffer(size, usage);
  }

  /**
   * Create a vertex buffer
   */
  createVertexBuffer(size: number): GPUBuffer {
    return this.createBuffer(
      size,
      GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    );
  }

  /**
   * Create an index buffer
   */
  createIndexBuffer(size: number): GPUBuffer {
    return this.createBuffer(
      size,
      GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
    );
  }

  /**
   * Write data to a buffer
   */
  writeBuffer(
    buffer: GPUBuffer,
    data: BufferSource,
    offset = 0
  ): void {
    this.getDevice().queue.writeBuffer(buffer, offset, data);
  }

  /**
   * Create a texture with standard usage
   */
  createTexture(
    width: number,
    height: number,
    format: GPUTextureFormat,
    usage: GPUTextureUsageFlags,
    label?: string
  ): GPUTexture {
    return this.getDevice().createTexture({
      size: [width, height],
      format,
      usage: usage | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      label,
    });
  }

  /**
   * Create a linear sampler with clamp-to-edge
   */
  createLinearSampler(): GPUSampler {
    return this.getDevice().createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
  }

  /**
   * Create a command encoder
   */
  createCommandEncoder(label?: string): GPUCommandEncoder {
    return this.getDevice().createCommandEncoder({ label });
  }

  /**
   * Submit command buffers
   */
  submit(commandBuffers: GPUCommandBuffer[]): void {
    this.getDevice().queue.submit(commandBuffers);
  }

  /**
   * Resize canvas and context
   */
  resize(width: number, height: number): void {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      // Context automatically handles resize
    }
  }

  /**
   * Get current canvas size
   */
  getCanvasSize(): { width: number; height: number } {
    return {
      width: this.canvas.width,
      height: this.canvas.height,
    };
  }

  /**
   * Check if a feature is supported
   */
  async isFeatureSupported(feature: GPUFeatureName): Promise<boolean> {
    if (!this.adapter) {
      throw new WebGPUError('WebGPU not initialized');
    }
    return this.adapter.features.has(feature);
  }

  /**
   * Destroy and cleanup resources
   */
  destroy(): void {
    if (this.device) {
      this.device.destroy();
      this.device = null;
    }
    this.adapter = null;
    this.context = null;
    this.lostHandler = null;
  }
}

/**
 * Custom WebGPU error class
 */
export class WebGPUError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebGPUError';
  }
}

export default WebGPUContext;
