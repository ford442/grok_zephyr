import { OrbitalElements } from '@/core/OrbitalElements.js';
import { TLELoader } from '@/data/TLELoader.js';
import { getTLESource } from '@/data/tleSource.js';
import { buildEarthMesh } from '@/core/EarthGeometry.js';
import { WebGLRenderer } from '@/webgl/WebGLRenderer.js';
import { WebGLDebugOverlay, parseDebugFlags } from '@/webgl/WebGLDebug.js';
import { resolveSatelliteCount } from '@/webgl/rendererSelection.js';
import { getBackgroundModeIndex, resolveBackgroundMode, setBackgroundMode } from '@/background.js';
import { FLEET_COCKPIT } from '@/camera/FleetCockpit.js';
import { parseVisualHarnessParams } from '@/visualHarness.js';
import { parseInitialStateFromURL, applyVisualHarnessParams } from '@/app/UrlState.js';
import { setupImageTuning, applyViewTuning } from '@/app/ImageTuningController.js';
import { getDrawableSize, setupMobileOrientationSupport } from '@/app/MobilePresentation.js';
import {
  applyGroundPresetEffects,
  applyHorizonViewEffects,
  applyGodViewEffects,
  applyFleetViewEffects,
} from '@/app/ViewEffectsController.js';
import { setPatternMode, setAnimationPattern } from '@/app/PatternController.js';
import { calculateSunPosition } from '@/app/UniformWriter.js';
import type { AppRuntime } from '@/app/AppRuntime.js';

export async function initializeWebGL(
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

  rt.isRunning = true;
  rt.lastTime = performance.now() * 0.001;
  rt.animationId = requestAnimationFrame(createWebGLRenderLoop(rt));
  console.log('[GrokZephyr] WebGL2 renderer ready.');
}

export function createWebGLRenderLoop(rt: AppRuntime): (timestamp: number) => void {
  const render = (timestamp: number): void => {
    if (!rt.isRunning || !rt.webglRenderer || !rt.webglOrbital) return;

    const size = getDrawableSize(rt);
    if (size && (size.width !== rt.canvas.width || size.height !== rt.canvas.height)) {
      rt.handleResize();
    }

    const time = timestamp * 0.001;
    const deltaTime = Math.min(time - rt.lastTime, 0.1);
    rt.lastTime = time;
    rt.simTime += deltaTime * rt.timeScale;

    applyViewTuning(rt, time);
    applyGroundPresetEffects(rt, deltaTime);
    rt.camera.updateHorizonDrift(time, deltaTime);
    rt.camera.updateGodIdleOrbit(time, deltaTime);

    if (
      rt.demoAutoEnabled &&
      !rt.camera.isCinematicActive() &&
      time - rt.lastUserActivityTime >= rt.demoIdleTimeoutSeconds
    ) {
      rt.camera.startCinematic(time);
    }

    setBackgroundMode(resolveBackgroundMode(rt.camera.getViewMode()));
    if (rt.camera.getViewMode() === 'ground') {
      rt.groundObserver.update();
    }

    const aspect = rt.canvas.width / Math.max(1, rt.canvas.height);
    const orbital = rt.webglOrbital;
    const cameraState = rt.camera.calculateCamera(
      (idx, t) => orbital.calculatePosition(idx, t),
      (idx, t) => orbital.calculateVelocity(idx, t),
      time,
    );
    const { viewProjection } = rt.camera.buildViewProjection(cameraState, aspect);
    const sun = calculateSunPosition(rt.simTime);
    applyHorizonViewEffects(rt, cameraState, viewProjection, sun, rt.canvas.height);
    applyGodViewEffects(rt, cameraState);
    applyFleetViewEffects(rt, rt.simTime);

    const sunLen = Math.hypot(sun[0], sun[1], sun[2]) || 1;
    const fleetHostVel =
      rt.camera.getViewMode() === 'sat-pov'
        ? orbital.calculateVelocity(FLEET_COCKPIT.HOST_SATELLITE_INDEX, rt.simTime)
        : undefined;

    rt.webglRenderer.renderFrame({
      viewProj: viewProjection,
      cameraPos: cameraState.position as [number, number, number],
      sunDir: [sun[0] / sunLen, sun[1] / sunLen, sun[2] / sunLen],
      simTime: rt.simTime,
      time,
      backgroundMode: getBackgroundModeIndex(),
      viewMode: rt.camera.getViewModeIndex(),
      timeScale: rt.timeScale,
      hostVelocity: fleetHostVel,
    });

    rt.animationId = requestAnimationFrame(render);
  };
  return render;
}
