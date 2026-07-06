/**
 * Grok Zephyr - Render Pipeline
 * 
 * Manages the 6-pass rendering pipeline:
 * 1. Compute orbital positions
 * 2. Smile V2 animation (optional, between compute and scene)
 * 3. Scene pass (stars, Earth, atmosphere, satellites)
 * 4. Bloom threshold (configurable threshold + soft-knee)
 * 5. Bloom downsample pyramid (Kawase dual-filter, 2–5 levels)
 * 6. Bloom upsample pyramid (9-tap tent filter, additive blend)
 * 7. Composite + tonemapping (ACES, optional anamorphic streaks)
 */

import type WebGPUContext from '@/core/WebGPUContext.js';
import type { SatelliteBufferSet } from '@/core/SatelliteGPUBuffer.js';
import type { EarthAtmosphereRenderer } from '@/earth.js';
import type { BloomConfig } from '@/types/animation.js';
import { SmileV2Pipeline } from './SmileV2Pipeline.js';
import { SHADERS } from '@/shaders/index.js';
import { CONSTANTS, RENDER } from '@/types/constants.js';
import { DEFAULT_BLOOM_CONFIG } from '@/types/animation.js';
import type { ImageTuningSettings } from '@/core/ImageTuning.js';
import { packSatelliteVisualUniform, SHIPPING_IMAGE_TUNING } from '@/core/ImageTuning.js';
import type { DepthOfFieldFocusMode, DepthOfFieldQualitySettings } from '@/core/QualityPresets.js';

/** Render targets for HDR pipeline */
export interface RenderTargets {
  hdr: GPUTexture;
  depth: GPUTexture;
  bloomA: GPUTexture;
  bloomB: GPUTexture;
  motionBlur: GPUTexture;
  dofHalfA: GPUTexture;
  dofHalfB: GPUTexture;
  dofComposite: GPUTexture;
  /** Bloom pyramid mip levels: [0]=1/2, [1]=1/4, [2]=1/8, [3]=1/16, [4]=1/32 */
  bloomMip: GPUTexture[];
  bloomMipViews: GPUTextureView[];
  /** Intermediate target for the composite pass when PostProcessStack is active */
  compositeIntermediate: GPUTexture;
  
  // Cached views
  hdrView: GPUTextureView;
  depthView: GPUTextureView;
  bloomAView: GPUTextureView;
  bloomBView: GPUTextureView;
  motionBlurView: GPUTextureView;
  dofHalfAView: GPUTextureView;
  dofHalfBView: GPUTextureView;
  dofCompositeView: GPUTextureView;
  compositeIntermediateView: GPUTextureView;
}

/** Pipeline bind groups */
export interface PipelineBindGroups {
  compute: GPUBindGroup;
  beamCompute: GPUBindGroup;
  stars: GPUBindGroup;
  earth: GPUBindGroup;
  atmosphere: GPUBindGroup;
  satellites: GPUBindGroup;
  beam: GPUBindGroup;
  groundTerrain: GPUBindGroup;
  bloomThreshold: GPUBindGroup;
  composite: GPUBindGroup;
}

/** Maximum number of laser beams */
export const MAX_BEAMS = 65536;

/** All render pipelines */
export interface Pipelines {
  compute: GPUComputePipeline;
  beamCompute: GPUComputePipeline;
  autoExposureHistogram: GPUComputePipeline;
  autoExposureAdapt: GPUComputePipeline;
  stars: GPURenderPipeline;
  earth: GPURenderPipeline;
  atmosphere: GPURenderPipeline;
  satellites: GPURenderPipeline;
  beam: GPURenderPipeline;
  groundTerrain: GPURenderPipeline;
  skyline: GPURenderPipeline;
  bloomThreshold: GPURenderPipeline;
  bloomBlur: GPURenderPipeline;
  bloomDownsample: GPURenderPipeline;
  bloomUpsample: GPURenderPipeline;
  composite: GPURenderPipeline;
  dofDownsample: GPURenderPipeline;
  dofBlurH: GPURenderPipeline;
  dofBlurV: GPURenderPipeline;
  dofComposite: GPURenderPipeline;
  motionBlur: GPURenderPipeline;
}

const DOF_FOCUS_MODE: Record<DepthOfFieldFocusMode, number> = {
  'auto-center': 0,
  'satellite-track': 1,
  'surface-distance': 2,
  'earth-center': 3,
};

const DEFAULT_DOF_CONFIG: DepthOfFieldQualitySettings = {
  enabled: false,
  focusMode: 'auto-center',
  surfaceDistanceKm: 1200,
  maxBlurPx: 0,
  cocScale: 0,
  transitionRate: 3.5,
  depthSigma: 1.5,
};

const ATMOSPHERE_LUT_WIDTH = 256;
const ATMOSPHERE_LUT_HEIGHT = 64;
const EARTH_RADIUS_KM = 6371.0;
const ATMOSPHERE_TOP_KM = 6471.0;
const RAYLEIGH_SCALE_HEIGHT_KM = 8.0;
const MIE_SCALE_HEIGHT_KM = 1.2;

interface AtmosphereScatteringConfig {
  enabled: boolean;
  hazeStrength: number;
}

export type TonemapMode = 0 | 1 | 2 | 3; // 0=ACES, 1=AgX, 2=Reinhard, 3=Uncharted2

interface ExposureSettingsConfig {
  autoEnabled: boolean;
  manualExposure: number;
  adaptationSpeed: number;
  minExposure: number;
  maxExposure: number;
  tonemapMode: TonemapMode;
}

interface MotionBlurConfig {
  enabled: boolean;
  cameraStrength: number;
  satelliteStretch: number;
  tapCount: number;
}

const DEFAULT_ATMOSPHERE_SCATTERING: AtmosphereScatteringConfig = {
  enabled: false,
  hazeStrength: 0.28,
};

const AUTO_EXPOSURE_HISTOGRAM_BINS = 64;

const DEFAULT_EXPOSURE_SETTINGS: ExposureSettingsConfig = {
  autoEnabled: true,
  manualExposure: 1.0,
  adaptationSpeed: 1.8,
  minExposure: 0.1,
  maxExposure: 10.0,
  tonemapMode: 0,
};

const DEFAULT_MOTION_BLUR_CONFIG: MotionBlurConfig = {
  enabled: true,
  cameraStrength: 0.75,
  satelliteStretch: 0.6,
  tapCount: 12,
};

/**
 * Render Pipeline Manager
 * 
 * Encapsulates all rendering logic for the 6-pass pipeline.
 */
export class RenderPipeline {
  private context: WebGPUContext;
  private buffers: SatelliteBufferSet;
  private linearSampler: GPUSampler;
  
  private pipelines: Pipelines | null = null;
  private bindGroups: PipelineBindGroups | null = null;
  private renderTargets: RenderTargets | null = null;
  private smileV2Pipeline: SmileV2Pipeline | null = null;
  
  private width = 0;
  private height = 0;

  /** Current bloom configuration (drives threshold, levels, anamorphic) */
  private bloomConfig: BloomConfig = { ...DEFAULT_BLOOM_CONFIG };
  /** Live image tuning (bloom + satellite kernel) */
  private imageTuning: ImageTuningSettings = { ...SHIPPING_IMAGE_TUNING };

  /** Uniform buffer for the bloom threshold pass (ThresholdUni) */
  private bloomThresholdUniformBuffer: GPUBuffer | null = null;
  /** Per-satellite fragment kernel parameters */
  private satelliteVisualUniformBuffer: GPUBuffer | null = null;
  /** Uniform buffer for the composite bloom parameters (BloomCompositeUni) */
  private bloomCompositeUniformBuffer: GPUBuffer | null = null;
  /** Uniform buffer for tonemap mode/manual exposure controls. */
  private tonemapUniformBuffer: GPUBuffer | null = null;
  /** Uniform buffer for depth-of-field parameters. */
  private dofUniformBuffer: GPUBuffer | null = null;
  /** Uniform buffer for atmosphere scattering controls. */
  private atmosphereSettingsBuffer: GPUBuffer | null = null;
  /** Motion blur uniforms (previous VP + inverse VP + strengths). */
  private motionBlurUniformBuffer: GPUBuffer | null = null;
  /** Auto exposure histogram (64 bins). */
  private autoExposureHistogramBuffer: GPUBuffer | null = null;
  /** Auto exposure state (single exposure value). */
  private autoExposureStateBuffer: GPUBuffer | null = null;
  /** Auto exposure compute settings (dt/speed/min/max). */
  private autoExposureSettingsBuffer: GPUBuffer | null = null;
  /** Zeroed histogram scratch data reused per-frame. */
  private readonly autoExposureHistogramClearData = new Uint32Array(AUTO_EXPOSURE_HISTOGRAM_BINS);
  /**
   * Per-level Kawase uniform buffers (srcTexelSize for each pyramid level).
   * Index i holds the texel size of mip level i.
   * Created on initialize/resize; maximum MAX_BLOOM_LEVELS entries.
   */
  private bloomKawaseBuffers: GPUBuffer[] = [];
  private dofConfig: DepthOfFieldQualitySettings = { ...DEFAULT_DOF_CONFIG };
  private dofFocusDistanceKm = 1000;
  private atmosphereScattering: AtmosphereScatteringConfig = { ...DEFAULT_ATMOSPHERE_SCATTERING };
  private exposureSettings: ExposureSettingsConfig = { ...DEFAULT_EXPOSURE_SETTINGS };
  private motionBlurConfig: MotionBlurConfig = { ...DEFAULT_MOTION_BLUR_CONFIG };
  private readonly prevViewProjection = new Float32Array(16);
  private motionBlurHistoryReady = false;
  private atmosphereLUT: GPUTexture | null = null;
  private atmosphereLUTView: GPUTextureView | null = null;

