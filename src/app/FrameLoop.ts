import { resolveBackgroundMode, setBackgroundMode } from '@/background.js';
import { CONSTANTS } from '@/types/constants.js';
import type { CameraState } from '@/camera/CameraController.js';
import { skylineEmissiveScale } from '@/core/ViewTuningProfile.js';
import { v3dot, v3norm, smoothstep } from '@/utils/math.js';
import { getBackgroundModeIndex } from '@/background.js';
import { estimateVisibleSatellites, recordPassTimings } from '@/app/FrameProfilerEstimates.js';
import { getDrawableSize } from '@/app/MobilePresentation.js';
import {
  applyGroundPresetEffects,
  applyHorizonViewEffects,
  applyGodViewEffects,
  applyFleetViewEffects,
  applyViewTuning,
} from '@/app/ViewModeCoordinator.js';
import {
  buildConstellationStats,
  calculateSunPosition,
  writeUniforms,
} from '@/app/UniformWriter.js';
import type { AppRuntime } from '@/app/AppRuntime.js';

export class FrameLoopState {
  animationId = 0;
  isRunning = false;
  lastTime = 0;
}

export function recordTrailSamplesForCamera(
  rt: AppRuntime,
  time: number,
  cameraState: CameraState,
): void {
  if (!rt.trailRenderer || !rt.buffers || !rt.trailRenderer.isEnabled()) return;

  const orbitalData = rt.buffers.getOrbitalElementData();
  const sampleCount = rt.trailRenderer.getSamplingBudget();
  if (sampleCount <= 0) return;
  const sampleStride = Math.max(1, Math.floor(CONSTANTS.NUM_SATELLITES / sampleCount));
  const phase = rt.trailSamplePhase % sampleStride;
  rt.trailSamplePhase++;

  const position = new Float32Array(3);
  const cameraForward = new Float32Array([
    cameraState.target[0] - cameraState.position[0],
    cameraState.target[1] - cameraState.position[1],
    cameraState.target[2] - cameraState.position[2],
  ]);
  const forwardLen = Math.hypot(cameraForward[0], cameraForward[1], cameraForward[2]) || 1.0;
  cameraForward[0] /= forwardLen;
  cameraForward[1] /= forwardLen;
  cameraForward[2] /= forwardLen;
  const cameraPos = new Float32Array(cameraState.position);
  const maxDistance =
    rt.camera.getViewMode() === 'moon'
      ? 240000
      : rt.camera.getViewMode() === 'god'
        ? 140000
        : 90000;
  const visibilityDotThreshold = rt.camera.getViewMode() === 'god' ? -0.35 : -0.2;

  for (let idx = phase; idx < CONSTANTS.NUM_SATELLITES; idx += sampleStride) {
    const satPos = rt.buffers.calculateSatellitePosition(idx, time);
    const dx = satPos[0] - cameraPos[0];
    const dy = satPos[1] - cameraPos[1];
    const dz = satPos[2] - cameraPos[2];
    const dist = Math.hypot(dx, dy, dz);
    if (dist > maxDistance) continue;
    const invDist = dist > 1e-3 ? 1.0 / dist : 0.0;
    const facing =
      (dx * cameraForward[0] + dy * cameraForward[1] + dz * cameraForward[2]) * invDist;
    if (facing < visibilityDotThreshold) continue;
    position[0] = satPos[0];
    position[1] = satPos[1];
    position[2] = satPos[2];
    const shellIndex = (orbitalData[idx * 4 + 3] >> 8) & 0xff;
    rt.trailRenderer.recordPosition(idx, position, time, shellIndex);
  }
}

