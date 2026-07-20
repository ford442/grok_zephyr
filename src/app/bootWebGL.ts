import { OrbitalElements } from '@/core/OrbitalElements.js';
import { resolveCustomTLEUrl, acquireCustomTLEUrl } from '@/data/TLESource.js';
import {
  composeConstellationCatalog,
  composeProceduralCatalog,
} from '@/data/ConstellationComposer.js';
import {
  createDefaultVisibility,
  formatGroupCountLegend,
  readSavedConstellationSelection,
  shouldUseMultiGroupColors,
} from '@/data/ConstellationGroups.js';
import { getSimWorkerClient } from '@/workers/SimWorkerClient.js';
import { CONSTANTS } from '@/types/constants.js';
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
  const customUrl = resolveCustomTLEUrl();
  const enabledIds = readSavedConstellationSelection();
  const merged = customUrl
    ? await (async () => {
        const result = await acquireCustomTLEUrl(customUrl);
        return {
          tles: result.tles,
          segments: result.tles.length > 0 ? [{ tles: result.tles, groupId: 1 }] : [],
          groupCounts:
            result.tles.length > 0 ? new Map([[1, result.tles.length]]) : new Map<number, number>(),
          meta: {
            catalogs: [result.meta],
            epoch: result.meta.epoch,
            totalRealCount: result.tles.length,
          },
        };
      })()
    : enabledIds.length > 0
      ? await composeConstellationCatalog(enabledIds)
      : composeProceduralCatalog();

  let dataSourceLabel = 'Procedural Walker';
  let tleRealCount = 0;
  const simWorker = getSimWorkerClient();
  const multiGroupColorMode = shouldUseMultiGroupColors(enabledIds);
  const visibility = createDefaultVisibility();
  visibility.multiGroupColorMode = multiGroupColorMode;
  rt.webglGroupVisibility = [...visibility.visible];
  rt.webglMultiGroupColorMode = multiGroupColorMode;

  if (merged.segments.length > 0 && merged.tles.length > 0) {
    const result = await simWorker.mergeCatalogElements(merged.segments, CONSTANTS.NUM_SATELLITES);
    orbital.adoptBuffer(result.orbitalBuffer);
    if (result.groupIdsBuffer) {
      rt.webglGroupIds = new Uint32Array(result.groupIdsBuffer);
    }
    tleRealCount = result.realTleCount;
    dataSourceLabel = formatGroupCountLegend(merged.groupCounts) || 'TLE';
    rt.simulation.hasTleCatalog = true;
  } else {
    const result = await simWorker.generateOrbitalElements(
      CONSTANTS.NUM_SATELLITES,
      harness.seed ?? undefined,
    );
    orbital.adoptBuffer(result.orbitalBuffer);
    if (result.groupIdsBuffer) {
      rt.webglGroupIds = new Uint32Array(result.groupIdsBuffer);
    }
  }

  rt.loadedTles = merged.tles;
  rt.tleRealCount = tleRealCount;
  rt.enabledConstellations = [...enabledIds];
  rt.constellationGroupCounts = merged.groupCounts;
  const focusSource: FocusBufferSource = {
    getOrbitalElementData: () => orbital.data,
    calculateSatellitePosition: (index, time) => orbital.calculatePosition(index, time),
    calculateSatelliteVelocity: (index, time) => orbital.calculateVelocity(index, time),
  };
  rt.focusManager = new FocusManager(rt.canvas, rt.camera, focusSource, (selection) =>
    rt.handleFocusSelectionChange(selection),
  );
  rebuildSatelliteCatalog(rt);

  rt.tleCatalogMeta = merged.meta.catalogs[0] ?? null;
  syncSimClockFromTleEpoch(rt, merged.meta.epoch);
  rt.camera.attachToCanvas(rt.canvas);
  setupMobileOrientationSupport(rt, orientationChangeListener, orientationLockGestureListener);

  const satCount = resolveSatelliteCount();
  const renderer = new WebGLRenderer(rt.canvas, orbital, satCount, rt.webglGroupIds);
  renderer.setGroupVisibilityState(visibility);
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
  rt.ui.setTleCatalogMeta(rt.tleCatalogMeta);
  rt.ui.setConstellationLegend(formatGroupCountLegend(merged.groupCounts));
  rt.ui.setConstellationChips(enabledIds, merged.groupCounts, rt.webglGroupVisibility);
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
