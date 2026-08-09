/**
 * WebXR frame loop — dual-eye WebGL draw into XRWebGLLayer.
 */

import { getBackgroundModeIndex } from '@/core/background.js';
import type { AppRuntime } from '@/app/AppRuntime.js';
import { calculateSunPosition } from '@/app/UniformWriter.js';
import { stationGpuState } from '@/ground/GroundStation.js';
import type { WebGLFrame } from '@/webgl/WebGLRenderer.js';
import {
  cameraStateForAnchor,
  nextAnchorId,
  previousAnchorId,
  stageMatrixFromCameraState,
  type XrAnchorId,
} from '@/xr/XrAnchors.js';
import { viewDescriptorForXrEye } from '@/xr/XrPoseBridge.js';
import type { CameraState } from '@/camera/cameraTypes.js';
import { blendCameraState, smoothstep } from '@/camera/cameraBlend.js';

export interface XrFrameLoopState {
  anchorId: XrAnchorId;
  /** Stage blend for comfort snaps. */
  blendFrom: CameraState | null;
  blendTo: CameraState | null;
  blendStartMs: number;
  blendDurationMs: number;
  lastFrameTimeSec: number;
  /** Edge-detect controller select for anchor cycle. */
  selectWasPressed: boolean;
  rafHandle: number;
}

export function createXrFrameLoopState(initialAnchor: XrAnchorId = 'horizon-720'): XrFrameLoopState {
  return {
    anchorId: initialAnchor,
    blendFrom: null,
    blendTo: null,
    blendStartMs: 0,
    blendDurationMs: 400,
    lastFrameTimeSec: 0,
    selectWasPressed: false,
    rafHandle: 0,
  };
}

function resolveAnchorCamera(rt: AppRuntime, id: XrAnchorId): CameraState {
  return cameraStateForAnchor(id, {
    groundStation: rt.simulation.groundStations.active,
    groundStationUtcMs: rt.simulation.clock.simUtcMs,
  });
}

function currentAnchorCamera(rt: AppRuntime, state: XrFrameLoopState, nowMs: number): CameraState {
  const target = resolveAnchorCamera(rt, state.anchorId);
  if (!state.blendFrom || !state.blendTo) {
    return target;
  }
  const elapsed = nowMs - state.blendStartMs;
  const tLinear = Math.min(1, elapsed / state.blendDurationMs);
  const t = smoothstep(tLinear);
  if (tLinear >= 1) {
    state.blendFrom = null;
    state.blendTo = null;
    return target;
  }
  return blendCameraState(state.blendFrom, state.blendTo, t);
}

export function snapToAnchor(rt: AppRuntime, state: XrFrameLoopState, id: XrAnchorId): void {
  const nowMs = performance.now();
  const from = currentAnchorCamera(rt, state, nowMs);
  state.anchorId = id;
  const to = resolveAnchorCamera(rt, id);
  state.blendFrom = from;
  state.blendTo = to;
  state.blendStartMs = nowMs;
}

export function cycleAnchor(
  rt: AppRuntime,
  state: XrFrameLoopState,
  direction: 1 | -1 = 1,
): void {
  const next =
    direction === 1 ? nextAnchorId(state.anchorId) : previousAnchorId(state.anchorId);
  snapToAnchor(rt, state, next);
}

function anySelectPressed(session: XRSession): boolean {
  for (const source of session.inputSources) {
    const gp = source.gamepad;
    if (!gp) continue;
    // Button 0 = trigger/select on typical XR gamepads.
    if (gp.buttons[0]?.pressed) return true;
    if (gp.buttons[1]?.pressed) return true;
  }
  return false;
}

function handleAnchorInput(rt: AppRuntime, state: XrFrameLoopState, session: XRSession): void {
  const pressed = anySelectPressed(session);
  if (pressed && !state.selectWasPressed) {
    cycleAnchor(rt, state, 1);
  }
  state.selectWasPressed = pressed;
}

