/**
 * Grok Zephyr - WebGPU Context Manager
 *
 * Handles WebGPU adapter and device initialization,
 * canvas context setup, and error handling.
 */

import { RENDER } from '@/types/constants.js';
import type { QualityLevel } from '@/core/QualityPresets.js';
import {
  fleetLimitsForCount,
  installActiveFleetScale,
  persistSuccessfulFleetSize,
  type FleetScale,
} from '@/core/FleetScale.js';
import {
  adapterPowerFallbackOrder,
  chooseAdapterCandidate,
  REQUESTED_OPTIONAL_FEATURES,
  snapshotAdapter,
  type GpuCapabilityProfile,
} from '@/core/GpuCapabilities.js';
import type { CanvasPresentationOptions, PresentationMode } from '@/core/HdrPresentation.js';
import {
  WebGPUErrorReporter,
  type WebGPUErrorReportHandler,
} from '@/core/WebGPUErrorReporter.js';

export type { CanvasPresentationOptions, PresentationMode } from '@/core/HdrPresentation.js';

/** Deprecated pre-spec adapter.info fallback. */
type GPUAdapterWithLegacyInfo = GPUAdapter & {
  requestAdapterInfo?: () => Promise<GPUAdapterInfo>;
};

async function readAdapterInfo(adapter: GPUAdapter): Promise<GPUAdapterInfo | undefined> {
  if (adapter.info) {
    return adapter.info;
  }

  const legacyAdapter = adapter as GPUAdapterWithLegacyInfo;
  if (typeof legacyAdapter.requestAdapterInfo !== 'function') {
    return undefined;
  }

  try {
    return await legacyAdapter.requestAdapterInfo();
  } catch {
    return undefined;
  }
}

function getAdapterLimitValue(adapter: GPUAdapter, limit: string): number | undefined {
  const limits = adapter.limits as unknown as Readonly<Record<string, number>>;
  const supportedValue = limits[limit];
  return typeof supportedValue === 'number' ? supportedValue : undefined;
}

/** WebGPU context initialization result */
export interface WebGPUInitResult {
  device: GPUDevice;
  adapter: GPUAdapter;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  presentationFormat: GPUTextureFormat;
  presentationMode: PresentationMode;
  hdrPresentationActive: boolean;
  enabledFeatures: GPUFeatureName[];
  optionalFeatures: GPUFeatureName[];
}

/** WebGPU context options */
export interface WebGPUContextOptions {
  powerPreference?: GPUPowerPreference;
  requiredFeatures?: GPUFeatureName[];
  optionalFeatures?: GPUFeatureName[];
  requiredLimits?: Record<string, number>;
  /** App-owned handler for device loss (recovery). */
  onDeviceLost?: (info: GPUDeviceLostInfo) => void;
  /** Structured GPU error reports (validation, OOM, shaders, uncaptured). */
  onErrorReport?: WebGPUErrorReportHandler;
  /** Swapchain / canvas presentation (format, tone mapping, color space). */
  canvas?: CanvasPresentationOptions;
  /** Quality used when `?sats=` is absent. */
  qualityLevel?: QualityLevel;
  /** Location search string for `?sats=` (defaults to window.location.search). */
  search?: string;
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
  private presentationMode: PresentationMode = 'sdr';
  private canvas: HTMLCanvasElement;
  private options: WebGPUContextOptions;
  private lostHandler: ((info: GPUDeviceLostInfo) => void) | null = null;
  private suppressDeviceLostCallback = false;
  private readonly errorReporter: WebGPUErrorReporter;
  private fleetScale: FleetScale | null = null;
  private capabilityProfile: GpuCapabilityProfile | null = null;

  constructor(canvas: HTMLCanvasElement, options: WebGPUContextOptions = {}) {
    this.canvas = canvas;
    this.options = {
      powerPreference: 'high-performance',
      requiredFeatures: [],
      optionalFeatures: [...REQUESTED_OPTIONAL_FEATURES],
      ...options,
    };
    this.errorReporter = new WebGPUErrorReporter((report) => {
      this.options.onErrorReport?.(report);
    });
  }

