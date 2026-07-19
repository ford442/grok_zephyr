/**
 * Grok Zephyr - Render Pipeline
 *
 * Thin orchestrator delegating to pipeline factories, uniform buffers,
 * render targets, and modular pass encoders.
 */

import type { WebGPUContext } from '@/core/WebGPUContext.js';
import type { SatelliteBufferSet } from '@/core/SatelliteGPUBuffer.js';
import type { BloomConfig } from '@/types/animation.js';
import type { ImageTuningSettings } from '@/core/ImageTuning.js';
import type { DepthOfFieldQualitySettings } from '@/core/QualityPresets.js';
import { SmileV2Pipeline } from './SmileV2Pipeline.js';
import { createAtmosphereLUT, type AtmosphereLUTResources } from './AtmosphereLUT.js';
import { RenderUniformBuffers } from './RenderUniformBuffers.js';
import { RenderTargetManager } from './RenderTargets.js';
import { createPipelines } from './pipelines/PipelineFactory.js';
import { createStaticBindGroups, createSkylineBindGroup } from './pipelines/BindGroupFactory.js';
import type {
  ExposureSettingsConfig,
  MotionBlurConfig,
  PipelineBindGroups,
  Pipelines,
  RenderTargets,
} from './pipelines/types.js';
import {
  encodeAutoExposurePasses,
  encodeBeamComputePass,
  encodeBloomPasses,
  encodeCompositePass,
  encodeComputePass,
  encodeConstellationGuidesPass,
  encodeCullPass,
  encodeDepthOfFieldPasses,
  encodeGroundScenePass,
  encodeMoonOverlayPass,
  encodeMotionBlurPass,
  encodeScenePass,
  encodeSkylinePass,
  encodeTrailPass,
  invalidateGroundSceneRenderBundle,
  invalidateSceneRenderBundle,
  type FrameContext,
} from './passes/index.js';
import { SatelliteCullBuffers } from './SatelliteCullBuffers.js';
import { SatellitePicker } from './SatellitePicker.js';

export type {
  RenderTargets,
  PipelineBindGroups,
  Pipelines,
  TonemapMode,
  ExposureSettingsConfig,
  MotionBlurConfig,
} from './pipelines/types.js';
export { MAX_BEAMS } from './pipelines/types.js';

/**
 * Render Pipeline Manager
 *
 * Encapsulates all rendering logic for the multi-pass pipeline.
 */
export class RenderPipeline {
  private context: WebGPUContext;
  private buffers: SatelliteBufferSet;
  private linearSampler: GPUSampler;
  private readonly uniforms: RenderUniformBuffers;
  private readonly renderTargetManager: RenderTargetManager;

  private pipelines: Pipelines | null = null;
  private bindGroups: PipelineBindGroups | null = null;
  private renderTargets: RenderTargets | null = null;
  private smileV2Pipeline: SmileV2Pipeline | null = null;
  private atmosphereLUT: AtmosphereLUTResources | null = null;
  private readonly satellitePicker: SatellitePicker;
  private readonly cullBuffers: SatelliteCullBuffers;
  private gpuCullingEnabled = true;
  private visibleCountReadbackPending = false;

  private width = 0;
  private height = 0;
  private groundTerrainEnabled = true;
  private skylineBindGroup: GPUBindGroup | null = null;

  constructor(context: WebGPUContext, buffers: SatelliteBufferSet) {
    this.context = context;
    this.buffers = buffers;
    this.linearSampler = context.createLinearSampler();
    this.uniforms = new RenderUniformBuffers(context);
    this.renderTargetManager = new RenderTargetManager(context);
    this.satellitePicker = new SatellitePicker(context);
    this.cullBuffers = new SatelliteCullBuffers(context);
  }

  initialize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.uniforms.motionBlurHistoryReady = false;

    console.log(`[RenderPipeline] Initializing ${width}x${height}`);

    this.uniforms.createBuffers(width, height);
    this.pipelines = createPipelines(this.context);
    this.renderTargets = this.renderTargetManager.initialize(width, height);
    this.atmosphereLUT = createAtmosphereLUT(this.context);
    this.createBindGroups();

    this.smileV2Pipeline = new SmileV2Pipeline(this.context, this.buffers);
    this.smileV2Pipeline.initialize();
    this.satellitePicker.initialize();

