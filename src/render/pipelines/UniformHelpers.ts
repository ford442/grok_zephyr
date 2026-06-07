
import { RenderPipeline } from '../RenderPipeline.js';
import { AUTO_EXPOSURE_HISTOGRAM_BINS } from '../RenderPipeline.js';

/**
   * Create GPU uniform buffers used by the bloom passes.
   * Called once on initialize() and again on resize() to update texel sizes.
   */
  export function createBloomUniformBuffers(pipeline: any, width: number, height: number): void  {
    const device = pipeline.context.getDevice();

    // ThresholdUni: 4 × f32 = 16 bytes
    if (!pipeline.bloomThresholdUniformBuffer) {
      pipeline.bloomThresholdUniformBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'Bloom Threshold Uniform',
      });
    }
    pipeline.writeBloomThresholdUni();

    // BloomCompositeUni: 4 × f32/u32 = 16 bytes
    if (!pipeline.bloomCompositeUniformBuffer) {
      pipeline.bloomCompositeUniformBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'Bloom Composite Uniform',
      });
    }
    pipeline.writeBloomCompositeUni();

    if (!pipeline.tonemapUniformBuffer) {
      pipeline.tonemapUniformBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'Tonemap Uniform',
      });
    }
    pipeline.writeTonemapUniform();

    if (!pipeline.autoExposureHistogramBuffer) {
      pipeline.autoExposureHistogramBuffer = device.createBuffer({
        size: AUTO_EXPOSURE_HISTOGRAM_BINS * Uint32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        label: 'Auto Exposure Histogram',
      });
    }
    device.queue.writeBuffer(pipeline.autoExposureHistogramBuffer, 0, pipeline.autoExposureHistogramClearData);

    if (!pipeline.autoExposureStateBuffer) {
      pipeline.autoExposureStateBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        label: 'Auto Exposure State',
      });
      const exposureSeed = new Float32Array([pipeline.exposureSettings.manualExposure, 0, 0, 0]);
      device.queue.writeBuffer(pipeline.autoExposureStateBuffer, 0, exposureSeed);
    }

    if (!pipeline.autoExposureSettingsBuffer) {
      pipeline.autoExposureSettingsBuffer = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'Auto Exposure Settings',
      });
    }
    pipeline.writeAutoExposureSettingsUniform(1 / 60);

    // Per-level Kawase uniform buffers — one per pyramid level.
    // Each holds { srcTexelSize: vec2f, pad: vec2f } = 16 bytes.
    //
    // Buffer[i] stores the texel size of the SOURCE texture for downsample pass i:
    //   pass 0: source = bloomA (full res, scale = 1×)  → destination = mip[0] (1/2 res)
    //   pass 1: source = mip[0] (1/2 res, scale = 2×)  → destination = mip[1] (1/4 res)
    //   …
    // The same buffer is reused for the corresponding upsample pass.
    pipeline.bloomKawaseBuffers.forEach(b => b.destroy());
    pipeline.bloomKawaseBuffers = [];
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
      pipeline.bloomKawaseBuffers.push(buf);
    }

    if (!pipeline.dofUniformBuffer) {
      pipeline.dofUniformBuffer = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'DoF Uniform',
      });
    }
    pipeline.writeDofUniform();

    if (!pipeline.atmosphereSettingsBuffer) {
      pipeline.atmosphereSettingsBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'Atmosphere Scattering Uniform',
      });
    }
    pipeline.writeAtmosphereScatteringUniform();

    if (!pipeline.motionBlurUniformBuffer) {
      pipeline.motionBlurUniformBuffer = device.createBuffer({
        size: 144,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'Motion Blur Uniform',
      });
    }
  }

/** Write the ThresholdUni buffer from the current bloomConfig. */
  export function writeBloomThresholdUni(pipeline: any, ): void  {
    if (!pipeline.bloomThresholdUniformBuffer) return;
    const data = new Float32Array(4);
    data[0] = pipeline.bloomConfig.threshold;
    data[1] = pipeline.bloomConfig.knee;
    data[2] = 0.0;
    data[3] = 0.0;
    pipeline.context.getDevice().queue.writeBuffer(pipeline.bloomThresholdUniformBuffer, 0, data);
  }

