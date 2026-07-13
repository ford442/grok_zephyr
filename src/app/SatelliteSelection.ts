/**
 * Satellite selection — GPU picking, inspector, search, and camera framing.
 */

import type { FocusSelection } from '@/focus.js';
import type { AppRuntime } from '@/app/AppRuntime.js';
import { updateSelectedSatelliteIndex } from '@/app/PatternController.js';
import { CAMERA } from '@/types/constants.js';

export function rebuildSatelliteCatalog(rt: AppRuntime): void {
  const orbitalData = rt.buffers?.getOrbitalElementData() ?? rt.webglOrbital?.data;
  if (!orbitalData) return;
  const tles = rt.buffers?.getLoadedTles() ?? rt.loadedTles;
  const tleCount = rt.buffers?.getTleRealCount() ?? rt.tleRealCount;
  rt.satelliteCatalog.rebuild(tles, tleCount, orbitalData);
  rt.focusManager?.setCatalog(rt.satelliteCatalog);
}

export function buildSelection(
  rt: AppRuntime,
  index: number,
  simTime: number,
): FocusSelection | null {
  if (index < 0) return null;
  if (!rt.buffers && !rt.webglOrbital) return null;

  const position = rt.buffers
    ? rt.buffers.calculateSatellitePosition(index, simTime)
    : rt.webglOrbital!.calculatePosition(index, simTime);
  const velocityDir = rt.buffers
    ? rt.buffers.calculateSatelliteVelocity(index, simTime)
    : rt.webglOrbital!.calculateVelocity(index, simTime);
  const orbital = rt.buffers?.getOrbitalElementData() ?? rt.webglOrbital!.data;
  const shellIndex = (orbital[index * 4 + 3] >> 8) & 0xff;
  const meanMotions = [0.001153, 0.001097, 0.000946];
  const orbitRadii = [6711.0, 6921.0, 7521.0];
  const speed =
    (orbitRadii[shellIndex] ?? 6921.0) * (meanMotions[shellIndex] ?? 0.001097);
  const altitude = Math.max(
    0,
    Math.hypot(position[0], position[1], position[2]) - 6371,
  );

  return {
    index,
    position,
    velocity: [velocityDir[0] * speed, velocityDir[1] * speed, velocityDir[2] * speed],
    altitude,
    speed,
  };
}

export async function pickSatelliteAtScreen(
  rt: AppRuntime,
  clientX: number,
  clientY: number,
): Promise<number> {
  const simTime = rt.simulation.clock.simTime;

  if (rt.backend === 'webgl' && rt.webglRenderer && rt.webglOrbital) {
    const aspect = rt.canvas.width / Math.max(1, rt.canvas.height);
    const cameraState = rt.camera.calculateCamera(
      (idx, t) => rt.webglOrbital!.calculatePosition(idx, t),
      (idx, t) => rt.webglOrbital!.calculateVelocity(idx, t),
      rt.loop.lastTime || performance.now() / 1000,
    );
    const { viewProjection } = rt.camera.buildViewProjection(cameraState, aspect);
    const sunLen =
      Math.hypot(
        ...(() => {
          const angle = (simTime / 31557600) * Math.PI * 2;
          return [Math.cos(angle), Math.sin(angle), 0] as const;
        })(),
      ) || 1;
    const angle = (simTime / 31557600) * Math.PI * 2;
    return rt.webglRenderer.pickSatelliteAt(
      {
        viewProj: viewProjection,
        cameraPos: cameraState.position,
        sunDir: [Math.cos(angle) / sunLen, Math.sin(angle) / sunLen, 0],
        simTime,
        time: rt.loop.lastTime || performance.now() / 1000,
        backgroundMode: 0,
        viewMode: rt.camera.getViewModeIndex(),
        timeScale: rt.simulation.clock.rate,
      },
      clientX,
      clientY,
    );
  }

  if (rt.pipeline) {
    return rt.pipeline.pickSatelliteAt(clientX, clientY, rt.canvas);
  }

  return -1;
}

export function selectSatelliteIndex(rt: AppRuntime, index: number): void {
  if (index < 0 || !rt.focusManager) return;

  const simTime = rt.simulation.clock.simTime;
  const selection = buildSelection(rt, index, simTime);
  if (!selection) return;

  updateSelectedSatelliteIndex(rt, index);
  rt.focusManager.showSelection(selection, rt.satelliteCatalog, simTime);

  if (rt.camera.getViewMode() === 'sat-pov') {
    rt.fleetHostIndex = index;
  }
}

export function followSelectedSatellite(rt: AppRuntime): void {
  if (!rt.focusManager || rt.selectedSatelliteIndex < 0) return;
  const simTime = rt.simulation.clock.simTime;
  const selection = buildSelection(rt, rt.selectedSatelliteIndex, simTime);
  if (selection) {
    rt.focusManager.followSelection(selection);
  }
}

export function frameSatelliteInGodView(rt: AppRuntime, index: number): void {
  if (index < 0) return;
  const simTime = rt.simulation.clock.simTime;
  const position = rt.buffers
    ? rt.buffers.calculateSatellitePosition(index, simTime)
    : rt.webglOrbital?.calculatePosition(index, simTime);
  if (!position) return;
  rt.camera.frameSatelliteInGodView(position);
  selectSatelliteIndex(rt, index);
}

export async function pickAndSelectAtScreen(
  rt: AppRuntime,
  clientX: number,
  clientY: number,
): Promise<void> {
  const index = await pickSatelliteAtScreen(rt, clientX, clientY);
  if (index >= 0) {
    selectSatelliteIndex(rt, index);
  }
}

export function searchAndSelectSatellite(rt: AppRuntime, query: string): void {
  const results = rt.satelliteCatalog.search(query, 1);
  if (results.length === 0) return;
  frameSatelliteInGodView(rt, results[0]);
}

export function clampGodFrameDistance(position: readonly [number, number, number]): number {
  const r = Math.hypot(position[0], position[1], position[2]);
  return Math.max(
    CAMERA.GOD_VIEW_MIN_DISTANCE,
    Math.min(CAMERA.GOD_VIEW_MAX_DISTANCE, r * 1.35),
  );
}