  /** Bind group for the skyline city pass (Uni + CityUni + buildings storage). */
  private skylineBindGroup: GPUBindGroup | null = null;

  /** Maximum supported pyramid levels */
  private static readonly MAX_BLOOM_LEVELS = 5;

  /** Minimum meaningful pyramid levels (need at least 2 for the Kawase dual-filter to work) */
  private static readonly MIN_BLOOM_LEVELS = 2;

  constructor(context: WebGPUContext, buffers: SatelliteBufferSet) {
    this.context = context;
    this.buffers = buffers;
    this.linearSampler = context.createLinearSampler();
  }

  /**
   * Initialize all pipelines and render targets
   */
  initialize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.motionBlurHistoryReady = false;
    
    console.log(`[RenderPipeline] Initializing ${width}x${height}`);
    
    this.createBloomUniformBuffers(width, height);
    this.createPipelines();
    this.createRenderTargets(width, height);
    this.createAtmosphereLUT();
    this.createBindGroups();
    
    // Initialize Smile V2 pipeline
    this.smileV2Pipeline = new SmileV2Pipeline(this.context, this.buffers);
    this.smileV2Pipeline.initialize();
    
    console.log('[RenderPipeline] Initialization complete');
  }

  /**
   * Create all shader pipelines
   */
  private createPipelines(): void {
    const device = this.context.getDevice();
    
    // Compute pipeline layout
    const computeLayout = device.createPipelineLayout({
      bindGroupLayouts: [
        device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
          ],
        }),
      ],
    });

    // Uniform-only render layout
    const uniformLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    // Shared scene atmosphere layout (uniform + LUT + sampler + settings)
    const sceneAtmosphereLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    // Satellite layout: uniform + positions + per-satellite color buffer + pattern params
    const satelliteLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 4, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    // Bloom layout (Kawase downsample + upsample + legacy blur)
    const bloomLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });

    // Threshold layout (texture + sampler + ThresholdUni)
    const thresholdLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    // Composite layout (binding 3 = shared Uni for film grain, binding 4 = BloomCompositeUni)
    const compositeLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 6, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    const autoExposureHistogramLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    const autoExposureAdaptLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });

    const dofDownsampleLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    const dofBlurLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });

    const dofCompositeLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    // Skyline city layout: shared Uni + CityUni + read-only buildings storage
    const skylineLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    });

    const motionBlurLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      ],
    });

    // Earth vertex buffer layout
    const earthVertexLayout: GPUVertexBufferLayout = {
      arrayStride: 24,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' },
      ],
    };

    // HDR blend state (unused but kept for reference)
    // const hdrBlend: GPUBlendState = {
    //   color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    //   alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    // };

    // Additive blend state
    const additiveBlend: GPUBlendState = {
      color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    };

    // Beam compute bind group layout (includes beamParams uniform)
    const beamComputeLayout = device.createPipelineLayout({
      bindGroupLayouts: [
        device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
          ],
        }),
      ],
    });

    // Beam render bind group layout (same as satellites - uniform + storage)
    const beamRenderLayout = device.createPipelineLayout({
      bindGroupLayouts: [
        device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
          ],
        }),
      ],
    });

    // Create pipelines
    this.pipelines = {
      compute: device.createComputePipeline({
        layout: computeLayout,
        compute: {
          module: this.context.createShaderModule(SHADERS.compute.orbital, 'orbital'),
          entryPoint: 'main',
        },
      }),

      beamCompute: device.createComputePipeline({
        layout: beamComputeLayout,
        compute: {
          module: this.context.createShaderModule(SHADERS.compute.beam, 'beam-compute'),
          entryPoint: 'main',
        },
      }),
      autoExposureHistogram: device.createComputePipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [autoExposureHistogramLayout] }),
        compute: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.autoExposureHistogram, 'auto-exposure-histogram'),
          entryPoint: 'main',
        },
      }),
      autoExposureAdapt: device.createComputePipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [autoExposureAdaptLayout] }),
        compute: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.autoExposureAdapt, 'auto-exposure-adapt'),
          entryPoint: 'main',
        },
      }),

      stars: device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [sceneAtmosphereLayout] }),
        vertex: {
          module: this.context.createShaderModule(SHADERS.render.stars, 'stars'),
          entryPoint: 'vs',
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.render.stars, 'stars'),
          entryPoint: 'fs',
          targets: [{ format: RENDER.HDR_FORMAT }],
        },
        primitive: { topology: 'triangle-list' },
        depthStencil: {
          format: RENDER.DEPTH_FORMAT,
          depthWriteEnabled: false,
          depthCompare: 'always',
        },
      }),

      earth: device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [sceneAtmosphereLayout] }),
        vertex: {
          module: this.context.createShaderModule(SHADERS.render.earth, 'earth'),
          entryPoint: 'vs',
          buffers: [earthVertexLayout],
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.render.earth, 'earth'),
          entryPoint: 'fs',
          targets: [{ format: RENDER.HDR_FORMAT }],
        },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        depthStencil: {
          format: RENDER.DEPTH_FORMAT,
          depthWriteEnabled: true,
          depthCompare: 'less',
        },
      }),

      atmosphere: device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [sceneAtmosphereLayout] }),
        vertex: {
          module: this.context.createShaderModule(SHADERS.render.atmosphere, 'atmosphere'),
          entryPoint: 'vs',
          buffers: [earthVertexLayout],
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.render.atmosphere, 'atmosphere'),
          entryPoint: 'fs',
          targets: [{ format: RENDER.HDR_FORMAT, blend: additiveBlend }],
        },
        primitive: { topology: 'triangle-list', cullMode: 'front' },
        depthStencil: {
          format: RENDER.DEPTH_FORMAT,
          depthWriteEnabled: false,
          depthCompare: 'less',
        },
      }),

      satellites: device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [satelliteLayout] }),
        vertex: {
          module: this.context.createShaderModule(SHADERS.render.satellites, 'satellites'),
          entryPoint: 'vs',
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.render.satellites, 'satellites'),
          entryPoint: 'fs',
          targets: [{ format: RENDER.HDR_FORMAT, blend: additiveBlend }],
        },
        primitive: { topology: 'triangle-list' },
        depthStencil: {
          format: RENDER.DEPTH_FORMAT,
          depthWriteEnabled: false,
          depthCompare: 'less',
        },
      }),

      beam: device.createRenderPipeline({
        layout: beamRenderLayout,
        vertex: {
          module: this.context.createShaderModule(SHADERS.render.beam, 'beam-render'),
          entryPoint: 'vs',
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.render.beam, 'beam-render'),
          entryPoint: 'fs',
          targets: [{ format: RENDER.HDR_FORMAT, blend: additiveBlend }],
        },
        primitive: { 
          topology: 'triangle-strip',
        },
        depthStencil: {
          format: RENDER.DEPTH_FORMAT,
          depthWriteEnabled: false,
          depthCompare: 'less',
        },
      }),

      groundTerrain: device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [uniformLayout] }),
        vertex: {
          module: this.context.createShaderModule(SHADERS.render.ground, 'ground-terrain'),
          entryPoint: 'vs',
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.render.ground, 'ground-terrain'),
          entryPoint: 'fs',
          targets: [{ 
            format: RENDER.HDR_FORMAT,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          }],
        },
        primitive: { topology: 'triangle-list' },
        depthStencil: {
          format: RENDER.DEPTH_FORMAT,
          depthWriteEnabled: false,
          depthCompare: 'always',
        },
      }),

      skyline: device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [skylineLayout] }),
        vertex: {
          module: this.context.createShaderModule(SHADERS.render.skyline, 'skyline-city'),
          entryPoint: 'vs',
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.render.skyline, 'skyline-city'),
          entryPoint: 'fs',
          targets: [{ format: RENDER.HDR_FORMAT }],
        },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: {
          format: RENDER.DEPTH_FORMAT,
          depthWriteEnabled: true,
          depthCompare: 'less',
        },
      }),

      bloomThreshold: device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [thresholdLayout] }),
        vertex: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.bloomThreshold, 'bloom-threshold'),
          entryPoint: 'vs',
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.bloomThreshold, 'bloom-threshold'),
          entryPoint: 'fs',
          targets: [{ format: RENDER.HDR_FORMAT }],
        },
        primitive: { topology: 'triangle-list' },
      }),

      bloomBlur: device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bloomLayout] }),
        vertex: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.bloomBlur, 'bloom-blur'),
          entryPoint: 'vs',
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.bloomBlur, 'bloom-blur'),
          entryPoint: 'fs',
          targets: [{ format: RENDER.HDR_FORMAT }],
        },
        primitive: { topology: 'triangle-list' },
      }),

      bloomDownsample: device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bloomLayout] }),
        vertex: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.bloomDownsample, 'bloom-downsample'),
          entryPoint: 'vs',
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.bloomDownsample, 'bloom-downsample'),
          entryPoint: 'fs',
          targets: [{ format: RENDER.HDR_FORMAT }],
        },
        primitive: { topology: 'triangle-list' },
      }),

      bloomUpsample: device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bloomLayout] }),
        vertex: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.bloomUpsample, 'bloom-upsample'),
          entryPoint: 'vs',
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.bloomUpsample, 'bloom-upsample'),
          entryPoint: 'fs',
          // Additive blend: each upsample level accumulates onto the target
          targets: [{
            format: RENDER.HDR_FORMAT,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            },
          }],
        },
        primitive: { topology: 'triangle-list' },
      }),

      composite: device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [compositeLayout] }),
        vertex: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.composite, 'composite'),
          entryPoint: 'vs',
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.composite, 'composite'),
          entryPoint: 'fs',
          targets: [{ format: this.context.getFormat() }],
        },
        primitive: { topology: 'triangle-list' },
      }),
      dofDownsample: device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [dofDownsampleLayout] }),
        vertex: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.dofDownsample, 'dof-downsample'),
          entryPoint: 'vs',
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.dofDownsample, 'dof-downsample'),
          entryPoint: 'fs',
          targets: [{ format: RENDER.HDR_FORMAT }],
        },
        primitive: { topology: 'triangle-list' },
      }),
      dofBlurH: device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [dofBlurLayout] }),
        vertex: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.dofBlur, 'dof-blur'),
          entryPoint: 'vs',
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.dofBlur, 'dof-blur'),
          entryPoint: 'fsHorizontal',
          targets: [{ format: RENDER.HDR_FORMAT }],
        },
        primitive: { topology: 'triangle-list' },
      }),
      dofBlurV: device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [dofBlurLayout] }),
        vertex: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.dofBlur, 'dof-blur'),
          entryPoint: 'vs',
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.dofBlur, 'dof-blur'),
          entryPoint: 'fsVertical',
          targets: [{ format: RENDER.HDR_FORMAT }],
        },
        primitive: { topology: 'triangle-list' },
      }),
      dofComposite: device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [dofCompositeLayout] }),
        vertex: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.dofComposite, 'dof-composite'),
          entryPoint: 'vs',
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.dofComposite, 'dof-composite'),
          entryPoint: 'fs',
          targets: [{ format: RENDER.HDR_FORMAT }],
        },
        primitive: { topology: 'triangle-list' },
      }),
      motionBlur: device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [motionBlurLayout] }),
        vertex: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.motionBlur, 'motion-blur'),
          entryPoint: 'vs',
        },
        fragment: {
          module: this.context.createShaderModule(SHADERS.render.postProcess.motionBlur, 'motion-blur'),
          entryPoint: 'fs',
          targets: [{ format: 'rgba16float' }],
        },
        primitive: { topology: 'triangle-list' },
      }),
    };
  }

  /**
   * Create render targets for HDR pipeline
   */
  private createRenderTargets(width: number, height: number): void {
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

  /**
   * Create bind groups for all pipelines
   */
  private createBindGroups(): void {
    if (!this.pipelines || !this.renderTargets) return;
    if (!this.bloomThresholdUniformBuffer || !this.bloomCompositeUniformBuffer || !this.tonemapUniformBuffer) return;
    if (!this.motionBlurUniformBuffer) return;
    if (!this.atmosphereLUTView || !this.atmosphereSettingsBuffer) return;
    if (!this.autoExposureStateBuffer) return;

    const device = this.context.getDevice();
    const posBuffer = this.buffers.positions instanceof GPUBuffer
    ? this.buffers.positions
    : (this.buffers.positions as { read: GPUBuffer }).read;

    // The bloom pyramid result is in mip[0] (1/2 res) after the upsample passes.
    const bloomResultView = this.renderTargets.bloomMipViews[0];

    this.bindGroups = {
    compute: device.createBindGroup({
      layout: this.pipelines.compute.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.buffers.uniforms } },
        { binding: 1, resource: { buffer: this.buffers.orbitalElements } },
        { binding: 2, resource: { buffer: this.buffers.extendedElements } },
        { binding: 3, resource: { buffer: posBuffer } },
      ],
    }),

    beamCompute: device.createBindGroup({
      layout: this.pipelines.beamCompute.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.buffers.uniforms } },
        { binding: 1, resource: { buffer: posBuffer } },
        { binding: 2, resource: { buffer: this.buffers.beams } },
        { binding: 3, resource: { buffer: this.buffers.beamParams } },
      ],
    }),

    stars: device.createBindGroup({
      layout: this.pipelines.stars.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.buffers.uniforms } },
        { binding: 1, resource: this.atmosphereLUTView },
        { binding: 2, resource: this.linearSampler },
        { binding: 3, resource: { buffer: this.atmosphereSettingsBuffer } },
      ],
    }),

    earth: device.createBindGroup({
      layout: this.pipelines.earth.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.buffers.uniforms } },
        { binding: 1, resource: this.atmosphereLUTView },
        { binding: 2, resource: this.linearSampler },
        { binding: 3, resource: { buffer: this.atmosphereSettingsBuffer } },
      ],
    }),

    atmosphere: device.createBindGroup({
      layout: this.pipelines.atmosphere.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.buffers.uniforms } },
        { binding: 1, resource: this.atmosphereLUTView },
        { binding: 2, resource: this.linearSampler },
        { binding: 3, resource: { buffer: this.atmosphereSettingsBuffer } },
      ],
    }),

    satellites: device.createBindGroup({
      layout: this.pipelines.satellites.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.buffers.uniforms } },
        { binding: 1, resource: { buffer: posBuffer } },
        { binding: 2, resource: { buffer: this.buffers.colors } },
        { binding: 3, resource: { buffer: this.buffers.patternParams } },
        { binding: 4, resource: { buffer: this.motionBlurUniformBuffer } },
        { binding: 5, resource: { buffer: this.satelliteVisualUniformBuffer! } },
      ],
    }),

    beam: device.createBindGroup({
      layout: this.pipelines.beam.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.buffers.uniforms } },
        { binding: 1, resource: { buffer: this.buffers.beams } },
      ],
    }),

    groundTerrain: device.createBindGroup({
      layout: this.pipelines.groundTerrain.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.buffers.uniforms } }],
    }),

    bloomThreshold: device.createBindGroup({
      layout: this.pipelines.bloomThreshold.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.renderTargets.hdrView },
        { binding: 1, resource: this.linearSampler },
        { binding: 2, resource: { buffer: this.bloomThresholdUniformBuffer } },
      ],
    }),

    composite: device.createBindGroup({
      layout: this.pipelines.composite.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.renderTargets.hdrView },
        { binding: 1, resource: bloomResultView },
        { binding: 2, resource: this.linearSampler },
        { binding: 3, resource: { buffer: this.buffers.uniforms } },
        { binding: 4, resource: { buffer: this.bloomCompositeUniformBuffer } },
        { binding: 5, resource: { buffer: this.autoExposureStateBuffer } },
        { binding: 6, resource: { buffer: this.tonemapUniformBuffer } },
      ],
    }),
    };
  }

  /**
   * Handle resize
   */
  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    
    this.width = width;
    this.height = height;
    
    console.log(`[RenderPipeline] Resized to ${width}x${height}`);
    
    // Destroy old textures
    this.renderTargets?.hdr.destroy();
    this.renderTargets?.depth.destroy();
    this.renderTargets?.bloomA.destroy();
    this.renderTargets?.bloomB.destroy();
    this.renderTargets?.motionBlur.destroy();
    this.renderTargets?.dofHalfA.destroy();
    this.renderTargets?.dofHalfB.destroy();
    this.renderTargets?.dofComposite.destroy();
    this.renderTargets?.bloomMip.forEach(t => t.destroy());
    this.renderTargets?.compositeIntermediate.destroy();

    // Recreate Kawase uniform buffers for new dimensions
    this.bloomKawaseBuffers.forEach(b => b.destroy());
    this.bloomKawaseBuffers = [];
    this.motionBlurHistoryReady = false;
    this.createBloomUniformBuffers(width, height);

    // Recreate render targets + bind groups
    this.createRenderTargets(width, height);
    this.createBindGroups();
  }

  /**
   * Execute compute pass
   */
  encodeComputePass(encoder: GPUCommandEncoder): void {
    if (!this.pipelines || !this.bindGroups) return;
    
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.compute);
    pass.setBindGroup(0, this.bindGroups.compute);
    pass.dispatchWorkgroups(Math.ceil(CONSTANTS.NUM_SATELLITES / RENDER.WORKGROUP_SIZE));
    pass.end();
  }

  /**
   * Execute beam compute pass
   */
  encodeBeamComputePass(encoder: GPUCommandEncoder): void {
    if (!this.pipelines || !this.bindGroups) return;
    
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.beamCompute);
    pass.setBindGroup(0, this.bindGroups.beamCompute);
    pass.dispatchWorkgroups(Math.ceil(MAX_BEAMS / 256));
    pass.end();
  }

  /**
   * Execute Smile V2 compute pass
   * Inserted between compute and bloom passes
   */
  encodeSmileV2Pass(encoder: GPUCommandEncoder): void {
    if (!this.smileV2Pipeline || !this.smileV2Pipeline.isActive()) {
      return;
    }
    
    this.smileV2Pipeline.encodeComputePass(encoder);
  }

  /**
   * Get the Smile V2 pipeline for external control
   */
  getSmileV2Pipeline(): SmileV2Pipeline | null {
    return this.smileV2Pipeline;
  }

  /**
   * Execute scene render pass
   */
  encodeScenePass(
    encoder: GPUCommandEncoder,
    earthVertexBuffer: GPUBuffer,
    earthIndexBuffer: GPUBuffer,
    earthIndexCount: number
  ): void {
    if (!this.pipelines || !this.bindGroups || !this.renderTargets) return;

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.renderTargets.hdrView,
        clearValue: { r: 0, g: 0, b: 0.02, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.renderTargets.depthView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    // Set full canvas viewport to ensure entire framebuffer is rendered
    pass.setViewport(0, 0, this.width, this.height, 0, 1);

    // Stars
    pass.setPipeline(this.pipelines.stars);
    pass.setBindGroup(0, this.bindGroups.stars);
    pass.draw(3);

    // Earth
    pass.setPipeline(this.pipelines.earth);
    pass.setBindGroup(0, this.bindGroups.earth);
    pass.setVertexBuffer(0, earthVertexBuffer);
    pass.setIndexBuffer(earthIndexBuffer, 'uint32');
    pass.drawIndexed(earthIndexCount);

    // Atmosphere
    pass.setPipeline(this.pipelines.atmosphere);
    pass.setBindGroup(0, this.bindGroups.atmosphere);
    pass.setVertexBuffer(0, earthVertexBuffer);
    pass.setIndexBuffer(earthIndexBuffer, 'uint32');
    pass.drawIndexed(earthIndexCount);

    // Satellites
    pass.setPipeline(this.pipelines.satellites);
    pass.setBindGroup(0, this.bindGroups.satellites);
    pass.draw(6, CONSTANTS.NUM_SATELLITES);

    // Laser beams (65k beams, 4 verts each via triangle strip)
    pass.setPipeline(this.pipelines.beam);
    pass.setBindGroup(0, this.bindGroups.beam);
    pass.draw(4, MAX_BEAMS);

    pass.end();
  }

  /**
   * Execute additive trail render pass onto the HDR target.
   */
  encodeTrailPass(encoder: GPUCommandEncoder, trailRenderer: { encodeRenderPass(pass: GPURenderPassEncoder, uniformBuffer: GPUBuffer): void } | null): void {
    if (!this.renderTargets || !trailRenderer) return;

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.renderTargets.hdrView,
        loadOp: 'load',
        storeOp: 'store',
      }],
    });

    pass.setViewport(0, 0, this.width, this.height, 0, 1);
    trailRenderer.encodeRenderPass(pass, this.buffers.uniforms);
    pass.end();
  }

  /**
   * Execute ground view scene render pass (mountains, lake, satellites, beams)
   */
  encodeGroundScenePass(
    encoder: GPUCommandEncoder,
    earthAtmosphereRenderer?: EarthAtmosphereRenderer,
    earthVertexBuffer?: GPUBuffer,
    earthIndexBuffer?: GPUBuffer,
    earthIndexCount?: number
  ): void {
    if (!this.pipelines || !this.bindGroups || !this.renderTargets) return;

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.renderTargets.hdrView,
        clearValue: { r: 0, g: 0, b: 0.02, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.renderTargets.depthView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    pass.setViewport(0, 0, this.width, this.height, 0, 1);

    if (earthAtmosphereRenderer && earthAtmosphereRenderer.getEnabled() && earthVertexBuffer && earthIndexBuffer && earthIndexCount) {
      pass.setPipeline(this.pipelines.earth);
      pass.setBindGroup(0, this.bindGroups.earth);
      pass.setVertexBuffer(0, earthVertexBuffer);
      pass.setIndexBuffer(earthIndexBuffer, 'uint32');
      pass.drawIndexed(earthIndexCount);

      earthAtmosphereRenderer.encode(pass, earthVertexBuffer, earthIndexBuffer, earthIndexCount);
    } else {
      pass.setPipeline(this.pipelines.groundTerrain);
      pass.setBindGroup(0, this.bindGroups.groundTerrain);
      pass.draw(6);
    }

    pass.setPipeline(this.pipelines.satellites);
    pass.setBindGroup(0, this.bindGroups.satellites);
    pass.draw(6, CONSTANTS.NUM_SATELLITES);

    pass.setPipeline(this.pipelines.beam);
    pass.setBindGroup(0, this.bindGroups.beam);
    pass.draw(4, MAX_BEAMS);

    pass.end();
  }

  /**
   * Lazily build the bind group for the skyline city pass.
   * Called once the SkylineCity's GPU buffers exist.
   */
  setSkylineResources(cityUniformBuffer: GPUBuffer, instanceBuffer: GPUBuffer): void {
    if (!this.pipelines) return;
    if (this.skylineBindGroup) return;

    const device = this.context.getDevice();
    this.skylineBindGroup = device.createBindGroup({
      layout: this.pipelines.skyline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.buffers.uniforms } },
        { binding: 1, resource: { buffer: cityUniformBuffer } },
        { binding: 2, resource: { buffer: instanceBuffer } },
      ],
    });
  }

  /**
   * Execute the skyline city pass: instanced extruded-box buildings drawn
   * into the shared HDR target with their own near-tuned projection.
   *
   * Loads (rather than clears) the HDR color so the buildings layer on top
   * of whatever the scene pass already rendered, but uses a FRESH depth
   * clear and its own near/far range — the city is sub-kilometer in scale
   * and must not share the global planetary frustum's depth precision.
   */
  encodeSkylinePass(encoder: GPUCommandEncoder, buildingCount: number): void {
    if (!this.pipelines || !this.renderTargets || !this.skylineBindGroup) return;

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.renderTargets.hdrView,
        loadOp: 'load',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.renderTargets.depthView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    pass.setViewport(0, 0, this.width, this.height, 0, 1);
    pass.setPipeline(this.pipelines.skyline);
    pass.setBindGroup(0, this.skylineBindGroup);
    pass.draw(36, buildingCount);
    pass.end();
  }

  /**
   * Execute bloom passes — multi-resolution Kawase pyramid.
   *
   * Pass sequence:
   *   1. Threshold pass  → bloomA (full res, bright-pass with soft knee)
   *   2. Downsample chain: bloomA → mip[0] → mip[1] → … → mip[levels-1]
   *   3. Upsample chain (additive):  mip[levels-1] → mip[levels-2] → … → mip[0]
   *
   * The composite pass reads from mip[0] (half res) as the final bloom result.
   */
  encodeBloomPasses(encoder: GPUCommandEncoder, sceneSourceView?: GPUTextureView): void {
    if (!this.pipelines || !this.bindGroups || !this.renderTargets) return;
    if (this.bloomKawaseBuffers.length === 0) return;

    const device = this.context.getDevice();
    const levels = Math.min(
      Math.max(RenderPipeline.MIN_BLOOM_LEVELS, this.bloomConfig.levels),
      RenderPipeline.MAX_BLOOM_LEVELS
    );

    // Validate that all required GPU resources exist for the requested level count.
    for (let i = 0; i < levels; i++) {
      if (!this.renderTargets.bloomMip[i] || !this.bloomKawaseBuffers[i]) {
        console.warn(`[RenderPipeline] Bloom mip level ${i} resource missing — bloom pass skipped.`);
        return;
      }
    }

    const thresholdBindGroup = sceneSourceView
      ? this.createBloomThresholdBindGroup(sceneSourceView)
      : this.bindGroups.bloomThreshold;

    // ── 1. Threshold pass ────────────────────────────────────────────────────
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.renderTargets.bloomAView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.setViewport(0, 0, this.width, this.height, 0, 1);
      pass.setPipeline(this.pipelines.bloomThreshold);
      pass.setBindGroup(0, thresholdBindGroup);
      pass.draw(3);
      pass.end();
    }

    // ── 2. Downsample chain ──────────────────────────────────────────────────
    // Level 0: bloomA (full res) → mip[0]  (1/2 res)
    // Level i: mip[i-1]         → mip[i]
    const srcViews: GPUTextureView[] = [this.renderTargets.bloomAView, ...this.renderTargets.bloomMipViews];
    const dstViews: GPUTextureView[] = this.renderTargets.bloomMipViews;

    for (let i = 0; i < levels; i++) {
      const mip = this.renderTargets.bloomMip[i];
      const kawaseBuf = this.bloomKawaseBuffers[i];
      if (!mip || !kawaseBuf) break;

      const bg = device.createBindGroup({
        layout: this.pipelines.bloomDownsample.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: kawaseBuf } },
          { binding: 1, resource: srcViews[i] },
          { binding: 2, resource: this.linearSampler },
        ],
      });

      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: dstViews[i],
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.setViewport(0, 0, mip.width, mip.height, 0, 1);
      pass.setPipeline(this.pipelines.bloomDownsample);
      pass.setBindGroup(0, bg);
      pass.draw(3);
      pass.end();
    }

    // ── 3. Upsample chain (additive blend) ───────────────────────────────────
    // Levels are accumulated from the bottom of the pyramid up.
    // mip[levels-1] → mip[levels-2] → … → mip[0]
    for (let i = levels - 1; i > 0; i--) {
      const srcMip = this.renderTargets.bloomMip[i];
      const dstMip = this.renderTargets.bloomMip[i - 1];
      const kawaseBuf = this.bloomKawaseBuffers[i];
      if (!srcMip || !dstMip || !kawaseBuf) break;

      const bg = device.createBindGroup({
        layout: this.pipelines.bloomUpsample.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: kawaseBuf } },
          { binding: 1, resource: this.renderTargets.bloomMipViews[i] },
          { binding: 2, resource: this.linearSampler },
        ],
      });

      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.renderTargets.bloomMipViews[i - 1],
          // loadOp 'load' to preserve the existing downsampled content and
          // let the GPU additive blend state accumulate on top of it.
          loadOp: 'load',
          storeOp: 'store',
        }],
      });
      pass.setViewport(0, 0, dstMip.width, dstMip.height, 0, 1);
      pass.setPipeline(this.pipelines.bloomUpsample);
      pass.setBindGroup(0, bg);
      pass.draw(3);
      pass.end();
    }
  }

  encodeAutoExposurePasses(
    encoder: GPUCommandEncoder,
    sceneSourceView: GPUTextureView,
    deltaTime: number
  ): void {
    if (
      !this.pipelines ||
      !this.autoExposureHistogramBuffer ||
      !this.autoExposureStateBuffer ||
      !this.autoExposureSettingsBuffer
    ) {
      return;
    }

    this.writeAutoExposureSettingsUniform(deltaTime);
    if (!this.exposureSettings.autoEnabled) {
      return;
    }

    const device = this.context.getDevice();
    device.queue.writeBuffer(this.autoExposureHistogramBuffer, 0, this.autoExposureHistogramClearData);

    const histogramBG = device.createBindGroup({
      layout: this.pipelines.autoExposureHistogram.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sceneSourceView },
        { binding: 1, resource: { buffer: this.autoExposureHistogramBuffer } },
      ],
    });

    const adaptBG = device.createBindGroup({
      layout: this.pipelines.autoExposureAdapt.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.autoExposureHistogramBuffer } },
        { binding: 1, resource: { buffer: this.autoExposureStateBuffer } },
        { binding: 2, resource: { buffer: this.autoExposureSettingsBuffer } },
      ],
    });

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.autoExposureHistogram);
    pass.setBindGroup(0, histogramBG);
    pass.dispatchWorkgroups(Math.ceil(this.width / 16), Math.ceil(this.height / 16));
    pass.setPipeline(this.pipelines.autoExposureAdapt);
    pass.setBindGroup(0, adaptBG);
    pass.dispatchWorkgroups(1, 1, 1);
    pass.end();
  }

  /**
   * Execute composite pass
   */
  encodeCompositePass(
    encoder: GPUCommandEncoder,
    outputView: GPUTextureView,
    outputWidth?: number,
    outputHeight?: number,
    sceneSourceView?: GPUTextureView
  ): void {
    if (!this.pipelines || !this.bindGroups) return;
    const compositeBindGroup = sceneSourceView
      ? this.createCompositeBindGroup(sceneSourceView)
      : this.bindGroups.composite;

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: outputView,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    // Use provided dimensions or fall back to stored dimensions
    const width = outputWidth || this.width;
    const height = outputHeight || this.height;
    pass.setViewport(0, 0, width, height, 0, 1);

    pass.setPipeline(this.pipelines.composite);
    pass.setBindGroup(0, compositeBindGroup);
    pass.draw(3);
    pass.end();
  }

  /**
   * Get the intermediate composite texture view.
   * When PostProcessStack is active the composite pass writes to this texture
   * instead of the swapchain, and PostProcessStack samples from it.
   */
  getCompositeIntermediateView(): GPUTextureView {
    if (!this.renderTargets) {
      throw new Error('RenderPipeline not initialized');
    }
    return this.renderTargets.compositeIntermediateView;
  }

  /**
   * Get the HDR render target view.
   * Used by the volumetric beam renderer to composite god-ray results
   * additively into the scene after the main render pass.
   */
  getHDRView(): GPUTextureView {
    if (!this.renderTargets) {
      throw new Error('RenderPipeline not initialized');
    }
    return this.renderTargets.hdrView;
  }

  /**
   * Get render targets
   */
  getRenderTargets(): RenderTargets | null {
    return this.renderTargets;
  }

  /**
   * Apply DoF passes and return the scene texture view that should feed bloom/composite.
   */
  encodeDepthOfFieldPasses(encoder: GPUCommandEncoder): GPUTextureView {
    if (!this.pipelines || !this.renderTargets || !this.dofConfig.enabled || !this.dofUniformBuffer) {
      if (!this.renderTargets) throw new Error('RenderPipeline not initialized');
      return this.renderTargets.hdrView;
    }

    const device = this.context.getDevice();
    const halfWidth = Math.max(1, Math.floor(this.width / 2));
    const halfHeight = Math.max(1, Math.floor(this.height / 2));

    const downsampleBG = device.createBindGroup({
      layout: this.pipelines.dofDownsample.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.renderTargets.hdrView },
        { binding: 1, resource: this.renderTargets.depthView },
        { binding: 2, resource: this.linearSampler },
        { binding: 3, resource: { buffer: this.dofUniformBuffer } },
      ],
    });
    const blurHBG = device.createBindGroup({
      layout: this.pipelines.dofBlurH.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.dofUniformBuffer } },
        { binding: 1, resource: this.renderTargets.dofHalfAView },
        { binding: 2, resource: this.linearSampler },
      ],
    });
    const blurVBG = device.createBindGroup({
      layout: this.pipelines.dofBlurV.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.dofUniformBuffer } },
        { binding: 1, resource: this.renderTargets.dofHalfBView },
        { binding: 2, resource: this.linearSampler },
      ],
    });
    const compositeBG = device.createBindGroup({
      layout: this.pipelines.dofComposite.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.renderTargets.hdrView },
        { binding: 1, resource: this.renderTargets.dofHalfAView },
        { binding: 2, resource: this.linearSampler },
        { binding: 3, resource: { buffer: this.dofUniformBuffer } },
      ],
    });

    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.renderTargets.dofHalfAView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.setViewport(0, 0, halfWidth, halfHeight, 0, 1);
      pass.setPipeline(this.pipelines.dofDownsample);
      pass.setBindGroup(0, downsampleBG);
      pass.draw(3);
      pass.end();
    }
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.renderTargets.dofHalfBView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.setViewport(0, 0, halfWidth, halfHeight, 0, 1);
      pass.setPipeline(this.pipelines.dofBlurH);
      pass.setBindGroup(0, blurHBG);
      pass.draw(3);
      pass.end();
    }
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.renderTargets.dofHalfAView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.setViewport(0, 0, halfWidth, halfHeight, 0, 1);
      pass.setPipeline(this.pipelines.dofBlurV);
      pass.setBindGroup(0, blurVBG);
      pass.draw(3);
      pass.end();
    }
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.renderTargets.dofCompositeView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.setViewport(0, 0, this.width, this.height, 0, 1);
      pass.setPipeline(this.pipelines.dofComposite);
      pass.setBindGroup(0, compositeBG);
      pass.draw(3);
      pass.end();
    }

    return this.renderTargets.dofCompositeView;
  }

  /**
   * Execute screen-space motion blur pass.
   * Returns the source view when disabled so downstream passes can consume one texture path.
   */
  encodeMotionBlurPass(encoder: GPUCommandEncoder, sourceView: GPUTextureView): GPUTextureView {
    if (!this.renderTargets || !this.pipelines || !this.motionBlurUniformBuffer) return sourceView;
    if (!this.motionBlurConfig.enabled || this.motionBlurConfig.cameraStrength <= 0.0) return sourceView;

    const bindGroup = this.context.getDevice().createBindGroup({
      layout: this.pipelines.motionBlur.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sourceView },
        { binding: 1, resource: this.renderTargets.depthView },
        { binding: 2, resource: this.linearSampler },
        { binding: 3, resource: { buffer: this.motionBlurUniformBuffer } },
      ],
    });

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.renderTargets.motionBlurView,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setViewport(0, 0, this.width, this.height, 0, 1);
    pass.setPipeline(this.pipelines.motionBlur);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();

    return this.renderTargets.motionBlurView;
  }

  setAtmosphereScatteringConfig(enabled: boolean, hazeStrength: number): void {
    this.atmosphereScattering.enabled = enabled;
    this.atmosphereScattering.hazeStrength = Math.max(0.0, hazeStrength);
    this.writeAtmosphereScatteringUniform();
  }

  setDepthOfFieldConfig(config: DepthOfFieldQualitySettings): void {
    this.dofConfig = { ...config };
    this.dofFocusDistanceKm = Math.max(1, this.dofConfig.surfaceDistanceKm || this.dofFocusDistanceKm || 1000);
    this.writeDofUniform();
  }

  updateDepthOfFieldFocus(
    cameraPosition: readonly [number, number, number],
    selectedSatelliteIndex: number,
    time: number,
    deltaTime: number,
    getSatellitePosition: (index: number, timeSeconds: number) => readonly [number, number, number]
  ): void {
    if (!this.dofConfig.enabled) return;

    let target = this.dofFocusDistanceKm;
    switch (this.dofConfig.focusMode) {
      case 'satellite-track':
        if (selectedSatelliteIndex >= 0) {
          const pos = getSatellitePosition(selectedSatelliteIndex, time);
          const dx = pos[0] - cameraPosition[0];
          const dy = pos[1] - cameraPosition[1];
          const dz = pos[2] - cameraPosition[2];
          target = Math.max(1, Math.sqrt(dx * dx + dy * dy + dz * dz));
          break;
        }
        target = this.dofFocusDistanceKm;
        break;
      case 'surface-distance':
        target = Math.max(1, this.dofConfig.surfaceDistanceKm);
        break;
      case 'earth-center':
        target = Math.max(
          1,
          Math.sqrt(
            cameraPosition[0] * cameraPosition[0] +
            cameraPosition[1] * cameraPosition[1] +
            cameraPosition[2] * cameraPosition[2]
          )
        );
        break;
      case 'auto-center':
      default:
        target = this.dofFocusDistanceKm;
        break;
    }

    const blend = 1.0 - Math.exp(-Math.max(0.1, this.dofConfig.transitionRate) * Math.max(deltaTime, 0.0));
    this.dofFocusDistanceKm += (target - this.dofFocusDistanceKm) * blend;
    this.writeDofUniform();
  }

  setMotionBlurConfig(config: Partial<MotionBlurConfig>): void {
    this.motionBlurConfig = {
      ...this.motionBlurConfig,
      ...config,
      cameraStrength: Math.max(0.0, Math.min(2.0, config.cameraStrength ?? this.motionBlurConfig.cameraStrength)),
      satelliteStretch: Math.max(0.0, Math.min(2.0, config.satelliteStretch ?? this.motionBlurConfig.satelliteStretch)),
      tapCount: Math.max(1, Math.min(16, Math.floor(config.tapCount ?? this.motionBlurConfig.tapCount))),
    };
  }

  setMotionBlurFrameData(viewProjection: Float32Array, inverseViewProjection: Float32Array, viewModeIndex: number, deltaTime: number): void {
    if (!this.motionBlurUniformBuffer) return;

    if (!this.motionBlurHistoryReady) {
      this.prevViewProjection.set(viewProjection);
      this.motionBlurHistoryReady = true;
    }

    const viewModeScale = [0.55, 0.7, 1.0, 0.08, 0.22, 0.08];
    const viewWeight = viewModeScale[viewModeIndex] ?? 0.5;
    const cameraStrength = this.motionBlurConfig.enabled ? this.motionBlurConfig.cameraStrength * viewWeight : 0.0;
    const satelliteStretch = this.motionBlurConfig.enabled ? this.motionBlurConfig.satelliteStretch * viewWeight : 0.0;

    const data = new ArrayBuffer(144);
    const f32 = new Float32Array(data);
    const u32 = new Uint32Array(data);
    f32.set(this.prevViewProjection, 0);
    f32.set(inverseViewProjection, 16);
    f32[32] = cameraStrength;
    f32[33] = satelliteStretch;
    f32[34] = Math.max(0.0, deltaTime);
    u32[35] = this.motionBlurConfig.tapCount;

    this.context.getDevice().queue.writeBuffer(this.motionBlurUniformBuffer, 0, data);
    this.prevViewProjection.set(viewProjection);
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.renderTargets?.hdr.destroy();
    this.renderTargets?.depth.destroy();
    this.renderTargets?.bloomA.destroy();
    this.renderTargets?.bloomB.destroy();
    this.renderTargets?.motionBlur.destroy();
    this.renderTargets?.dofHalfA.destroy();
    this.renderTargets?.dofHalfB.destroy();
    this.renderTargets?.dofComposite.destroy();
    this.renderTargets?.bloomMip.forEach(t => t.destroy());
    this.renderTargets?.compositeIntermediate.destroy();
    this.renderTargets = null;
    this.pipelines = null;
    this.bindGroups = null;

    this.bloomThresholdUniformBuffer?.destroy();
    this.bloomThresholdUniformBuffer = null;
    this.satelliteVisualUniformBuffer?.destroy();
    this.satelliteVisualUniformBuffer = null;
    this.bloomCompositeUniformBuffer?.destroy();
    this.bloomCompositeUniformBuffer = null;
    this.tonemapUniformBuffer?.destroy();
    this.tonemapUniformBuffer = null;
    this.dofUniformBuffer?.destroy();
    this.dofUniformBuffer = null;
    this.atmosphereSettingsBuffer?.destroy();
    this.atmosphereSettingsBuffer = null;
    this.motionBlurUniformBuffer?.destroy();
    this.motionBlurUniformBuffer = null;
    this.autoExposureHistogramBuffer?.destroy();
    this.autoExposureHistogramBuffer = null;
    this.autoExposureStateBuffer?.destroy();
    this.autoExposureStateBuffer = null;
    this.autoExposureSettingsBuffer?.destroy();
    this.autoExposureSettingsBuffer = null;
    this.atmosphereLUT?.destroy();
    this.atmosphereLUT = null;
    this.atmosphereLUTView = null;
    this.bloomKawaseBuffers.forEach(b => b.destroy());
    this.bloomKawaseBuffers = [];
    
    if (this.smileV2Pipeline) {
      this.smileV2Pipeline.destroy();
      this.smileV2Pipeline = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Bloom configuration helpers
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Update the active bloom configuration.
   * Writes new values into the GPU uniform buffers immediately.
   * The change takes effect on the next rendered frame.
   */
  setBloomConfig(config: Partial<BloomConfig>): void {
    this.bloomConfig = { ...this.bloomConfig, ...config };
    this.writeBloomThresholdUni();
    this.writeBloomCompositeUni();
  }

  /**
   * Update bloom + satellite visual tuning. Writes GPU uniforms immediately.
   */
  setImageTuning(settings: ImageTuningSettings): void {
    this.imageTuning = { ...settings };
    this.bloomConfig = {
      ...this.bloomConfig,
      threshold: settings.bloomThreshold,
      knee: settings.bloomKnee,
      intensity: settings.bloomIntensity,
    };
    this.writeBloomThresholdUni();
    this.writeBloomCompositeUni();
    this.writeSatelliteVisualUni();
  }

  getImageTuning(): ImageTuningSettings {
    return { ...this.imageTuning };
  }

  /** Return a copy of the current bloom configuration. */
  getBloomConfig(): BloomConfig {
    return { ...this.bloomConfig };
  }

  setExposureSettings(config: Partial<ExposureSettingsConfig>): void {
    this.exposureSettings = {
      ...this.exposureSettings,
      ...config,
      manualExposure: Math.max(0.1, Math.min(10.0, config.manualExposure ?? this.exposureSettings.manualExposure)),
      adaptationSpeed: Math.max(0.1, Math.min(5.0, config.adaptationSpeed ?? this.exposureSettings.adaptationSpeed)),
      minExposure: Math.max(0.01, Math.min(10.0, config.minExposure ?? this.exposureSettings.minExposure)),
      maxExposure: Math.max(0.05, Math.min(20.0, config.maxExposure ?? this.exposureSettings.maxExposure)),
    };
    if (this.exposureSettings.maxExposure < this.exposureSettings.minExposure) {
      this.exposureSettings.maxExposure = this.exposureSettings.minExposure;
    }
    this.writeTonemapUniform();
    this.writeAutoExposureSettingsUniform(1 / 60);
  }

  getExposureSettings(): ExposureSettingsConfig {
    return { ...this.exposureSettings };
  }

  /**
   * Create GPU uniform buffers used by the bloom passes.
   * Called once on initialize() and again on resize() to update texel sizes.
   */
  private createBloomUniformBuffers(width: number, height: number): void {
    const device = this.context.getDevice();

    // ThresholdUni: 4 × f32 = 16 bytes
    if (!this.bloomThresholdUniformBuffer) {
      this.bloomThresholdUniformBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'Bloom Threshold Uniform',
      });
    }
    this.writeBloomThresholdUni();

    if (!this.satelliteVisualUniformBuffer) {
      this.satelliteVisualUniformBuffer = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'Satellite Visual Uniform',
      });
    }
    this.writeSatelliteVisualUni();

    // BloomCompositeUni: 4 × f32/u32 = 16 bytes
    if (!this.bloomCompositeUniformBuffer) {
      this.bloomCompositeUniformBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'Bloom Composite Uniform',
      });
    }
    this.writeBloomCompositeUni();

    if (!this.tonemapUniformBuffer) {
      this.tonemapUniformBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'Tonemap Uniform',
      });
    }
    this.writeTonemapUniform();

    if (!this.autoExposureHistogramBuffer) {
      this.autoExposureHistogramBuffer = device.createBuffer({
        size: AUTO_EXPOSURE_HISTOGRAM_BINS * Uint32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        label: 'Auto Exposure Histogram',
      });
    }
    device.queue.writeBuffer(this.autoExposureHistogramBuffer, 0, this.autoExposureHistogramClearData);

    if (!this.autoExposureStateBuffer) {
      this.autoExposureStateBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        label: 'Auto Exposure State',
      });
      const exposureSeed = new Float32Array([this.exposureSettings.manualExposure, 0, 0, 0]);
      device.queue.writeBuffer(this.autoExposureStateBuffer, 0, exposureSeed);
    }

    if (!this.autoExposureSettingsBuffer) {
      this.autoExposureSettingsBuffer = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'Auto Exposure Settings',
      });
    }
    this.writeAutoExposureSettingsUniform(1 / 60);

    // Per-level Kawase uniform buffers — one per pyramid level.
    // Each holds { srcTexelSize: vec2f, pad: vec2f } = 16 bytes.
    //
    // Buffer[i] stores the texel size of the SOURCE texture for downsample pass i:
    //   pass 0: source = bloomA (full res, scale = 1×)  → destination = mip[0] (1/2 res)
    //   pass 1: source = mip[0] (1/2 res, scale = 2×)  → destination = mip[1] (1/4 res)
    //   …
    // The same buffer is reused for the corresponding upsample pass.
    this.bloomKawaseBuffers.forEach(b => b.destroy());
    this.bloomKawaseBuffers = [];
    for (let i = 0; i < RenderPipeline.MAX_BLOOM_LEVELS; i++) {
      // scale = resolution divisor of the source texture for this pass level.
      const scale = 1 << i; // i=0 → ÷1 (bloomA), i=1 → ÷2 (mip[0]), …
      const srcW = Math.max(1, Math.floor(width / scale));
      const srcH = Math.max(1, Math.floor(height / scale));

      const buf = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: `Bloom Kawase Uniform L${i}`,
      });
      const data = new Float32Array(4);
      data[0] = 1.0 / srcW;
      data[1] = 1.0 / srcH;
      data[2] = 0.0;
      data[3] = 0.0;
      device.queue.writeBuffer(buf, 0, data);
      this.bloomKawaseBuffers.push(buf);
    }

    if (!this.dofUniformBuffer) {
      this.dofUniformBuffer = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'DoF Uniform',
      });
    }
    this.writeDofUniform();

    if (!this.atmosphereSettingsBuffer) {
      this.atmosphereSettingsBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'Atmosphere Scattering Uniform',
      });
    }
    this.writeAtmosphereScatteringUniform();

    if (!this.motionBlurUniformBuffer) {
      this.motionBlurUniformBuffer = device.createBuffer({
        size: 144,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'Motion Blur Uniform',
      });
    }
  }

  /** Write the ThresholdUni buffer from the current bloomConfig. */
  private writeBloomThresholdUni(): void {
    if (!this.bloomThresholdUniformBuffer) return;
    const data = new Float32Array(4);
    data[0] = this.bloomConfig.threshold;
    data[1] = this.bloomConfig.knee;
    data[2] = this.imageTuning.enforceFloors ? 1.0 : 0.0;
    data[3] = 0.0;
    this.context.getDevice().queue.writeBuffer(this.bloomThresholdUniformBuffer, 0, data);
  }

  private writeSatelliteVisualUni(): void {
    if (!this.satelliteVisualUniformBuffer) return;
    const p = packSatelliteVisualUniform(this.imageTuning);
    const data = new Float32Array([p[0]!, p[1]!, p[2]!, p[3]!, p[4]!, p[5]!, p[6]!, 0]);
    this.context.getDevice().queue.writeBuffer(this.satelliteVisualUniformBuffer, 0, data);
  }

  /** Write the BloomCompositeUni buffer from the current bloomConfig. */
  private writeBloomCompositeUni(): void {
    if (!this.bloomCompositeUniformBuffer) return;
    const ab = new ArrayBuffer(16);
    const f32 = new Float32Array(ab);
    const u32 = new Uint32Array(ab);
    f32[0] = this.bloomConfig.intensity;
    u32[1] = this.bloomConfig.anamorphicEnabled ? 1 : 0;
    f32[2] = this.bloomConfig.anamorphicRatio;
    f32[3] = 0.0;
    this.context.getDevice().queue.writeBuffer(this.bloomCompositeUniformBuffer, 0, ab);
  }

  private writeTonemapUniform(): void {
    if (!this.tonemapUniformBuffer) return;
    const ab = new ArrayBuffer(16);
    const f32 = new Float32Array(ab);
    const u32 = new Uint32Array(ab);
    u32[0] = this.exposureSettings.autoEnabled ? 1 : 0;
    u32[1] = this.exposureSettings.tonemapMode;
    f32[2] = this.exposureSettings.manualExposure;
    f32[3] = 0.0;
    this.context.getDevice().queue.writeBuffer(this.tonemapUniformBuffer, 0, ab);
  }

  private writeAutoExposureSettingsUniform(deltaTime: number): void {
    if (!this.autoExposureSettingsBuffer) return;
    const clampedDt = Math.max(0.0, Math.min(0.2, deltaTime));
    const ab = new ArrayBuffer(32);
    const f32 = new Float32Array(ab);
    const u32 = new Uint32Array(ab);
    f32[0] = clampedDt;
    f32[1] = this.exposureSettings.adaptationSpeed;
    f32[2] = this.exposureSettings.minExposure;
    f32[3] = this.exposureSettings.maxExposure;
    u32[4] = this.exposureSettings.autoEnabled ? 1 : 0;
    u32[5] = 0;
    u32[6] = 0;
    u32[7] = 0;
    this.context.getDevice().queue.writeBuffer(this.autoExposureSettingsBuffer, 0, ab);
  }

  private writeDofUniform(): void {
    if (!this.dofUniformBuffer) return;
    const ab = new ArrayBuffer(32);
    const f32 = new Float32Array(ab);
    const u32 = new Uint32Array(ab);
    f32[0] = Math.max(1, this.dofFocusDistanceKm);
    f32[1] = Math.max(1, this.dofConfig.surfaceDistanceKm);
    f32[2] = Math.max(0, this.dofConfig.maxBlurPx);
    f32[3] = Math.max(0, this.dofConfig.cocScale);
    u32[4] = DOF_FOCUS_MODE[this.dofConfig.focusMode] ?? 0;
    f32[5] = Math.max(0.2, this.dofConfig.depthSigma);
    f32[6] = 10.0;
    f32[7] = 500000.0;
    this.context.getDevice().queue.writeBuffer(this.dofUniformBuffer, 0, ab);
  }

  private writeAtmosphereScatteringUniform(): void {
    if (!this.atmosphereSettingsBuffer) return;
    const ab = new ArrayBuffer(16);
    const f32 = new Float32Array(ab);
    const u32 = new Uint32Array(ab);
    u32[0] = this.atmosphereScattering.enabled ? 1 : 0;
    u32[1] = 0;
    f32[2] = this.atmosphereScattering.hazeStrength;
    f32[3] = 0.0;
    this.context.getDevice().queue.writeBuffer(this.atmosphereSettingsBuffer, 0, ab);
  }

  private createAtmosphereLUT(): void {
    if (this.atmosphereLUT) return;
    const device = this.context.getDevice();
    this.atmosphereLUT = device.createTexture({
      size: [ATMOSPHERE_LUT_WIDTH, ATMOSPHERE_LUT_HEIGHT],
      format: 'rg16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      label: 'Atmosphere LUT',
    });
    this.atmosphereLUTView = this.atmosphereLUT.createView();

    const lut = RenderPipeline.buildAtmosphereLUT();
    const lutBytes = new Uint8Array(lut.buffer.slice(0) as ArrayBuffer);
    device.queue.writeTexture(
      { texture: this.atmosphereLUT },
      lutBytes,
      { bytesPerRow: ATMOSPHERE_LUT_WIDTH * 4, rowsPerImage: ATMOSPHERE_LUT_HEIGHT },
      { width: ATMOSPHERE_LUT_WIDTH, height: ATMOSPHERE_LUT_HEIGHT, depthOrArrayLayers: 1 }
    );
  }

  private static buildAtmosphereLUT(): Uint16Array {
    const data = new Uint16Array(ATMOSPHERE_LUT_WIDTH * ATMOSPHERE_LUT_HEIGHT * 2);
    let i = 0;
    for (let y = 0; y < ATMOSPHERE_LUT_HEIGHT; y++) {
      const sunCos = (y + 0.5) / ATMOSPHERE_LUT_HEIGHT * 2.0 - 1.0;
      const sunAirMass = RenderPipeline.airMass(sunCos);
      for (let x = 0; x < ATMOSPHERE_LUT_WIDTH; x++) {
        const viewCos = (x + 0.5) / ATMOSPHERE_LUT_WIDTH * 2.0 - 1.0;
        const viewAirMass = RenderPipeline.airMass(viewCos);
        const sunWeight = 0.35 + 0.65 * Math.max(0.0, sunCos);
        const rayleighOD = Math.min(64.0, viewAirMass * sunWeight * (ATMOSPHERE_TOP_KM - EARTH_RADIUS_KM) / RAYLEIGH_SCALE_HEIGHT_KM);
        const mieOD = Math.min(64.0, viewAirMass * (0.45 + 0.55 * Math.max(0.0, sunCos)) * (ATMOSPHERE_TOP_KM - EARTH_RADIUS_KM) / MIE_SCALE_HEIGHT_KM * 0.075);

        // Encode sun path dependence so sunsets redden near low sun altitudes.
        const rayleighWithSun = rayleighOD * (0.7 + 0.3 * Math.min(4.0, sunAirMass) / 4.0);
        const mieWithSun = mieOD * (0.85 + 0.15 * Math.min(6.0, sunAirMass) / 6.0);

        data[i++] = RenderPipeline.toHalfFloat(rayleighWithSun);
        data[i++] = RenderPipeline.toHalfFloat(mieWithSun);
      }
    }
    return data;
  }

  private static airMass(cosZenith: number): number {
    const clamped = Math.max(-1.0, Math.min(1.0, cosZenith));
    if (clamped <= -0.15) return 64.0;
    const zenith = Math.acos(Math.max(clamped, -0.999));
    const zenithDeg = zenith * 57.29577951308232;
    const denom = clamped + 0.15 * Math.pow(Math.max(93.885 - zenithDeg, 1e-3), -1.253);
    return Math.min(64.0, Math.max(1.0, 1.0 / Math.max(denom, 1e-3)));
  }

  private static toHalfFloat(value: number): number {
    if (!Number.isFinite(value)) return value < 0 ? 0xfc00 : 0x7c00;
    const sign = value < 0 ? 0x8000 : 0;
    const abs = Math.abs(value);
    if (abs === 0) return sign;
    if (abs >= 65504) return sign | 0x7bff;
    if (abs < 6.103515625e-5) {
      return sign | Math.max(0, Math.round(abs / 5.960464477539063e-8));
    }
    let exp = Math.floor(Math.log2(abs));
    let mant = abs / Math.pow(2, exp) - 1.0;
    let expBits = exp + 15;
    let mantBits = Math.round(mant * 1024);
    if (mantBits === 1024) {
      mantBits = 0;
      expBits += 1;
    }
    if (expBits >= 31) return sign | 0x7bff;
    return sign | (expBits << 10) | (mantBits & 0x3ff);
  }

  private createBloomThresholdBindGroup(sceneSourceView: GPUTextureView): GPUBindGroup {
    if (!this.pipelines || !this.bloomThresholdUniformBuffer) {
      throw new Error('RenderPipeline not initialized');
    }
    const device = this.context.getDevice();
    return device.createBindGroup({
      layout: this.pipelines.bloomThreshold.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sceneSourceView },
        { binding: 1, resource: this.linearSampler },
        { binding: 2, resource: { buffer: this.bloomThresholdUniformBuffer } },
      ],
    });
  }

  private createCompositeBindGroup(sceneSourceView: GPUTextureView): GPUBindGroup {
    if (!this.pipelines || !this.renderTargets || !this.bloomCompositeUniformBuffer || !this.autoExposureStateBuffer || !this.tonemapUniformBuffer) {
      throw new Error('RenderPipeline not initialized');
    }
    const device = this.context.getDevice();
    const bloomResultView = this.renderTargets.bloomMipViews[0];
    return device.createBindGroup({
      layout: this.pipelines.composite.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sceneSourceView },
        { binding: 1, resource: bloomResultView },
        { binding: 2, resource: this.linearSampler },
        { binding: 3, resource: { buffer: this.buffers.uniforms } },
        { binding: 4, resource: { buffer: this.bloomCompositeUniformBuffer } },
        { binding: 5, resource: { buffer: this.autoExposureStateBuffer } },
        { binding: 6, resource: { buffer: this.tonemapUniformBuffer } },
      ],
    });
  }
}

export default RenderPipeline;