/** Write the BloomCompositeUni buffer from the current bloomConfig. */
  export function writeBloomCompositeUni(pipeline: any, ): void  {
    if (!pipeline.bloomCompositeUniformBuffer) return;
    const ab = new ArrayBuffer(16);
    const f32 = new Float32Array(ab);
    const u32 = new Uint32Array(ab);
    f32[0] = pipeline.bloomConfig.intensity;
    u32[1] = pipeline.bloomConfig.anamorphicEnabled ? 1 : 0;
    f32[2] = pipeline.bloomConfig.anamorphicRatio;
    f32[3] = 0.0;
    pipeline.context.getDevice().queue.writeBuffer(pipeline.bloomCompositeUniformBuffer, 0, ab);
  }

/** Return a copy of the current bloom configuration. */
  getBloomConfig(): BloomConfig {
    return { ...pipeline.bloomConfig };
  }

  setExposureSettings(config: Partial<ExposureSettingsConfig>): void {
    pipeline.exposureSettings = {
      ...pipeline.exposureSettings,
      ...config,
      manualExposure: Math.max(0.1, Math.min(10.0, config.manualExposure ?? pipeline.exposureSettings.manualExposure)),
      adaptationSpeed: Math.max(0.1, Math.min(5.0, config.adaptationSpeed ?? pipeline.exposureSettings.adaptationSpeed)),
      minExposure: Math.max(0.01, Math.min(10.0, config.minExposure ?? pipeline.exposureSettings.minExposure)),
      maxExposure: Math.max(0.05, Math.min(20.0, config.maxExposure ?? pipeline.exposureSettings.maxExposure)),
    };
    if (pipeline.exposureSettings.maxExposure < pipeline.exposureSettings.minExposure) {
      pipeline.exposureSettings.maxExposure = pipeline.exposureSettings.minExposure;
    }
    pipeline.writeTonemapUniform();
    pipeline.writeAutoExposureSettingsUniform(1 / 60);
  }

  getExposureSettings(): ExposureSettingsConfig {
    return { ...pipeline.exposureSettings };
  }







  export function writeTonemapUniform(pipeline: any, ): void  {
    if (!pipeline.tonemapUniformBuffer) return;
    const ab = new ArrayBuffer(16);
    const f32 = new Float32Array(ab);
    const u32 = new Uint32Array(ab);
    u32[0] = pipeline.exposureSettings.autoEnabled ? 1 : 0;
    u32[1] = pipeline.exposureSettings.tonemapMode;
    f32[2] = pipeline.exposureSettings.manualExposure;
    f32[3] = 0.0;
    pipeline.context.getDevice().queue.writeBuffer(pipeline.tonemapUniformBuffer, 0, ab);
  }

/**
   * Update the active bloom configuration.
   * Writes new values into the GPU uniform buffers immediately.
   * The change takes effect on the next rendered frame.
   */
  setBloomConfig(config: Partial<BloomConfig>): void {
    pipeline.bloomConfig = { ...pipeline.bloomConfig, ...config };
    pipeline.writeBloomThresholdUni();
    pipeline.writeBloomCompositeUni();
  }



  export function writeAutoExposureSettingsUniform(pipeline: any, deltaTime: number): void  {
    if (!pipeline.autoExposureSettingsBuffer) return;
    const clampedDt = Math.max(0.0, Math.min(0.2, deltaTime));
    const ab = new ArrayBuffer(32);
    const f32 = new Float32Array(ab);
    const u32 = new Uint32Array(ab);
    f32[0] = clampedDt;
    f32[1] = pipeline.exposureSettings.adaptationSpeed;
    f32[2] = pipeline.exposureSettings.minExposure;
    f32[3] = pipeline.exposureSettings.maxExposure;
    u32[4] = pipeline.exposureSettings.autoEnabled ? 1 : 0;
    u32[5] = 0;
    u32[6] = 0;
    u32[7] = 0;
    pipeline.context.getDevice().queue.writeBuffer(pipeline.autoExposureSettingsBuffer, 0, ab);
  }

