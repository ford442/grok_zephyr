import { OrbitalElements } from '@/core/OrbitalElements.js';
import { TLELoader } from '@/data/TLELoader.js';
import { getTLESource } from '@/data/tleSource.js';
import { buildEarthMesh } from '@/core/EarthGeometry.js';
import { WebGLRenderer } from '@/webgl/WebGLRenderer.js';
import { WebGLDebugOverlay, parseDebugFlags } from '@/webgl/WebGLDebug.js';
import { resolveSatelliteCount } from '@/webgl/rendererSelection.js';
import { parseVisualHarnessParams } from '@/visualHarness.js';
import { parseInitialStateFromURL, applyVisualHarnessParams } from '@/app/UrlState.js';
import { setupImageTuning } from '@/app/ViewModeCoordinator.js';
import { getDrawableSize, setupMobileOrientationSupport } from '@/app/MobilePresentation.js';
import { setPatternMode, setAnimationPattern } from '@/app/PatternController.js';
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
  const tleSource = getTLESource();
  let dataSourceLabel = 'Procedural Walker';
  if (tleSource) {
    try {
      console.log(`[GrokZephyr] Loading TLE data from: ${tleSource}`);
      const tles = await TLELoader.fromFile(tleSource);
      if (tles.length > 0) {
        const realCount = orbital.loadFromTLE(tles);
        dataSourceLabel = `TLE (${realCount.toLocaleString()} real)`;
      } else {
        orbital.generate(harness.seed ?? undefined);
      }
    } catch (err) {
      console.warn('[GrokZephyr] TLE load failed, using procedural generation:', err);
      orbital.generate(harness.seed ?? undefined);
    }
  } else {
    orbital.generate(harness.seed ?? undefined);
  }

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
  setupImageTuning(rt);

  window.addEventListener('resize', resizeListener);

  startWebGLLoop(rt);
  console.log('[GrokZephyr] WebGL2 renderer ready.');
}
