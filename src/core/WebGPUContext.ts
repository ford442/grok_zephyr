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
  enabledFeatures: GPUFeatureName[];
  optionalFeatures: GPUFeatureName[];
}

/** WebGPU context options */
export interface WebGPUContextOptions {
  powerPreference?: GPUPowerPreference;
  requiredFeatures?: GPUFeatureName[];
  optionalFeatures?: GPUFeatureName[];
  requiredLimits?: Record<string, number>;
}

const MAX_BEAMS = 65536;
const TRAIL_HISTORY_FRAMES = 2;

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
      optionalFeatures: ['timestamp-query'],
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
      // Use adapter.info (new spec) with fallback to requestAdapterInfo (old spec)
      let adapterInfo: GPUAdapterInfo | undefined;
      if (this.adapter.info) {
        adapterInfo = this.adapter.info;
      } else if (typeof (this.adapter as any).requestAdapterInfo === 'function') {
        try {
          adapterInfo = await (this.adapter as any).requestAdapterInfo();
        } catch {
          // Ignore errors from deprecated API
        }
      }
      if (adapterInfo) {
        console.log('[WebGPU] Adapter:', adapterInfo.vendor, adapterInfo.architecture);
      }

      const requiredLimits = this.buildRequiredLimits();
      const requiredFeatures = this.getRequiredFeatures();
      const optionalFeatures = this.getOptionalFeatures();

      this.validateAdapterRequirements(requiredLimits, requiredFeatures);

      if (optionalFeatures.length !== (this.options.optionalFeatures?.length ?? 0)) {
        const unavailable = (this.options.optionalFeatures ?? []).filter(
          (feature) => !optionalFeatures.includes(feature)
        );
        if (unavailable.length > 0) {
          console.warn('[WebGPU] Optional features unavailable:', unavailable.join(', '));
        }
      }

      // Request device with required limits plus supported optional features
      this.device = await this.adapter.requestDevice({
        requiredFeatures: [...requiredFeatures, ...optionalFeatures],
        requiredLimits,
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
      const enabledFeatures = Array.from(this.device.features.values()) as GPUFeatureName[];
      console.log('[WebGPU] Enabled features:', enabledFeatures.join(', ') || 'none');

      return {
        device: this.device,
        adapter: this.adapter,
        context: this.context,
        format: this.format,
        presentationFormat: this.format,
        enabledFeatures,
        optionalFeatures,
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

  private buildRequiredLimits(): Record<string, number> {
    const perSatelliteBufferSize = CONSTANTS.NUM_SATELLITES * 16;
    const extendedElementBufferSize = CONSTANTS.NUM_SATELLITES * 32;
    const trailBufferSize = CONSTANTS.NUM_SATELLITES * 16 * TRAIL_HISTORY_FRAMES;
    const beamBufferSize = MAX_BEAMS * 32;
    const requiredStorageBufferSize = Math.max(
      perSatelliteBufferSize,
      extendedElementBufferSize,
      trailBufferSize,
      beamBufferSize
    );
    const requiredComputeWorkgroups = Math.ceil(CONSTANTS.NUM_SATELLITES / RENDER.WORKGROUP_SIZE);
    const mergedLimits: Record<string, number> = {
      maxStorageBufferBindingSize: requiredStorageBufferSize,
      maxBufferSize: requiredStorageBufferSize,
      maxComputeWorkgroupsPerDimension: requiredComputeWorkgroups,
    };

    for (const [limit, value] of Object.entries(this.options.requiredLimits ?? {})) {
      mergedLimits[limit] = Math.max(mergedLimits[limit] ?? 0, value);
    }

    return mergedLimits;
  }

  private getRequiredFeatures(): GPUFeatureName[] {
    return (this.options.requiredFeatures ?? []).filter((feature, index, features) => (
      features.indexOf(feature) === index
    ));
  }

  private getOptionalFeatures(): GPUFeatureName[] {
    if (!this.adapter) {
      return [];
    }

    return (this.options.optionalFeatures ?? []).filter((feature, index, features) => (
      features.indexOf(feature) === index && this.adapter!.features.has(feature)
    ));
  }

  private validateAdapterRequirements(
    requiredLimits: Record<string, number>,
    requiredFeatures: GPUFeatureName[]
  ): void {
    if (!this.adapter) {
      throw new WebGPUError('No WebGPU adapter found. Your GPU may not support WebGPU.');
    }

    const missingFeatures = requiredFeatures.filter((feature) => !this.adapter!.features.has(feature));
    if (missingFeatures.length > 0) {
      throw new WebGPUError(
        `This browser/GPU is missing required WebGPU features: ${missingFeatures.join(', ')}.`
      );
    }

    const adapterLimits = this.adapter.limits as unknown as Record<string, number>;
    const limitFailures = Object.entries(requiredLimits).filter(([limit, value]) => {
      const supportedValue = adapterLimits[limit];
      return typeof supportedValue !== 'number' || supportedValue < value;
    });

    if (limitFailures.length > 0) {
      const details = limitFailures
        .map(([limit, value]) => {
          const supported = adapterLimits[limit];
          return `${limit} requires ${value.toLocaleString()} but adapter reports ${(supported ?? 0).toLocaleString()}`;
        })
        .join('; ');
      throw new WebGPUError(
        'This GPU cannot run the full 1,048,576-satellite WebGPU path. ' +
        'Grok Zephyr stopped before allocating large buffers. ' +
        `${details}. Try a newer browser, a more capable GPU, or a device with fuller WebGPU support.`
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
    
    // Debug: Check if code is defined
    if (!code || code.trim() === '') {
      console.error(`❌ SHADER LOAD FAILED: ${label || 'unknown'} — code is undefined or empty!`);
      throw new Error(`Shader "${label || 'unknown'}" has no code`);
    }
    console.log(`✅ Loading shader: ${label || 'unknown'} (${code.length} chars)`);
    
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
    data: BufferSource | Float32Array | Uint32Array | Int32Array | Uint16Array | Int16Array | Uint8Array | Int8Array,
    offset = 0
  ): void {
    this.getDevice().queue.writeBuffer(buffer, offset, data as BufferSource);
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
