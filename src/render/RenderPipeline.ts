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

export const AUTO_EXPOSURE_HISTOGRAM_BINS = 64;

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
  public context: WebGPUContext;
  public buffers: SatelliteBufferSet;
  public linearSampler: GPUSampler;
  
  public pipelines: Pipelines | null = null;
  private bindGroups: PipelineBindGroups | null = null;
  public renderTargets: RenderTargets | null = null;
  private smileV2Pipeline: SmileV2Pipeline | null = null;
  
  public width = 0;
  public height = 0;

  /** Current bloom configuration (drives threshold, levels, anamorphic) */
  public bloomConfig: BloomConfig = { ...DEFAULT_BLOOM_CONFIG };

  /** Uniform buffer for the bloom threshold pass (ThresholdUni) */
  public bloomThresholdUniformBuffer: GPUBuffer | null = null;
  /** Uniform buffer for the composite bloom parameters (BloomCompositeUni) */
  public bloomCompositeUniformBuffer: GPUBuffer | null = null;
  /** Uniform buffer for tonemap mode/manual exposure controls. */
  public tonemapUniformBuffer: GPUBuffer | null = null;
  /** Uniform buffer for depth-of-field parameters. */
  public dofUniformBuffer: GPUBuffer | null = null;
  /** Uniform buffer for atmosphere scattering controls. */
  public atmosphereSettingsBuffer: GPUBuffer | null = null;
  /** Motion blur uniforms (previous VP + inverse VP + strengths). */
  public motionBlurUniformBuffer: GPUBuffer | null = null;
  /** Auto exposure histogram (64 bins). */
  public autoExposureHistogramBuffer: GPUBuffer | null = null;
  /** Auto exposure state (single exposure value). */
  public autoExposureStateBuffer: GPUBuffer | null = null;
  /** Auto exposure compute settings (dt/speed/min/max). */
  public autoExposureSettingsBuffer: GPUBuffer | null = null;
  /** Zeroed histogram scratch data reused per-frame. */
  public readonly autoExposureHistogramClearData = new Uint32Array(AUTO_EXPOSURE_HISTOGRAM_BINS);
  /**
   * Per-level Kawase uniform buffers (srcTexelSize for each pyramid level).
   * Index i holds the texel size of mip level i.
   * Created on initialize/resize; maximum MAX_BLOOM_LEVELS entries.
   */
  public bloomKawaseBuffers: GPUBuffer[] = [];
  public dofConfig: DepthOfFieldQualitySettings = { ...DEFAULT_DOF_CONFIG };
  public dofFocusDistanceKm = 1000;
  public atmosphereScattering: AtmosphereScatteringConfig = { ...DEFAULT_ATMOSPHERE_SCATTERING };
  public exposureSettings: ExposureSettingsConfig = { ...DEFAULT_EXPOSURE_SETTINGS };
  public motionBlurConfig: MotionBlurConfig = { ...DEFAULT_MOTION_BLUR_CONFIG };
  public readonly prevViewProjection = new Float32Array(16);
  public motionBlurHistoryReady = false;
  public atmosphereLUT: GPUTexture | null = null;
  public atmosphereLUTView: GPUTextureView | null = null;

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
    
    createBloomUniformBuffers(this, width, height);
    this.createPipelines();
    createRenderTargets(this, width, height);
    createAtmosphereLUT(this);
    this.bindGroups = createBindGroups(this);
    
    // Initialize Smile V2 pipeline
    this.smileV2Pipeline = new SmileV2Pipeline(this.context, this.buffers);
    this.smileV2Pipeline.initialize();
    
    console.log('[RenderPipeline] Initialization complete');
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
    createBloomUniformBuffers(this, width, height);

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
      ? createBloomThresholdBindGroup(this, sceneSourceView)
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

    writeAutoExposureSettingsUniform(this, deltaTime);
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
      ? createCompositeBindGroup(this, sceneSourceView)
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


}

export default RenderPipeline;
