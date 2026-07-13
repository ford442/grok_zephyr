import { OrbitalElements } from '@/core/OrbitalElements.js';
import { acquireTLECatalog, acquireCustomTLEUrl, resolveActiveCatalogId, resolveCustomTLEUrl } from '@/data/TLESource.js';
import { buildEarthMesh } from '@/core/EarthGeometry.js';
import { WebGLRenderer } from '@/webgl/WebGLRenderer.js';
import { WebGLDebugOverlay, parseDebugFlags } from '@/webgl/WebGLDebug.js';
import { resolveSatelliteCount } from '@/webgl/rendererSelection.js';
import { parseVisualHarnessParams } from '@/visualHarness.js';
import { applyVisualHarnessParams, parseInitialStateFromURL } from '@/app/UrlState.js';
import { syncSimClockFromTleEpoch } from '@/app/SimClockController.js';
import { setupImageTuning } from '@/app/ViewModeCoordinator.js';
import { getDrawableSize, setupMobileOrientationSupport } from '@/app/MobilePresentation.js';
import { setPatternMode, setAnimationPattern } from '@/app/PatternController.js';
import { FocusManager, type FocusBufferSource } from '@/focus.js';
import { rebuildSatelliteCatalog } from '@/app/SatelliteSelection.js';
import { startWebGLLoop } from '@/app/FrameLoop.js';
import type { AppRuntime } from '@/app/AppRuntime.js';

export async function bootWebGL(
  rt: AppRuntime,
  resizeListener: () => void,
  orientationChangeListener: () => void,
  orientationLockGestureListener: () => void,
): Promise<void> {
  console.log('[GrokZephyr] Booting WebGL2 fallback renderer...');

  const orbital = new OrbitalElements();
  rt.webglOrbital = orbital;

  const harness = parseVisualHarnessParams();
  const catalogId = resolveActiveCatalogId();
  const customUrl = resolveCustomTLEUrl();
  const catalogResult = customUrl
    ? await acquireCustomTLEUrl(customUrl)
    : await acquireTLECatalog(catalogId);

  let dataSourceLabel = 'Procedural Walker';
  let tleRealCount = 0;
  if (catalogResult.tles.length > 0) {
    tleRealCount = orbital.loadFromTLE(catalogResult.tles);
    dataSourceLabel = `TLE · ${catalogResult.meta.label} (${tleRealCount.toLocaleString()} real)`;
    rt.simulation.hasTleCatalog = true;
  } else {
    orbital.generate(harness.seed ?? undefined);
  }

  rt.loadedTles = catalogResult.tles;
  rt.tleRealCount = tleRealCount;
  const focusSource: FocusBufferSource = {
    getOrbitalElementData: () => orbital.data,
    calculateSatellitePosition: (index, time) => orbital.calculatePosition(index, time),
    calculateSatelliteVelocity: (index, time) => orbital.calculateVelocity(index, time),
  };
  rt.focusManager = new FocusManager(rt.canvas, rt.camera, focusSource, (selection) =>
    rt.handleFocusSelectionChange(selection),
  );
  rebuildSatelliteCatalog(rt);

  rt.tleCatalogMeta = catalogResult.meta;
  syncSimClockFromTleEpoch(rt, catalogResult.meta.epoch);
  rt.camera.attachToCanvas(rt.canvas);
  setupMobileOrientationSupport(rt, orientationChangeListener, orientationLockGestureListener);

  const satCount = resolveSatelliteCount();
  const renderer = new WebGLRenderer(rt.canvas, orbital, satCount);
  const size = getDrawableSize(rt) ?? {
    width: rt.canvas.clientWidth || 1280,
    height: rt.canvas.clientHeight || 720,
  };
  renderer.initialize(size.width, size.height, buildEarthMesh());
  renderer.setDebug(parseDebugFlags(window.location.search));
  rt.webglRenderer = renderer;

  rt.webglDebugOverlay = new WebGLDebugOverlay(renderer, rt.canvas);
  rt.webglDebugOverlay.install();

  rt.ui.setFleetCount(satCount);
  rt.ui.setDataSource(`${dataSourceLabel} · WebGL2`);
  rt.ui.setTleCatalogMeta(catalogResult.meta);
  rt.ui.setActiveTleCatalog(catalogId, catalogResult.meta);
  rt.ui.setRealismControls(false, rt.simulation.hasTleCatalog);
  rt.dataSourceLabel = dataSourceLabel;
  rt.ui.hideError();

  const urlParams = parseInitialStateFromURL();
  rt.camera.setViewMode(urlParams.viewMode ?? 0);
  if (urlParams.patternMode !== null) {
    setPatternMode(rt, urlParams.patternMode);
  }
  if (urlParams.animationMode !== null) {
    setAnimationPattern(rt, urlParams.animationMode);
  }
  applyVisualHarnessParams(rt);
  rt.ui.updateSimClock(rt.simulation.clock);
  setupImageTuning(rt);

  window.addEventListener('resize', resizeListener);
  startWebGLLoop(rt);
}
