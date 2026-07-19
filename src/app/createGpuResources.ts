import { SatelliteGPUBuffer } from '@/core/SatelliteGPUBuffer.js';
import { RenderPipeline } from '@/render/RenderPipeline.js';
import { PostProcessStack } from '@/render/PostProcessStack.js';
import { TrailRenderer } from '@/render/TrailRenderer.js';
import { ConstellationGuides } from '@/render/ConstellationGuides.js';
import { MoonRingGuide } from '@/render/MoonRingGuide.js';
import { EarthAtmosphereRenderer } from '@/earth.js';
import { FocusManager } from '@/focus.js';
import { createEarthGeometry } from '@/core/EarthGeometry.js';
import { CONSTANTS } from '@/types/constants.js';
import { loadSavedQualityLevel, type QualityLevel } from '@/core/QualityPresets.js';
import { parseInitialStateFromURL } from '@/app/UrlState.js';
import { applyQualityPreset } from '@/app/QualityController.js';
import { applyExposureSettings } from '@/app/AppCallbackBinder.js';
import { setupImageTuning } from '@/app/ViewModeCoordinator.js';
import { setPatternMode, setAnimationPattern, setPhysicsMode } from '@/app/PatternController.js';
import { loadSatelliteOrbitalData } from '@/app/loadSatelliteOrbitalData.js';
import { applyVisualHarnessParams } from '@/app/UrlState.js';
import { resolveGpuCullingEnabled } from '@/core/CullingOptions.js';
import type { AppRuntime } from '@/app/AppRuntime.js';

export type GpuResourceBootMode = 'boot' | 'recovery';

export interface CreateGpuResourcesOptions {
  mode: GpuResourceBootMode;
  resizeListener?: () => void;
}

function drawableSize(rt: AppRuntime): { width: number; height: number } {
  const rawDpr = window.devicePixelRatio || 1;
  const dpr = rt.isMobileDevice ? Math.min(rawDpr, 1.5) : rawDpr;
  return {
    width: Math.floor(rt.canvas.clientWidth * dpr),
    height: Math.floor(rt.canvas.clientHeight * dpr),
  };
}

/**
 * Create or recreate all WebGPU resources that depend on the active device.
 * Used for initial boot and for device-loss recovery.
 */
export async function createGpuResources(
  rt: AppRuntime,
  options: CreateGpuResourcesOptions,
): Promise<void> {
  if (!rt.context) {
    throw new Error('WebGPUContext must be initialized before creating GPU resources');
  }

  const reporter = rt.context.getErrorReporter();
  const device = rt.context.getDevice();

  await reporter.withScope(device, 'profiler-init', () => {
    rt.profiler.initialize(device);
  });

  rt.buffers = new SatelliteGPUBuffer(rt.context);
  const bufferSet = await reporter.withScope(device, 'satellite-buffers', () =>
    rt.buffers!.initialize(),
  );

  rt.focusManager = new FocusManager(rt.canvas, rt.camera, rt.buffers, (selection) =>
    rt.handleFocusSelectionChange(selection),
  );

  if (options.mode === 'boot') {
    const earlyUrl = parseInitialStateFromURL();
    if (earlyUrl.realismMode !== null) {
      rt.simulation.realismMode = earlyUrl.realismMode;
    }
  }

  await loadSatelliteOrbitalData(rt);
  if (options.mode === 'boot') {
    applyVisualHarnessParams(rt);
    rt.ui.updateSimClock(rt.simulation.clock);
  }

  const earthGeom = await reporter.withScope(device, 'earth-geometry', () =>
    createEarthGeometry(rt.context!),
  );
  rt.earthVertexBuffer = earthGeom.vertexBuffer;
  rt.earthIndexBuffer = earthGeom.indexBuffer;
  rt.earthIndexCount = earthGeom.indexCount;

  rt.pipeline = new RenderPipeline(rt.context, bufferSet);

  const { width, height } = drawableSize(rt);
  rt.canvas.width = width;
  rt.canvas.height = height;

  await reporter.withScope(device, 'render-pipeline', () => {
    rt.pipeline!.initialize(width, height);
    rt.pipeline!.setGpuCullingEnabled(resolveGpuCullingEnabled());
  });
  rt.buffers.updateBloomUniforms(width, height);

  if (options.mode === 'boot' && options.resizeListener) {
    window.addEventListener('resize', options.resizeListener);
  }

  await reporter.withScope(device, 'skyline-buffers', () => {
    rt.skyline.createBuffers(device);
  });
  rt.pipeline.setSkylineResources(
    rt.skyline.getCityUniformBuffer(),
    rt.skyline.getInstanceBuffer(),
  );

  rt.postProcessStack = new PostProcessStack(
    rt.context,
    {},
    { enabled: rt.simulation.taaEnabled },
    true,
  );
  await reporter.withScope(device, 'post-process-stack', () => {
    rt.postProcessStack!.initialize(width, height);
  });

  rt.trailRenderer = new TrailRenderer(rt.context, {
    enabled: false,
    maxLength: 45,
    fadeOut: 45,
    colorByShell: true,
    ribbonWidth: 8.0,
  });
  await reporter.withScope(device, 'trail-renderer', () => {
    rt.trailRenderer!.initialize();
  });

  rt.constellationGuides = new ConstellationGuides(rt.context);
  rt.moonRingGuide = new MoonRingGuide(rt.context);

  rt.earthAtmosphereRenderer = new EarthAtmosphereRenderer(rt.context, {
    enabled: true,
    cloudSpeed: 0.02,
    cloudAlpha: 0.38,
    cloudScale: 1.006,
    hazeStrength: 0.28,
  });
  await reporter.withScope(device, 'earth-atmosphere', () => {
    rt.earthAtmosphereRenderer!.initialize(rt.buffers!.getBuffers().uniforms);
  });

  rt.ui.setFleetCount(CONSTANTS.NUM_SATELLITES);
  rt.ui.hideError();

  if (options.mode === 'boot') {
    const urlParams = parseInitialStateFromURL();
    const savedQuality = loadSavedQualityLevel();
    const initialQuality: QualityLevel =
      urlParams.qualityLevel ??
      savedQuality ??
      (rt.isMobileDevice ? rt.mobileDefaultQuality : 'high');
    rt.simulation.currentQualityLevel = initialQuality;

    applyQualityPreset(rt, initialQuality);
    applyExposureSettings(rt);
    setupImageTuning(rt);

    const initialViewMode = urlParams.viewMode ?? 0;
    rt.camera.setViewMode(initialViewMode);

    if (urlParams.physicsMode !== null) {
      setPhysicsMode(rt, urlParams.physicsMode);
      rt.ui.setActivePhysicsButton(urlParams.physicsMode);
    }

    if (urlParams.patternMode !== null) {
      setPatternMode(rt, urlParams.patternMode);
    }

    if (urlParams.animationMode !== null) {
      setAnimationPattern(rt, urlParams.animationMode);
    }

    await rt.ui.initializeDashboard(rt.profiler);
    if (rt.context) {
      rt.ui.setPresentationMode(rt.context.getPresentationMode());
    }
    return;
  }

  // Recovery: restore render settings from preserved simulation state.
  rt.pipeline.setGpuCullingEnabled(resolveGpuCullingEnabled());
  applyQualityPreset(rt, rt.simulation.currentQualityLevel);
  applyExposureSettings(rt);
  setupImageTuning(rt);
  rt.syncVolumetricBeamConfig();
}