    console.log(`[RenderPipeline] GPU culling: ${this.gpuCullingEnabled ? 'enabled' : 'disabled'}`);
    console.log('[RenderPipeline] Initialization complete');
  }

  setGpuCullingEnabled(enabled: boolean): void {
    if (this.gpuCullingEnabled === enabled) return;
    this.gpuCullingEnabled = enabled;
    invalidateSceneRenderBundle();
    invalidateGroundSceneRenderBundle();
    console.log(`[RenderPipeline] GPU culling: ${enabled ? 'enabled' : 'disabled'}`);
  }

  isGpuCullingEnabled(): boolean {
    return this.gpuCullingEnabled;
  }

  getCullBuffers(): SatelliteCullBuffers {
    return this.cullBuffers;
  }

  async consumeVisibleSatelliteCount(): Promise<number | null> {
    if (!this.visibleCountReadbackPending) return null;
    this.visibleCountReadbackPending = false;
    return this.cullBuffers.readVisibleSatelliteCount();
  }

  async pickSatelliteAt(
    clientX: number,
    clientY: number,
    canvas: HTMLCanvasElement,
  ): Promise<number> {
    if (!this.uniforms.satelliteVisualUniformBuffer) return -1;
    return this.satellitePicker.pickAt(
      this.buffers,
      this.uniforms.satelliteVisualUniformBuffer,
      clientX,
      clientY,
      canvas,
    );
  }

  private createBindGroups(): void {
    if (
      !this.pipelines ||
      !this.renderTargets ||
      !this.atmosphereLUT ||
      !this.uniforms.bloomThresholdUniformBuffer ||
      !this.uniforms.bloomCompositeUniformBuffer ||
      !this.uniforms.tonemapUniformBuffer ||
      !this.uniforms.motionBlurUniformBuffer ||
      !this.uniforms.atmosphereSettingsBuffer ||
      !this.uniforms.autoExposureStateBuffer ||
      !this.uniforms.groundParamsBuffer ||
      !this.uniforms.satelliteVisualUniformBuffer
    ) {
      return;
    }

    this.bindGroups = createStaticBindGroups({
      context: this.context,
      buffers: this.buffers,
      pipelines: this.pipelines,
      renderTargets: this.renderTargets,
      linearSampler: this.linearSampler,
      atmosphereLUTView: this.atmosphereLUT.view,
      atmosphereSettingsBuffer: this.uniforms.atmosphereSettingsBuffer,
      groundParamsBuffer: this.uniforms.groundParamsBuffer,
      bloomThresholdUniformBuffer: this.uniforms.bloomThresholdUniformBuffer,
      bloomCompositeUniformBuffer: this.uniforms.bloomCompositeUniformBuffer,
      tonemapUniformBuffer: this.uniforms.tonemapUniformBuffer,
      autoExposureStateBuffer: this.uniforms.autoExposureStateBuffer,
      motionBlurUniformBuffer: this.uniforms.motionBlurUniformBuffer,
      satelliteVisualUniformBuffer: this.uniforms.satelliteVisualUniformBuffer,
      cullBuffers: this.cullBuffers,
    });
  }

  private getFrameContext(): FrameContext | null {
    if (
      !this.pipelines ||
      !this.bindGroups ||
      !this.renderTargets ||
      !this.uniforms.bloomThresholdUniformBuffer ||
      !this.uniforms.bloomCompositeUniformBuffer ||
      !this.uniforms.tonemapUniformBuffer
    ) {
      return null;
    }

    return {
      context: this.context,
      buffers: this.buffers,
      renderTargets: this.renderTargets,
      bindGroups: this.bindGroups,
      pipelines: this.pipelines,
      uniforms: this.uniforms,
      width: this.width,
      height: this.height,
      linearSampler: this.linearSampler,
      bloomConfig: this.uniforms.bloomConfig,
      bloomKawaseBuffers: this.uniforms.bloomKawaseBuffers,
      exposureSettings: this.uniforms.exposureSettings,
      motionBlurConfig: this.uniforms.motionBlurConfig,
      dofConfig: this.uniforms.dofConfig,
      dofUniformBuffer: this.uniforms.dofUniformBuffer,
      autoExposureHistogramBuffer: this.uniforms.autoExposureHistogramBuffer,
      autoExposureStateBuffer: this.uniforms.autoExposureStateBuffer,
      autoExposureSettingsBuffer: this.uniforms.autoExposureSettingsBuffer,
      autoExposureHistogramClearData: this.uniforms.autoExposureHistogramClearData,
      motionBlurUniformBuffer: this.uniforms.motionBlurUniformBuffer,
      bloomThresholdUniformBuffer: this.uniforms.bloomThresholdUniformBuffer,
      bloomCompositeUniformBuffer: this.uniforms.bloomCompositeUniformBuffer,
      tonemapUniformBuffer: this.uniforms.tonemapUniformBuffer,
      groundTerrainEnabled: this.groundTerrainEnabled,
      skylineBindGroup: this.skylineBindGroup,
    };
  }

  private withFrameContext(run: (ctx: FrameContext) => void): void {
    const ctx = this.getFrameContext();
    if (ctx) run(ctx);
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;

    this.width = width;
    this.height = height;

    console.log(`[RenderPipeline] Resized to ${width}x${height}`);

    this.renderTargetManager.destroy();
    this.uniforms.resetKawaseBuffers();
    this.uniforms.createBuffers(width, height);
    this.renderTargets = this.renderTargetManager.initialize(width, height);
    this.createBindGroups();
    invalidateSceneRenderBundle();
    invalidateGroundSceneRenderBundle();
  }

  encodeCullPass(encoder: GPUCommandEncoder): void {
    if (!this.gpuCullingEnabled) return;
    this.withFrameContext((ctx) => encodeCullPass(encoder, ctx, this.cullBuffers));
    this.visibleCountReadbackPending = true;
  }

  encodeComputePass(encoder: GPUCommandEncoder): void {
    this.withFrameContext((ctx) => encodeComputePass(encoder, ctx));
  }

  encodeBeamComputePass(encoder: GPUCommandEncoder): void {
    this.withFrameContext((ctx) => encodeBeamComputePass(encoder, ctx));
  }

  encodeSmileV2Pass(encoder: GPUCommandEncoder): void {
    if (!this.smileV2Pipeline || !this.smileV2Pipeline.isActive()) return;
    this.smileV2Pipeline.encodeComputePass(encoder);
  }

  getSmileV2Pipeline(): SmileV2Pipeline | null {
    return this.smileV2Pipeline;
  }

  encodeScenePass(
    encoder: GPUCommandEncoder,
    earthVertexBuffer: GPUBuffer,
    earthIndexBuffer: GPUBuffer,
    earthIndexCount: number,
    moonView = false,
  ): void {
    this.withFrameContext((ctx) =>
      encodeScenePass(
        encoder,
        ctx,
        earthVertexBuffer,
        earthIndexBuffer,
        earthIndexCount,
        moonView,
        this.gpuCullingEnabled,
        this.gpuCullingEnabled ? this.cullBuffers : null,
      ),
    );
  }

  encodeTrailPass(
    encoder: GPUCommandEncoder,
    trailRenderer: {
      encodeRenderPass(pass: GPURenderPassEncoder, uniformBuffer: GPUBuffer): void;
    } | null,
  ): void {
    this.withFrameContext((ctx) => encodeTrailPass(encoder, ctx, trailRenderer));
  }

  encodeConstellationGuidesPass(
    encoder: GPUCommandEncoder,
    guides: { encodeRenderPass(pass: GPURenderPassEncoder, uniformBuffer: GPUBuffer): void } | null,
  ): void {
    this.withFrameContext((ctx) => encodeConstellationGuidesPass(encoder, ctx, guides));
  }

  encodeMoonOverlayPass(
    encoder: GPUCommandEncoder,
    ringGuide: {
      encodeRenderPass(pass: GPURenderPassEncoder, uniformBuffer: GPUBuffer): void;
    } | null,
  ): void {
    this.withFrameContext((ctx) => encodeMoonOverlayPass(encoder, ctx, ringGuide));
  }

  setGroundViewParams(
    oceanBias: number,
    urbanGlow: number,
    overlayFade: number,
    hazeBoost: number,
  ): void {
    const [o, u, f, h] = this.uniforms.groundViewParams;
    if (o === oceanBias && u === urbanGlow && f === overlayFade && h === hazeBoost) return;
    this.uniforms.groundViewParams = [oceanBias, urbanGlow, overlayFade, hazeBoost];
    this.uniforms.writeGroundViewParams();
  }

  setGroundTerrainEnabled(enabled: boolean): void {
    this.groundTerrainEnabled = enabled;
  }

  encodeGroundScenePass(encoder: GPUCommandEncoder): void {
    this.withFrameContext((ctx) =>
      encodeGroundScenePass(
        encoder,
        ctx,
        this.gpuCullingEnabled,
        this.gpuCullingEnabled ? this.cullBuffers : null,
      ),
    );
  }

  setSkylineResources(cityUniformBuffer: GPUBuffer, instanceBuffer: GPUBuffer): void {
    if (!this.pipelines || this.skylineBindGroup) return;
    this.skylineBindGroup = createSkylineBindGroup(
      this.context,
      this.pipelines,
      this.buffers.uniforms,
      cityUniformBuffer,
      instanceBuffer,
    );
  }

  encodeSkylinePass(encoder: GPUCommandEncoder, buildingCount: number): void {
    this.withFrameContext((ctx) => encodeSkylinePass(encoder, ctx, buildingCount));
  }

  encodeBloomPasses(encoder: GPUCommandEncoder, sceneSourceView?: GPUTextureView): void {
    this.withFrameContext((ctx) => encodeBloomPasses(encoder, ctx, sceneSourceView));
  }

  encodeAutoExposurePasses(
    encoder: GPUCommandEncoder,
    sceneSourceView: GPUTextureView,
    deltaTime: number,
  ): void {
    this.withFrameContext((ctx) =>
      encodeAutoExposurePasses(encoder, ctx, sceneSourceView, deltaTime),
    );
  }

  encodeCompositePass(
    encoder: GPUCommandEncoder,
    outputView: GPUTextureView,
    outputWidth?: number,
    outputHeight?: number,
    sceneSourceView?: GPUTextureView,
  ): void {
    this.withFrameContext((ctx) =>
      encodeCompositePass(encoder, ctx, outputView, outputWidth, outputHeight, sceneSourceView),
    );
  }

  getCompositeIntermediateView(): GPUTextureView {
    if (!this.renderTargets) throw new Error('RenderPipeline not initialized');
    return this.renderTargets.compositeIntermediateView;
  }

  getHDRView(): GPUTextureView {
    if (!this.renderTargets) throw new Error('RenderPipeline not initialized');
    return this.renderTargets.hdrView;
  }

  getRenderTargets(): RenderTargets | null {
    return this.renderTargets;
  }

  encodeDepthOfFieldPasses(encoder: GPUCommandEncoder): GPUTextureView {
    const ctx = this.getFrameContext();
    if (!ctx) {
      if (!this.renderTargets) throw new Error('RenderPipeline not initialized');
      return this.renderTargets.hdrView;
    }
    return encodeDepthOfFieldPasses(encoder, ctx);
  }

  encodeMotionBlurPass(encoder: GPUCommandEncoder, sourceView: GPUTextureView): GPUTextureView {
    const ctx = this.getFrameContext();
    if (!ctx) return sourceView;
    return encodeMotionBlurPass(encoder, ctx, sourceView);
  }

  setAtmosphereScatteringConfig(enabled: boolean, hazeStrength: number): void {
    this.uniforms.atmosphereScattering.enabled = enabled;
    this.uniforms.atmosphereScattering.hazeStrength = Math.max(0.0, hazeStrength);
    this.uniforms.writeAtmosphereScatteringUniform();
  }

  setDepthOfFieldConfig(config: DepthOfFieldQualitySettings): void {
    this.uniforms.dofConfig = { ...config };
    this.uniforms.dofFocusDistanceKm = Math.max(
      1,
      this.uniforms.dofConfig.surfaceDistanceKm || this.uniforms.dofFocusDistanceKm || 1000,
    );
    this.uniforms.writeDofUniform();
  }

  updateDepthOfFieldFocus(
    cameraPosition: readonly [number, number, number],
    selectedSatelliteIndex: number,
    time: number,
    deltaTime: number,
    getSatellitePosition: (index: number, timeSeconds: number) => readonly [number, number, number],
  ): void {
    if (!this.uniforms.dofConfig.enabled) return;

    let target: number;
    switch (this.uniforms.dofConfig.focusMode) {
      case 'satellite-track':
        if (selectedSatelliteIndex >= 0) {
          const pos = getSatellitePosition(selectedSatelliteIndex, time);
          const dx = pos[0] - cameraPosition[0];
          const dy = pos[1] - cameraPosition[1];
          const dz = pos[2] - cameraPosition[2];
          target = Math.max(1, Math.sqrt(dx * dx + dy * dy + dz * dz));
          break;
        }
        target = this.uniforms.dofFocusDistanceKm;
        break;
      case 'surface-distance':
        target = Math.max(1, this.uniforms.dofConfig.surfaceDistanceKm);
        break;
      case 'earth-center':
        target = Math.max(
          1,
          Math.sqrt(
            cameraPosition[0] * cameraPosition[0] +
              cameraPosition[1] * cameraPosition[1] +
              cameraPosition[2] * cameraPosition[2],
          ),
        );
        break;
      case 'auto-center':
      default:
        target = this.uniforms.dofFocusDistanceKm;
        break;
    }

    const blend =
      1.0 -
      Math.exp(-Math.max(0.1, this.uniforms.dofConfig.transitionRate) * Math.max(deltaTime, 0.0));
    this.uniforms.dofFocusDistanceKm += (target - this.uniforms.dofFocusDistanceKm) * blend;
    this.uniforms.writeDofUniform();
  }

  setMotionBlurConfig(config: Partial<MotionBlurConfig>): void {
    this.uniforms.motionBlurConfig = {
      ...this.uniforms.motionBlurConfig,
      ...config,
      cameraStrength: Math.max(
        0.0,
        Math.min(2.0, config.cameraStrength ?? this.uniforms.motionBlurConfig.cameraStrength),
      ),
      satelliteStretch: Math.max(
        0.0,
        Math.min(2.0, config.satelliteStretch ?? this.uniforms.motionBlurConfig.satelliteStretch),
      ),
      tapCount: Math.max(
        1,
        Math.min(16, Math.floor(config.tapCount ?? this.uniforms.motionBlurConfig.tapCount)),
      ),
    };
  }

  setMotionBlurFrameData(
    viewProjection: Float32Array,
    inverseViewProjection: Float32Array,
    viewModeIndex: number,
    deltaTime: number,
    viewWeightOverride?: number,
    hostVelocity?: readonly [number, number, number],
  ): void {
    this.uniforms.writeMotionBlurFrameData(
      viewProjection,
      inverseViewProjection,
      viewModeIndex,
      deltaTime,
      viewWeightOverride,
      hostVelocity,
    );
  }

  destroy(): void {
    this.renderTargetManager.destroy();
    this.renderTargets = null;
    this.pipelines = null;
    this.bindGroups = null;

    this.uniforms.destroy();
    this.atmosphereLUT?.texture.destroy();
    this.atmosphereLUT = null;

    if (this.smileV2Pipeline) {
      this.smileV2Pipeline.destroy();
      this.smileV2Pipeline = null;
    }
    this.satellitePicker.destroy();
    this.cullBuffers.destroy();
  }

  setBloomConfig(config: Partial<BloomConfig>): void {
    this.uniforms.bloomConfig = { ...this.uniforms.bloomConfig, ...config };
    this.uniforms.writeBloomThresholdUni();
    this.uniforms.writeBloomCompositeUni();
  }

  setImageTuning(settings: ImageTuningSettings): void {
    this.uniforms.imageTuning = { ...settings };
    this.uniforms.bloomConfig = {
      ...this.uniforms.bloomConfig,
      threshold: settings.bloomThreshold,
      knee: settings.bloomKnee,
      intensity: settings.bloomIntensity,
    };
    this.uniforms.writeBloomThresholdUni();
    this.uniforms.writeBloomCompositeUni();
    this.uniforms.writeSatelliteVisualUni();
  }

  getImageTuning(): ImageTuningSettings {
    return { ...this.uniforms.imageTuning };
  }

  getBloomConfig(): BloomConfig {
    return { ...this.uniforms.bloomConfig };
  }

  setExposureSettings(config: Partial<ExposureSettingsConfig>): void {
    this.uniforms.exposureSettings = {
      ...this.uniforms.exposureSettings,
      ...config,
      manualExposure: Math.max(
        0.1,
        Math.min(10.0, config.manualExposure ?? this.uniforms.exposureSettings.manualExposure),
      ),
      adaptationSpeed: Math.max(
        0.1,
        Math.min(5.0, config.adaptationSpeed ?? this.uniforms.exposureSettings.adaptationSpeed),
      ),
      minExposure: Math.max(
        0.01,
        Math.min(10.0, config.minExposure ?? this.uniforms.exposureSettings.minExposure),
      ),
      maxExposure: Math.max(
        0.05,
        Math.min(20.0, config.maxExposure ?? this.uniforms.exposureSettings.maxExposure),
      ),
    };
    if (this.uniforms.exposureSettings.maxExposure < this.uniforms.exposureSettings.minExposure) {
      this.uniforms.exposureSettings.maxExposure = this.uniforms.exposureSettings.minExposure;
    }
    this.uniforms.writeTonemapUniform();
    this.uniforms.writeAutoExposureSettingsUniform(1 / 60);
  }

  getExposureSettings(): ExposureSettingsConfig {
    return { ...this.uniforms.exposureSettings };
  }
}