/**
   * Cleanup resources
   */
  destroy(): void {
    pipeline.renderTargets?.hdr.destroy();
    pipeline.renderTargets?.depth.destroy();
    pipeline.renderTargets?.bloomA.destroy();
    pipeline.renderTargets?.bloomB.destroy();
    pipeline.renderTargets?.motionBlur.destroy();
    pipeline.renderTargets?.dofHalfA.destroy();
    pipeline.renderTargets?.dofHalfB.destroy();
    pipeline.renderTargets?.dofComposite.destroy();
    pipeline.renderTargets?.bloomMip.forEach(t => t.destroy());
    pipeline.renderTargets?.compositeIntermediate.destroy();
    pipeline.renderTargets = null;
    pipeline.pipelines = null;
    pipeline.bindGroups = null;

    pipeline.bloomThresholdUniformBuffer?.destroy();
    pipeline.bloomThresholdUniformBuffer = null;
    pipeline.bloomCompositeUniformBuffer?.destroy();
    pipeline.bloomCompositeUniformBuffer = null;
    pipeline.tonemapUniformBuffer?.destroy();
    pipeline.tonemapUniformBuffer = null;
    pipeline.dofUniformBuffer?.destroy();
    pipeline.dofUniformBuffer = null;
    pipeline.atmosphereSettingsBuffer?.destroy();
    pipeline.atmosphereSettingsBuffer = null;
    pipeline.motionBlurUniformBuffer?.destroy();
    pipeline.motionBlurUniformBuffer = null;
    pipeline.autoExposureHistogramBuffer?.destroy();
    pipeline.autoExposureHistogramBuffer = null;
    pipeline.autoExposureStateBuffer?.destroy();
    pipeline.autoExposureStateBuffer = null;
    pipeline.autoExposureSettingsBuffer?.destroy();
    pipeline.autoExposureSettingsBuffer = null;
    pipeline.atmosphereLUT?.destroy();
    pipeline.atmosphereLUT = null;
    pipeline.atmosphereLUTView = null;
    pipeline.bloomKawaseBuffers.forEach(b => b.destroy());
    pipeline.bloomKawaseBuffers = [];

    if (pipeline.smileV2Pipeline) {
      pipeline.smileV2Pipeline.destroy();
      pipeline.smileV2Pipeline = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Bloom configuration helpers
  // ─────────────────────────────────────────────────────────────────────────────



  export function writeDofUniform(pipeline: any, ): void  {
    if (!pipeline.dofUniformBuffer) return;
    const ab = new ArrayBuffer(32);
    const f32 = new Float32Array(ab);
    const u32 = new Uint32Array(ab);
    f32[0] = Math.max(1, pipeline.dofFocusDistanceKm);
    f32[1] = Math.max(1, pipeline.dofConfig.surfaceDistanceKm);
    f32[2] = Math.max(0, pipeline.dofConfig.maxBlurPx);
    f32[3] = Math.max(0, pipeline.dofConfig.cocScale);
    u32[4] = DOF_FOCUS_MODE[pipeline.dofConfig.focusMode] ?? 0;
    f32[5] = Math.max(0.2, pipeline.dofConfig.depthSigma);
    f32[6] = 10.0;
    f32[7] = 500000.0;
    pipeline.context.getDevice().queue.writeBuffer(pipeline.dofUniformBuffer, 0, ab);
  }

/**
   * Execute screen-space motion blur pass.
   * Returns the source view when disabled so downstream passes can consume one texture path.
   */
  encodeMotionBlurPass(encoder: GPUCommandEncoder, sourceView: GPUTextureView): GPUTextureView {
    if (!pipeline.renderTargets || !pipeline.pipelines || !pipeline.motionBlurUniformBuffer) return sourceView;
    if (!pipeline.motionBlurConfig.enabled || pipeline.motionBlurConfig.cameraStrength <= 0.0) return sourceView;

    const bindGroup = pipeline.context.getDevice().createBindGroup({
      layout: pipeline.pipelines.motionBlur.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sourceView },
        { binding: 1, resource: pipeline.renderTargets.depthView },
        { binding: 2, resource: pipeline.linearSampler },
        { binding: 3, resource: { buffer: pipeline.motionBlurUniformBuffer } },
      ],
    });

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: pipeline.renderTargets.motionBlurView,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setViewport(0, 0, pipeline.width, pipeline.height, 0, 1);
    pass.setPipeline(pipeline.pipelines.motionBlur);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();

    return pipeline.renderTargets.motionBlurView;
  }

  setAtmosphereScatteringConfig(enabled: boolean, hazeStrength: number): void {
    pipeline.atmosphereScattering.enabled = enabled;
    pipeline.atmosphereScattering.hazeStrength = Math.max(0.0, hazeStrength);
    pipeline.writeAtmosphereScatteringUniform();
  }

  setDepthOfFieldConfig(config: DepthOfFieldQualitySettings): void {
    pipeline.dofConfig = { ...config };
    pipeline.dofFocusDistanceKm = Math.max(1, pipeline.dofConfig.surfaceDistanceKm || pipeline.dofFocusDistanceKm || 1000);
    pipeline.writeDofUniform();
  }

  updateDepthOfFieldFocus(
    cameraPosition: readonly [number, number, number],
    selectedSatelliteIndex: number,
    time: number,
    deltaTime: number,
    getSatellitePosition: (index: number, timeSeconds: number) => readonly [number, number, number]
  ): void {
    if (!pipeline.dofConfig.enabled) return;

    let target = pipeline.dofFocusDistanceKm;
    switch (pipeline.dofConfig.focusMode) {
      case 'satellite-track':
        if (selectedSatelliteIndex >= 0) {
          const pos = getSatellitePosition(selectedSatelliteIndex, time);
          const dx = pos[0] - cameraPosition[0];
          const dy = pos[1] - cameraPosition[1];
          const dz = pos[2] - cameraPosition[2];
          target = Math.max(1, Math.sqrt(dx * dx + dy * dy + dz * dz));
          break;
        }
        target = pipeline.dofFocusDistanceKm;
        break;
      case 'surface-distance':
        target = Math.max(1, pipeline.dofConfig.surfaceDistanceKm);
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
        target = pipeline.dofFocusDistanceKm;
        break;
    }

    const blend = 1.0 - Math.exp(-Math.max(0.1, pipeline.dofConfig.transitionRate) * Math.max(deltaTime, 0.0));
    pipeline.dofFocusDistanceKm += (target - pipeline.dofFocusDistanceKm) * blend;
    pipeline.writeDofUniform();
  }

  setMotionBlurConfig(config: Partial<MotionBlurConfig>): void {
    pipeline.motionBlurConfig = {
      ...pipeline.motionBlurConfig,
      ...config,
      cameraStrength: Math.max(0.0, Math.min(2.0, config.cameraStrength ?? pipeline.motionBlurConfig.cameraStrength)),
      satelliteStretch: Math.max(0.0, Math.min(2.0, config.satelliteStretch ?? pipeline.motionBlurConfig.satelliteStretch)),
      tapCount: Math.max(1, Math.min(16, Math.floor(config.tapCount ?? pipeline.motionBlurConfig.tapCount))),
    };
  }

  setMotionBlurFrameData(viewProjection: Float32Array, inverseViewProjection: Float32Array, viewModeIndex: number, deltaTime: number): void {
    if (!pipeline.motionBlurUniformBuffer) return;

    if (!pipeline.motionBlurHistoryReady) {
      pipeline.prevViewProjection.set(viewProjection);
      pipeline.motionBlurHistoryReady = true;
    }

    const viewModeScale = [0.55, 0.7, 1.0, 0.08, 0.22];
    const viewWeight = viewModeScale[viewModeIndex] ?? 0.5;
    const cameraStrength = pipeline.motionBlurConfig.enabled ? pipeline.motionBlurConfig.cameraStrength * viewWeight : 0.0;
    const satelliteStretch = pipeline.motionBlurConfig.enabled ? pipeline.motionBlurConfig.satelliteStretch * viewWeight : 0.0;

    const data = new ArrayBuffer(144);
    const f32 = new Float32Array(data);
    const u32 = new Uint32Array(data);
    f32.set(pipeline.prevViewProjection, 0);
    f32.set(inverseViewProjection, 16);
    f32[32] = cameraStrength;
    f32[33] = satelliteStretch;
    f32[34] = Math.max(0.0, deltaTime);
    u32[35] = pipeline.motionBlurConfig.tapCount;

    pipeline.context.getDevice().queue.writeBuffer(pipeline.motionBlurUniformBuffer, 0, data);
    pipeline.prevViewProjection.set(viewProjection);
  }



  export function writeAtmosphereScatteringUniform(pipeline: any, ): void  {
    if (!pipeline.atmosphereSettingsBuffer) return;
    const ab = new ArrayBuffer(16);
    const f32 = new Float32Array(ab);
    const u32 = new Uint32Array(ab);
    u32[0] = pipeline.atmosphereScattering.enabled ? 1 : 0;
    u32[1] = 0;
    f32[2] = pipeline.atmosphereScattering.hazeStrength;
    f32[3] = 0.0;
    pipeline.context.getDevice().queue.writeBuffer(pipeline.atmosphereSettingsBuffer, 0, ab);
  }