function buildWebGLFrame(
  rt: AppRuntime,
  viewProj: Float32Array,
  cameraPos: [number, number, number],
  wallTimeSec: number,
): WebGLFrame {
  const simTime = rt.simulation.clock.simTime;
  const sun = calculateSunPosition(simTime);
  const sunLen = Math.hypot(sun[0], sun[1], sun[2]) || 1;
  const orbital = rt.webglOrbital;
  const fleetHostVel =
    rt.camera.getViewMode() === 'sat-pov' && orbital
      ? orbital.calculateVelocity(rt.fleetHostIndex, simTime)
      : undefined;

  return {
    viewProj,
    cameraPos,
    sunDir: [sun[0] / sunLen, sun[1] / sunLen, sun[2] / sunLen],
    simTime,
    time: wallTimeSec,
    backgroundMode: getBackgroundModeIndex(),
    // Force horizon-like rendering flags for orbital XR (view mode 0).
    viewMode: 0,
    timeScale: rt.simulation.clock.rate,
    hostVelocity: fleetHostVel,
    station: stationGpuState(
      rt.simulation.groundStations.active,
      rt.simulation.clock.simUtcMs,
    ),
    selectedSatellite: rt.selectedSatelliteIndex,
  };
}

export type XrLayerLike = {
  framebuffer: WebGLFramebuffer | null;
  getViewport(view: XRView): { x: number; y: number; width: number; height: number } | null;
};

export function onXrFrame(
  rt: AppRuntime,
  state: XrFrameLoopState,
  session: XRSession,
  timeMs: number,
  frame: XRFrame,
  refSpace: XRReferenceSpace,
  layer: XrLayerLike,
): void {
  const renderer = rt.webglRenderer;
  if (!renderer) return;

  handleAnchorInput(rt, state, session);

  const timeSec = timeMs * 0.001;
  const delta =
    state.lastFrameTimeSec > 0 ? Math.min(timeSec - state.lastFrameTimeSec, 0.1) : 0.016;
  state.lastFrameTimeSec = timeSec;
  rt.simulation.clock.tick(delta);

  const pose = frame.getViewerPose(refSpace);
  if (!pose) return;

  const anchorCam = currentAnchorCamera(rt, state, timeMs);
  const stage = stageMatrixFromCameraState(anchorCam);
  const gl = renderer.getGL();
  const fbo = layer.framebuffer;

  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

  let eyeIndex = 0;
  for (const view of pose.views) {
    const vp = layer.getViewport(view);
    if (!vp || vp.width < 1 || vp.height < 1) continue;

    const viewMatrix = new Float32Array(view.transform.inverse.matrix);
    const projectionMatrix = new Float32Array(view.projectionMatrix);
    const desc = viewDescriptorForXrEye(stage, {
      viewMatrix,
      projectionMatrix,
      viewportWidth: vp.width,
      viewportHeight: vp.height,
      eyeIndex: eyeIndex === 0 ? 0 : 1,
    });
    eyeIndex++;

    const webglFrame = buildWebGLFrame(
      rt,
      desc.viewProjection,
      desc.cameraPos,
      timeSec,
    );
    renderer.renderEye(webglFrame, {
      fbo,
      x: vp.x,
      y: vp.y,
      width: vp.width,
      height: vp.height,
    });
  }

  rt.ui.updateSimClock(rt.simulation.clock);
}

export function bindXrKeyboard(
  rt: AppRuntime,
  state: XrFrameLoopState,
): (ev: KeyboardEvent) => void {
  const handler = (ev: KeyboardEvent): void => {
    if (ev.key === ']' || ev.key === 'PageDown') {
      cycleAnchor(rt, state, 1);
      ev.preventDefault();
    } else if (ev.key === '[' || ev.key === 'PageUp') {
      cycleAnchor(rt, state, -1);
      ev.preventDefault();
    } else if (ev.key === '1') {
      snapToAnchor(rt, state, 'horizon-720');
    } else if (ev.key === '2') {
      snapToAnchor(rt, state, 'geo-overview');
    } else if (ev.key === '3') {
      snapToAnchor(rt, state, 'ground-station');
    }
  };
  window.addEventListener('keydown', handler);
  return handler;
}

export function unbindXrKeyboard(handler: (ev: KeyboardEvent) => void): void {
  window.removeEventListener('keydown', handler);
}