  getErrorReporter(): WebGPUErrorReporter {
    return this.errorReporter;
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
          'Please use Chrome 113+, Edge 113+, or Firefox Nightly with WebGPU enabled.',
      );
    }

    try {
      const selected = await this.selectAdapterAndProfile();
      this.adapter = selected.adapter;
      this.capabilityProfile = selected.profile;
      this.fleetScale = selected.profile.fleet;
      installActiveFleetScale(this.fleetScale);

      console.log(
        `[WebGPU] Adapter: ${selected.profile.vendor} ${selected.profile.architecture} (${selected.profile.powerPreference})`,
      );
      if (selected.profile.missingOptional.length > 0) {
        console.warn(
          '[WebGPU] Optional features unavailable:',
          selected.profile.missingOptional.join(', '),
        );
      }

      const requiredLimits = this.buildRequiredLimits(this.fleetScale.count);
      const requiredFeatures = this.getRequiredFeatures();
      const optionalFeatures = selected.profile.enabledOptional.filter((feature) =>
        (this.options.optionalFeatures ?? REQUESTED_OPTIONAL_FEATURES).includes(feature),
      );

      this.validateAdapterRequirements(requiredLimits, requiredFeatures);

      // Request device with required limits plus supported optional features
      this.device = await this.adapter.requestDevice({
        requiredFeatures: [...requiredFeatures, ...optionalFeatures],
        requiredLimits,
      });

      this.errorReporter.attachUncapturedErrorListener(this.device);

      // Handle device loss — recovery is owned by the app layer via onDeviceLost.
      this.lostHandler = (info) => {
        console.error('[WebGPU] Device lost:', info.reason, info.message);
        if (this.suppressDeviceLostCallback) {
          return;
        }
        this.options.onDeviceLost?.(info);
      };
      void this.device.lost.then(this.lostHandler);

      // Setup canvas context
      this.context = this.canvas.getContext('webgpu');
      if (!this.context) {
        throw new WebGPUError('Failed to create WebGPU canvas context');
      }

      await this.configureCanvasContext();

      console.log('[WebGPU] Context initialized successfully');
      console.log(`[WebGPU] Format: ${this.format}`);
      console.log(`[WebGPU] Presentation: ${this.presentationMode}`);
      persistSuccessfulFleetSize(this.fleetScale.count);
      console.log(
        `[WebGPU] Fleet size: ${this.fleetScale.count.toLocaleString()}` +
          (this.fleetScale.autoReduced
            ? ` (reduced from ${this.fleetScale.requested.toLocaleString()} — adapter limits)`
            : ''),
      );
      console.log(
        `[WebGPU] Max storage buffer: ${this.device.limits.maxStorageBufferBindingSize} bytes`,
      );
      const enabledFeatures = Array.from(this.device.features) as GPUFeatureName[];
      console.log('[WebGPU] Enabled features:', enabledFeatures.join(', ') || 'none');

      return {
        device: this.device,
        adapter: this.adapter,
        context: this.context,
        format: this.format,
        presentationFormat: this.format,
        presentationMode: this.presentationMode,
        hdrPresentationActive: this.presentationMode === 'hdr',
        enabledFeatures,
        optionalFeatures,
      };
    } catch (error) {
      if (error instanceof WebGPUError) {
        throw error;
      }
      this.errorReporter.report({
        stage: 'initialization',
        kind: 'initialization',
        message: error instanceof Error ? error.message : String(error),
      });
      throw new WebGPUError(
        `Failed to initialize WebGPU: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Recreate adapter/device/context after device loss or intentional teardown.
   */
  async recoverContext(): Promise<WebGPUInitResult> {
    this.device = null;
    this.adapter = null;
    this.context = null;
    this.lostHandler = null;
    this.suppressDeviceLostCallback = false;
    return this.initialize();
  }

  /** Test hook: simulates a GPU device loss (triggers onDeviceLost). */
  loseDeviceForTesting(): void {
    this.getDevice().destroy();
  }

  getFleetScale(): FleetScale | null {
    return this.fleetScale;
  }

  getNumSatellites(): number {
    return this.fleetScale?.count ?? 0;
  }

  getCapabilities(): GpuCapabilityProfile | null {
    return this.capabilityProfile;
  }

  getDepthFormat(): GPUTextureFormat {
    return this.capabilityProfile?.depthFormat ?? RENDER.DEPTH_FORMAT;
  }

  private bootSearch(): string {
    return this.options.search ?? (typeof window !== 'undefined' ? window.location.search : '');
  }

  private async selectAdapterAndProfile(): Promise<{
    adapter: GPUAdapter;
    profile: GpuCapabilityProfile;
  }> {
    const search = this.bootSearch();
    const quality = this.options.qualityLevel ?? 'high';
    const order = adapterPowerFallbackOrder(this.options.powerPreference ?? 'high-performance');
    const seen = new Set<GPUAdapter>();
    const gathered: { adapter: GPUAdapter; preference: GPUPowerPreference; snapshot: import('@/core/GpuCapabilities.js').AdapterSnapshot }[] =
      [];

    for (const preference of order) {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: preference });
      if (!adapter || seen.has(adapter)) continue;
      seen.add(adapter);
      const info = await readAdapterInfo(adapter);
      gathered.push({ adapter, preference, snapshot: snapshotAdapter(adapter, info) });
    }

    if (gathered.length === 0) {
      throw new WebGPUError('No WebGPU adapter found. Your GPU may not support WebGPU.');
    }

    const chosen = chooseAdapterCandidate(
      gathered.map(({ preference, snapshot }) => ({ preference, snapshot })),
      { search, quality },
    );
    if (!chosen) {
      throw new WebGPUError(
        'This GPU cannot allocate satellite storage buffers even at the minimum fleet size (16,384). ' +
          'Tried high-performance and low-power adapters. Try a different browser or GPU.',
      );
    }

    const adapter = gathered.find(
      (c) => c.preference === chosen.preference && c.snapshot === chosen.snapshot,
    )?.adapter;
    if (!adapter) {
      throw new WebGPUError('Failed to match the selected WebGPU adapter.');
    }
    return { adapter, profile: chosen.profile };
  }

  private buildRequiredLimits(numSatellites: number): Record<string, number> {
    const fleetLimits = fleetLimitsForCount(numSatellites);
    const mergedLimits: Record<string, number> = { ...fleetLimits };

    for (const [limit, value] of Object.entries(this.options.requiredLimits ?? {})) {
      mergedLimits[limit] = Math.max(mergedLimits[limit] ?? 0, value);
    }

    return mergedLimits;
  }

  private getRequiredFeatures(): GPUFeatureName[] {
    const requested = [...new Set(this.options.requiredFeatures ?? [])];
    const adapter = this.adapter;
    if (!adapter) return [];
    const supported = requested.filter((feature) => adapter.features.has(feature));
    const dropped = requested.filter((feature) => !adapter.features.has(feature));
    if (dropped.length > 0) {
      console.warn('[WebGPU] Dropped unsupported required features:', dropped.join(', '));
    }
    return supported;
  }

  private validateAdapterRequirements(
    requiredLimits: Record<string, number>,
    requiredFeatures: GPUFeatureName[],
  ): void {
    if (!this.adapter) {
      throw new WebGPUError('No WebGPU adapter found. Your GPU may not support WebGPU.');
    }

    const adapter = this.adapter;
    const missingFeatures = requiredFeatures.filter((feature) => !adapter.features.has(feature));
    if (missingFeatures.length > 0) {
      throw new WebGPUError(
        `This browser/GPU is missing required WebGPU features: ${missingFeatures.join(', ')}.`,
      );
    }

    const limitFailures = Object.entries(requiredLimits).filter(([limit, value]) => {
      const supportedValue = getAdapterLimitValue(adapter, limit);
      return supportedValue === undefined || supportedValue < value;
    });

    if (limitFailures.length > 0) {
      const details = limitFailures
        .map(([limit, value]) => {
          const supported = getAdapterLimitValue(adapter, limit);
          const supportedLabel =
            supported === undefined ? 'unsupported' : supported.toLocaleString();
          return `${limit} requires ${value.toLocaleString()} but adapter reports ${supportedLabel}`;
        })
        .join('; ');
      throw new WebGPUError(
        'This GPU cannot meet the WebGPU limits for the selected fleet size. ' +
          `${details}. Try ?sats=65536 or a more capable GPU.`,
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

  /** Active canvas presentation mode after feature detection / fallback. */
  getPresentationMode(): PresentationMode {
    return this.presentationMode;
  }

  /** True when the swapchain is configured for extended-range HDR output. */
  isHdrPresentationActive(): boolean {
    return this.presentationMode === 'hdr';
  }

  private canvasUsage(): GPUTextureUsageFlags {
    return (
      GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC
    );
  }

  private buildSdrCanvasConfiguration(): GPUCanvasConfiguration {
    const canvasOpts = this.options.canvas;
    this.format = navigator.gpu.getPreferredCanvasFormat();

    return {
      device: this.device!,
      format: this.format,
      alphaMode: canvasOpts?.alphaMode ?? 'opaque',
      usage: this.canvasUsage(),
      toneMapping: { mode: 'standard' },
    };
  }

  private buildHdrCanvasConfiguration(): GPUCanvasConfiguration {
    const canvasOpts = this.options.canvas;
    return {
      device: this.device!,
      format: canvasOpts?.format ?? 'rgba16float',
      alphaMode: canvasOpts?.alphaMode ?? 'opaque',
      usage: this.canvasUsage(),
      colorSpace: canvasOpts?.colorSpace ?? 'display-p3',
      toneMapping: canvasOpts?.toneMapping ?? { mode: 'extended' },
    };
  }

  private isHdrCanvasRequest(): boolean {
    const canvasOpts = this.options.canvas;
    if (!canvasOpts) return false;
    return (
      canvasOpts.format === 'rgba16float' && canvasOpts.toneMapping?.mode === 'extended'
    );
  }

  private readActivePresentationMode(): PresentationMode {
    const active = this.context?.getConfiguration();
    if (
      active?.format === 'rgba16float' &&
      active.toneMapping?.mode === 'extended'
    ) {
      return 'hdr';
    }
    return 'sdr';
  }

  private async configureCanvasContext(): Promise<void> {
    if (this.isHdrCanvasRequest()) {
      const hdrConfig = this.buildHdrCanvasConfiguration();
      try {
        await this.errorReporter.withScope(this.device!, 'canvas-context-hdr', () => {
          this.context!.configure(hdrConfig);
        });
        this.format = this.context!.getConfiguration()?.format ?? hdrConfig.format;
        this.presentationMode = this.readActivePresentationMode();
        if (this.presentationMode === 'hdr') {
          return;
        }
        console.warn(
          '[WebGPU] HDR canvas requested but browser reported standard presentation; falling back to SDR',
        );
      } catch (error) {
        console.warn('[WebGPU] HDR canvas configuration failed, falling back to SDR:', error);
      }
    }

    const sdrConfig = this.buildSdrCanvasConfiguration();
    await this.errorReporter.withScope(this.device!, 'canvas-context', () => {
      this.context!.configure(sdrConfig);
    });
    this.format = this.context!.getConfiguration()?.format ?? sdrConfig.format;
    this.presentationMode = this.readActivePresentationMode();
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

    void this.errorReporter.checkShaderModule(module, label ?? 'unknown').catch((error: unknown) => {
      console.error(error);
    });

    return module;
  }

  /**
   * Create a buffer with proper alignment
   */
  createBuffer(size: number, usage: GPUBufferUsageFlags, mappedAtCreation = false): GPUBuffer {
    const device = this.getDevice();
    // Align to 256 bytes for uniform buffers
    const alignedSize = usage & GPUBufferUsage.UNIFORM ? Math.ceil(size / 256) * 256 : size;

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
    return this.createBuffer(size, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
  }

  /**
   * Create an index buffer
   */
  createIndexBuffer(size: number): GPUBuffer {
    return this.createBuffer(size, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST);
  }

  /**
   * Write data to a buffer
   */
  writeBuffer(
    buffer: GPUBuffer,
    data:
      | BufferSource
      | Float32Array
      | Uint32Array
      | Int32Array
      | Uint16Array
      | Int16Array
      | Uint8Array
      | Int8Array,
    offset = 0,
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
    label?: string,
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
  isFeatureSupported(feature: GPUFeatureName): boolean {
    if (!this.adapter) {
      throw new WebGPUError('WebGPU not initialized');
    }
    return this.adapter.features.has(feature);
  }

  /**
   * Destroy and cleanup resources
   */
  destroy(): void {
    this.suppressDeviceLostCallback = true;
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