/**
   * Apply DoF passes and return the scene texture view that should feed bloom/composite.
   */
  encodeDepthOfFieldPasses(encoder: GPUCommandEncoder): GPUTextureView {
    if (!pipeline.pipelines || !pipeline.renderTargets || !pipeline.dofConfig.enabled || !pipeline.dofUniformBuffer) {
      if (!pipeline.renderTargets) throw new Error('RenderPipeline not initialized');
      return pipeline.renderTargets.hdrView;
    }

    const device = pipeline.context.getDevice();
    const halfWidth = Math.max(1, Math.floor(pipeline.width / 2));
    const halfHeight = Math.max(1, Math.floor(pipeline.height / 2));

    const downsampleBG = device.createBindGroup({
      layout: pipeline.pipelines.dofDownsample.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: pipeline.renderTargets.hdrView },
        { binding: 1, resource: pipeline.renderTargets.depthView },
        { binding: 2, resource: pipeline.linearSampler },
        { binding: 3, resource: { buffer: pipeline.dofUniformBuffer } },
      ],
    });
    const blurHBG = device.createBindGroup({
      layout: pipeline.pipelines.dofBlurH.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: pipeline.dofUniformBuffer } },
        { binding: 1, resource: pipeline.renderTargets.dofHalfAView },
        { binding: 2, resource: pipeline.linearSampler },
      ],
    });
    const blurVBG = device.createBindGroup({
      layout: pipeline.pipelines.dofBlurV.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: pipeline.dofUniformBuffer } },
        { binding: 1, resource: pipeline.renderTargets.dofHalfBView },
        { binding: 2, resource: pipeline.linearSampler },
      ],
    });
    const compositeBG = device.createBindGroup({
      layout: pipeline.pipelines.dofComposite.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: pipeline.renderTargets.hdrView },
        { binding: 1, resource: pipeline.renderTargets.dofHalfAView },
        { binding: 2, resource: pipeline.linearSampler },
        { binding: 3, resource: { buffer: pipeline.dofUniformBuffer } },
      ],
    });

    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: pipeline.renderTargets.dofHalfAView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.setViewport(0, 0, halfWidth, halfHeight, 0, 1);
      pass.setPipeline(pipeline.pipelines.dofDownsample);
      pass.setBindGroup(0, downsampleBG);
      pass.draw(3);
      pass.end();
    }
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: pipeline.renderTargets.dofHalfBView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.setViewport(0, 0, halfWidth, halfHeight, 0, 1);
      pass.setPipeline(pipeline.pipelines.dofBlurH);
      pass.setBindGroup(0, blurHBG);
      pass.draw(3);
      pass.end();
    }
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: pipeline.renderTargets.dofHalfAView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.setViewport(0, 0, halfWidth, halfHeight, 0, 1);
      pass.setPipeline(pipeline.pipelines.dofBlurV);
      pass.setBindGroup(0, blurVBG);
      pass.draw(3);
      pass.end();
    }
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: pipeline.renderTargets.dofCompositeView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.setViewport(0, 0, pipeline.width, pipeline.height, 0, 1);
      pass.setPipeline(pipeline.pipelines.dofComposite);
      pass.setBindGroup(0, compositeBG);
      pass.draw(3);
      pass.end();
    }

    return pipeline.renderTargets.dofCompositeView;
  }



  export function createAtmosphereLUT(pipeline: any, ): void  {
    if (pipeline.atmosphereLUT) return;
    const device = pipeline.context.getDevice();
    pipeline.atmosphereLUT = device.createTexture({
      size: [ATMOSPHERE_LUT_WIDTH, ATMOSPHERE_LUT_HEIGHT],
      format: 'rg16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      label: 'Atmosphere LUT',
    });
    pipeline.atmosphereLUTView = pipeline.atmosphereLUT.createView();

    const lut = RenderPipeline.buildAtmosphereLUT();
    const lutBytes = new Uint8Array(lut.buffer.slice(0) as ArrayBuffer);
    device.queue.writeTexture(
      { texture: pipeline.atmosphereLUT },
      lutBytes,
      { bytesPerRow: ATMOSPHERE_LUT_WIDTH * 4, rowsPerImage: ATMOSPHERE_LUT_HEIGHT },
      { width: ATMOSPHERE_LUT_WIDTH, height: ATMOSPHERE_LUT_HEIGHT, depthOrArrayLayers: 1 }
    );
  }

