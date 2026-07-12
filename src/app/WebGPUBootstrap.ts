import { WebGPUContext } from '@/core/WebGPUContext.js';
import { SatelliteGPUBuffer } from '@/core/SatelliteGPUBuffer.js';
import { RenderPipeline } from '@/render/RenderPipeline.js';
import { PostProcessStack } from '@/render/PostProcessStack.js';
import { TrailRenderer } from '@/render/TrailRenderer.js';
import { ConstellationGuides } from '@/render/ConstellationGuides.js';
import { MoonRingGuide } from '@/render/MoonRingGuide.js';
import { EarthAtmosphereRenderer } from '@/earth.js';
import { FocusManager } from '@/focus.js';
import { TLELoader } from '@/data/TLELoader.js';
import { getTLESource } from '@/data/tleSource.js';
import { createEarthGeometry } from '@/core/EarthGeometry.js';
import { CONSTANTS } from '@/types/constants.js';
import { QUALITY_PRESETS, type QualityLevel } from '@/core/QualityPresets.js';
import { parseInitialStateFromURL } from '@/app/UrlState.js';
import { applyQualityPreset } from '@/app/QualityController.js';
import { applyExposureSettings } from '@/app/AppCallbackBinder.js';
import { setupImageTuning } from '@/app/ImageTuningController.js';
import { setupMobileOrientationSupport } from '@/app/MobilePresentation.js';
import { setPatternMode, setAnimationPattern, setPhysicsMode } from '@/app/PatternController.js';
import type { AppRuntime } from '@/app/AppRuntime.js';

export async function bootstrapWebGPU(
  rt: AppRuntime,
  resizeListener: () => void,
  orientationChangeListener: () => void,
  orientationLockGestureListener: () => void,
  startRenderLoop: () => void,
): Promise<void> {
  rt.context = new WebGPUContext(rt.canvas);
  const { device } = await rt.context.initialize();

  await rt.profiler.initialize(device);

  rt.camera.attachToCanvas(rt.canvas);
  setupMobileOrientationSupport(rt, orientationChangeListener, orientationLockGestureListener);

  rt.buffers = new SatelliteGPUBuffer(rt.context);
  const bufferSet = rt.buffers.initialize();

  rt.focusManager = new FocusManager(
    rt.canvas,
    rt.camera,
    rt.buffers,
    (selection) => rt.handleFocusSelectionChange(selection),
  );

  const tleSource = getTLESource();
  let dataSourceLabel = 'Procedural Walker';
  let realTLECount = 0;

  if (tleSource) {
    try {
      console.log(`[GrokZephyr] Loading TLE data from: ${tleSource}`);
      const tles = await TLELoader.fromFile(tleSource);
      if (tles.length > 0) {
        realTLECount = rt.buffers.loadFromTLEData(tles);
        dataSourceLabel = `TLE (${realTLECount.toLocaleString()} real)`;
        console.log(`[GrokZephyr] Loaded ${realTLECount} TLE satellites, padded to ${CONSTANTS.NUM_SATELLITES.toLocaleString()}`);
      } else {
        console.warn('[GrokZephyr] TLE source returned 0 records, falling back to procedural');
        rt.buffers.generateOrbitalElements();
      }
    } catch (err) {
      console.warn('[GrokZephyr] TLE fetch/parse failed, falling back to procedural generation:', err);
      rt.buffers.generateOrbitalElements();
    }
  } else {
    rt.buffers.generateOrbitalElements();
  }
  rt.buffers.uploadOrbitalElements();

  const earthGeom = createEarthGeometry(rt.context);
  rt.earthVertexBuffer = earthGeom.vertexBuffer;
  rt.earthIndexBuffer = earthGeom.indexBuffer;
  rt.earthIndexCount = earthGeom.indexCount;

  rt.pipeline = new RenderPipeline(rt.context, bufferSet);

  const rawDpr = window.devicePixelRatio || 1;
  const dpr = rt.isMobileDevice ? Math.min(rawDpr, 1.5) : rawDpr;
  const width = Math.floor(rt.canvas.clientWidth * dpr);
  const height = Math.floor(rt.canvas.clientHeight * dpr);

  rt.canvas.width = width;
  rt.canvas.height = height;

  rt.pipeline.initialize(width, height);
  rt.buffers.updateBloomUniforms(width, height);
  window.addEventListener('resize', resizeListener);

  rt.skyline.createBuffers(rt.context.getDevice());
  rt.pipeline.setSkylineResources(rt.skyline.getCityUniformBuffer(), rt.skyline.getInstanceBuffer());

  rt.postProcessStack = new PostProcessStack(
    rt.context,
    {},
    { enabled: rt.taaEnabled },
    true,
  );
  rt.postProcessStack.initialize(width, height);

  rt.trailRenderer = new TrailRenderer(rt.context, {
    enabled: false,
    maxLength: 45,
    fadeOut: 45,
    colorByShell: true,
    ribbonWidth: 8.0,
  });
  rt.trailRenderer.initialize();

  rt.constellationGuides = new ConstellationGuides(rt.context);
  rt.moonRingGuide = new MoonRingGuide(rt.context);

  rt.earthAtmosphereRenderer = new EarthAtmosphereRenderer(rt.context, {
    enabled: true,
    cloudSpeed: 0.02,
    cloudAlpha: 0.38,
    cloudScale: 1.006,
    hazeStrength: 0.28,
  });
  rt.earthAtmosphereRenderer.initialize(rt.buffers.getBuffers().uniforms);

  rt.ui.setFleetCount(CONSTANTS.NUM_SATELLITES);
  rt.ui.setDataSource(dataSourceLabel);
  rt.dataSourceLabel = dataSourceLabel;
  rt.ui.hideError();

  const urlParams = parseInitialStateFromURL();

  let savedQuality: QualityLevel | null = null;
  try {
    const stored = localStorage.getItem('grokzephyr-quality') as QualityLevel | null;
    if (stored && stored in QUALITY_PRESETS) savedQuality = stored;
  } catch {
    // localStorage unavailable
  }

  const initialQuality: QualityLevel =
    urlParams.qualityLevel ??
    savedQuality ??
    (rt.isMobileDevice ? rt.mobileDefaultQuality : 'high');
  rt.currentQualityLevel = initialQuality;

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
  startRenderLoop();

  console.log('[GrokZephyr] Initialization complete');
}