export function createWebGPURenderLoop(rt: AppRuntime): (timestamp: number) => void {
  const render = (timestamp: number): void => {
    if (
      !rt.loop.isRunning ||
      !rt.context ||
      !rt.pipeline ||
      !rt.earthVertexBuffer ||
      !rt.earthIndexBuffer
    ) {
      return;
    }

    const size = getDrawableSize(rt);
    if (!size) {
      rt.loop.animationId = requestAnimationFrame(render);
      return;
    }
    const { width, height } = size;
    if (width !== rt.canvas.width || height !== rt.canvas.height) {
      rt.handleResize();
    }

    const time = timestamp * 0.001;
    const deltaTime = Math.min(time - rt.loop.lastTime, 0.1);
    rt.loop.lastTime = time;
    rt.simulation.clock.tick(deltaTime);
    const simTime = rt.simulation.clock.simTime;

    applyViewTuning(rt, time);
    applyGroundPresetEffects(rt, deltaTime);
    rt.camera.updateHorizonDrift(time, deltaTime);
    rt.camera.updateGodIdleOrbit(time, deltaTime);

    if (
      rt.simulation.demoAutoEnabled &&
      !rt.camera.isCinematicActive() &&
      time - rt.simulation.lastUserActivityTime >= rt.demoIdleTimeoutSeconds
    ) {
      rt.camera.startCinematic(time);
    }

    setBackgroundMode(resolveBackgroundMode(rt.camera.getViewMode()));
    rt.profiler.beginFrame(timestamp);

    if (rt.camera.getViewMode() === 'ground') {
      rt.groundObserver.update();
    }

    rt.camera.setFleetHostIndex(rt.fleetHostIndex);
    const cameraState = rt.camera.calculateCamera(
      (idx, t) => rt.buffers!.calculateSatellitePosition(idx, t),
      (idx, t) => rt.buffers!.calculateSatelliteVelocity(idx, t),
      time,
    );
    const aspect = width / height;
    const { viewProjection } = rt.camera.buildViewProjection(cameraState, aspect);
    const sunPos = calculateSunPosition(simTime);
    applyHorizonViewEffects(rt, cameraState, viewProjection, sunPos, height);
    applyGodViewEffects(rt, cameraState);
    applyFleetViewEffects(rt, simTime);
    recordTrailSamplesForCamera(rt, simTime, cameraState);

    if (rt.focusManager) {
      rt.focusManager.setCameraPosition(cameraState.position);
      rt.focusManager.setConstellationStats(buildConstellationStats(rt));
      rt.focusManager.update(simTime);
    }

    if (rt.trailRenderer) {
      const forward = new Float32Array([
        cameraState.target[0] - cameraState.position[0],
        cameraState.target[1] - cameraState.position[1],
        cameraState.target[2] - cameraState.position[2],
      ]);
      const fLen = Math.hypot(forward[0], forward[1], forward[2]) || 1.0;
      forward[0] /= fLen;
      forward[1] /= fLen;
      forward[2] /= fLen;
      rt.trailRenderer.updateGeometry(
        simTime,
        new Float32Array(cameraState.position),
        forward,
      );
    }
    writeUniforms(rt, time, deltaTime, cameraState);
    rt.buffers?.tickSgp4Reanchor(simTime);
    rt.pipeline.updateDepthOfFieldFocus(
      cameraState.position,
      rt.selectedSatelliteIndex,
      time,
      deltaTime,
      (idx, t) => rt.buffers!.calculateSatellitePosition(idx, t),
    );

    const encoder = rt.context.createCommandEncoder('frame');
    rt.pipeline.encodeComputePass(encoder);
    rt.pipeline.encodeBeamComputePass(encoder);

    if (rt.camera.getViewMode() === 'ground') {
      const hz = rt.groundObserver.getHorizonSettings();
      rt.pipeline.setGroundViewParams(hz.oceanBias, hz.urbanGlow, hz.overlayFade, hz.hazeBoost);
      rt.pipeline.encodeGroundScenePass(encoder);
    } else {
      rt.pipeline.encodeScenePass(
        encoder,
        rt.earthVertexBuffer,
        rt.earthIndexBuffer,
        rt.earthIndexCount,
        rt.camera.getViewMode() === 'moon',
      );
    }

    if (rt.trailRenderer) {
      rt.pipeline.encodeTrailPass(encoder, rt.trailRenderer);
    }

    if (rt.camera.getViewMode() === 'god' && rt.constellationGuides?.isEnabled()) {
      rt.pipeline.encodeConstellationGuidesPass(encoder, rt.constellationGuides);
    }

    if (rt.camera.getViewMode() === 'moon') {
      rt.moonRingGuide?.setSubtleRing(true);
      rt.pipeline.encodeMoonOverlayPass(encoder, rt.moonRingGuide);
      rt.ui.setMoonScaleAnnotation(rt.moonScaleHudEnabled);
    } else {
      rt.ui.setMoonScaleAnnotation(false);
    }

    if (rt.volumetricBeamRenderer) {
      rt.volumetricBeamRenderer.encodeRaymarchPass(encoder);
      rt.volumetricBeamRenderer.encodeCompositePass(encoder, rt.pipeline.getHDRView());
    }

    if (rt.camera.getViewMode() === 'skyline' && rt.context) {
      rt.skyline.setObserver(cameraState.position);
      const { width: canvasW, height: canvasH } = rt.context.getCanvasSize();
      const cityViewProj = rt.skyline.computeCityViewProj(
        cameraState.position,
        cameraState.target,
        cameraState.up,
        canvasW / canvasH,
        cameraState.fov,
      );
      const sunPosSky = calculateSunPosition(simTime);
      const sunDir = v3norm(sunPosSky);
      const up = v3norm(cameraState.position);
      let nightFactor = smoothstep(0.1, -0.1, v3dot(up, sunDir));
      nightFactor = Math.max(nightFactor, 0.94);
      rt.skyline.updateUniform(
        rt.context.getDevice(),
        cityViewProj,
        cameraState.position,
        sunDir,
        nightFactor,
        simTime,
        skylineEmissiveScale(rt.view.imageTuning.coreBoost),
        rt.simulation.skylineDisplayMode,
      );
      rt.pipeline.encodeSkylinePass(encoder, rt.skyline.buildingCount);
    }

    const sceneSourceView = rt.pipeline.encodeDepthOfFieldPasses(encoder);
    const motionBlurSourceView = rt.pipeline.encodeMotionBlurPass(encoder, sceneSourceView);
    rt.pipeline.encodeAutoExposurePasses(encoder, motionBlurSourceView, deltaTime);
    rt.pipeline.encodeBloomPasses(encoder, motionBlurSourceView);

    const { width: canvasWidth, height: canvasHeight } = rt.context.getCanvasSize();
    const screenView = rt.context.getContext().getCurrentTexture().createView();

    if (rt.postProcessStack) {
      rt.pipeline.encodeCompositePass(
        encoder,
        rt.pipeline.getCompositeIntermediateView(),
        canvasWidth,
        canvasHeight,
        motionBlurSourceView,
      );
      rt.postProcessStack.execute(
        encoder,
        rt.pipeline.getCompositeIntermediateView(),
        screenView,
        canvasWidth,
        canvasHeight,
        deltaTime,
      );
    } else {
      rt.pipeline.encodeCompositePass(
        encoder,
        screenView,
        canvasWidth,
        canvasHeight,
        motionBlurSourceView,
      );
    }

    rt.context.submit([encoder.finish()]);
    recordPassTimings(rt);

    const stats = rt.profiler.endFrame(timestamp);
    if (stats) {
      stats.visibleSatellites = estimateVisibleSatellites(rt);
      rt.ui.updateStats(stats);
      rt.ui.updateSimClock(rt.simulation.clock);
    }

    rt.loop.animationId = requestAnimationFrame(render);
  };
  return render;
}