/**
   * Get render targets
   */
  getRenderTargets(): RenderTargets | null {
    return pipeline.renderTargets;
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

  export function createBloomThresholdBindGroup(pipeline: any, sceneSourceView: GPUTextureView): GPUBindGroup  {
    if (!pipeline.pipelines || !pipeline.bloomThresholdUniformBuffer) {
      throw new Error('RenderPipeline not initialized');
    }
    const device = pipeline.context.getDevice();
    return device.createBindGroup({
      layout: pipeline.pipelines.bloomThreshold.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sceneSourceView },
        { binding: 1, resource: pipeline.linearSampler },
        { binding: 2, resource: { buffer: pipeline.bloomThresholdUniformBuffer } },
      ],
    });
  }

/**
   * Get the HDR render target view.
   * Used by the volumetric beam renderer to composite god-ray results
   * additively into the scene after the main render pass.
   */
  getHDRView(): GPUTextureView {
    if (!pipeline.renderTargets) {
      throw new Error('RenderPipeline not initialized');
    }
    return pipeline.renderTargets.hdrView;
  }



  export function createCompositeBindGroup(pipeline: any, sceneSourceView: GPUTextureView): GPUBindGroup  {
    if (!pipeline.pipelines || !pipeline.renderTargets || !pipeline.bloomCompositeUniformBuffer || !pipeline.autoExposureStateBuffer || !pipeline.tonemapUniformBuffer) {
      throw new Error('RenderPipeline not initialized');
    }
    const device = pipeline.context.getDevice();
    const bloomResultView = pipeline.renderTargets.bloomMipViews[0];
    return device.createBindGroup({
      layout: pipeline.pipelines.composite.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sceneSourceView },
        { binding: 1, resource: bloomResultView },
        { binding: 2, resource: pipeline.linearSampler },
        { binding: 3, resource: { buffer: pipeline.buffers.uniforms } },
        { binding: 4, resource: { buffer: pipeline.bloomCompositeUniformBuffer } },
        { binding: 5, resource: { buffer: pipeline.autoExposureStateBuffer } },
        { binding: 6, resource: { buffer: pipeline.tonemapUniformBuffer } },
      ],
    });
  }