export function createWebGLRenderLoop(rt: AppRuntime): (timestamp: number) => void {
  const render = (timestamp: number): void => {
    if (!rt.loop.isRunning || !rt.webglRenderer || !rt.webglOrbital) return;

    const size = getDrawableSize(rt);
    if (size && (size.width !== rt.canvas.width || size.height !== rt.canvas.height)) {
      rt.handleResize();
    }

    const time = timestamp * 0.001;
    const deltaTime = Math.min(time - rt.loop.lastTime, 0.1);
    rt.loop.lastTime = time;
    rt.simulation.clock.tick(deltaTime);
    const simTime = rt.simulation.clock.simTime;

    applyViewTuning(rt, time);
    applyGroundPresetEffects(rt, deltaTime);
    rt.camera.updateHorizonDrift(time, deltaTime);
    rt.camera.updateGodIdleOrbit(time, deltaTime);

    if (
      rt.simulation.demoAutoEnabled &&
      !rt.camera.isCinematicActive() &&
      time - rt.simulation.lastUserActivityTime >= rt.demoIdleTimeoutSeconds
    ) {
      rt.camera.startCinematic(time);
    }

    setBackgroundMode(resolveBackgroundMode(rt.camera.getViewMode()));
    if (rt.camera.getViewMode() === 'ground') {
      rt.groundObserver.update();
    }

    const aspect = rt.canvas.width / Math.max(1, rt.canvas.height);
    const orbital = rt.webglOrbital;
    rt.camera.setFleetHostIndex(rt.fleetHostIndex);
    const cameraState = rt.camera.calculateCamera(
      (idx, t) => orbital.calculatePosition(idx, t),
      (idx, t) => orbital.calculateVelocity(idx, t),
      time,
    );
    const { viewProjection } = rt.camera.buildViewProjection(cameraState, aspect);
    const sun = calculateSunPosition(simTime);
    applyHorizonViewEffects(rt, cameraState, viewProjection, sun, rt.canvas.height);
    applyGodViewEffects(rt, cameraState);
    applyFleetViewEffects(rt, simTime);

    if (rt.focusManager) {
      rt.focusManager.setCameraPosition(cameraState.position);
      rt.focusManager.setConstellationStats(buildConstellationStats(rt));
      rt.focusManager.update(simTime);
    }

    const sunLen = Math.hypot(sun[0], sun[1], sun[2]) || 1;
    const fleetHostVel =
      rt.camera.getViewMode() === 'sat-pov'
        ? orbital.calculateVelocity(rt.fleetHostIndex, simTime)
        : undefined;

    rt.webglRenderer.renderFrame({
      viewProj: viewProjection,
      cameraPos: cameraState.position,
      sunDir: [sun[0] / sunLen, sun[1] / sunLen, sun[2] / sunLen],
      simTime,
      time,
      backgroundMode: getBackgroundModeIndex(),
      viewMode: rt.camera.getViewModeIndex(),
      timeScale: rt.simulation.clock.rate,
      hostVelocity: fleetHostVel,
    });

    rt.ui.updateSimClock(rt.simulation.clock);

    rt.loop.animationId = requestAnimationFrame(render);
  };
  return render;
}

export function startWebGPULoop(rt: AppRuntime): void {
  if (rt.loop.isRunning) return;
  rt.loop.isRunning = true;
  rt.loop.animationId = requestAnimationFrame(createWebGPURenderLoop(rt));
}

export function startWebGLLoop(rt: AppRuntime): void {
  rt.loop.isRunning = true;
  rt.loop.lastTime = performance.now() * 0.001;
  rt.loop.animationId = requestAnimationFrame(createWebGLRenderLoop(rt));
}

export function stopLoop(rt: AppRuntime): void {
  rt.loop.isRunning = false;
  cancelAnimationFrame(rt.loop.animationId);
}
