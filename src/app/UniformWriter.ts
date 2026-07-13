import { getBackgroundModeIndex } from '@/background.js';
import { groundPresetMotionBlurWeight } from '@/camera/groundPresetEffects.js';
import type { CameraState } from '@/camera/CameraController.js';
import type { ConstellationStats } from '@/focus.js';
import { BUFFER_SIZES } from '@/types/constants.js';
import { extractFrustum, mat4inv } from '@/utils/math.js';
import { CONSTANTS } from '@/types/constants.js';
import type { AppRuntime } from '@/app/AppRuntime.js';

/**
 * Calculate sun position in ECI frame for eclipse shadow calculation.
 * Sun orbits at 1 AU in the XY plane.
 */
export function calculateSunPosition(simTime: number): [number, number, number] {
  const SUN_DISTANCE_KM = 149597870.0;
  const ORBITAL_PERIOD_SEC = 31557600.0;
  const angle = (simTime / ORBITAL_PERIOD_SEC) * Math.PI * 2;
  return [Math.cos(angle) * SUN_DISTANCE_KM, Math.sin(angle) * SUN_DISTANCE_KM, 0.0];
}

export function buildConstellationStats(rt: AppRuntime): ConstellationStats {
  const physicsNames = ['Simple', 'Keplerian', 'J2 Perturbed'];
  const animNames: Record<number, string> = {
    0: 'None',
    3: 'Smile',
    4: 'Digital Rain',
    5: 'Heartbeat',
  };
  return {
    viewModeName: rt.camera.getViewMode(),
    physicsModeName: physicsNames[rt.simulation.currentPhysicsMode] ?? 'Simple',
    timeScale: rt.simulation.clock.rate,
    dataSource: rt.dataSourceLabel,
    visibleCount: rt.lastVisibleCount,
    animationPattern: animNames[rt.simulation.currentAnimationPattern] ?? 'None',
  };
}

export function updateBeamParamsTime(rt: AppRuntime, time: number): void {
  if (!rt.context || !rt.buffers) return;

  const beamParamsData = new ArrayBuffer(16);
  const f32 = new Float32Array(beamParamsData);
  const u32 = new Uint32Array(beamParamsData);

  f32[0] = time;
  u32[1] = rt.simulation.currentPatternMode;
  u32[2] = 65536;
  u32[3] = 0;

  rt.context.writeBuffer(rt.buffers.getBuffers().beamParams, beamParamsData);
}

export function writeUniforms(
  rt: AppRuntime,
  time: number,
  deltaTime: number,
  camera: CameraState | null = null,
): void {
  if (!rt.context || !rt.buffers) return;

  const { width, height } = rt.context.getCanvasSize();
  const aspect = width / height;

  const cameraState =
    camera ??
    rt.camera.calculateCamera(
      (idx, t) => rt.buffers!.calculateSatellitePosition(idx, t),
      (idx, t) => rt.buffers!.calculateSatelliteVelocity(idx, t),
      time,
    );

  const { viewProjection, view } = rt.camera.buildViewProjection(cameraState, aspect);
  const inverseViewProjection = mat4inv(viewProjection);
  const { right, up } = rt.camera.getCameraAxes(view);
  const frustum = extractFrustum(viewProjection);

  const cameraRadius = Math.sqrt(
    cameraState.position[0] * cameraState.position[0] +
      cameraState.position[1] * cameraState.position[1] +
      cameraState.position[2] * cameraState.position[2],
  );

  const viewMode = rt.camera.getViewModeIndex();
  const isGroundView = cameraRadius < CONSTANTS.EARTH_RADIUS_KM + 100.0 ? 1 : 0;
  const physicsMode = rt.simulation.currentPhysicsMode;
  const realismMode =
    rt.simulation.realismMode && (rt.buffers?.isRealismEnabled() ?? false) ? 1 : 0;
  const viewFlags =
    (viewMode & 0xffff) |
    ((isGroundView & 0x1) << 16) |
    ((physicsMode & 0x7) << 17) |
    ((realismMode & 0x1) << 20);
  const simTime = rt.simulation.clock.simTime;
  const sunPos = calculateSunPosition(simTime);

  const uniformData = new ArrayBuffer(BUFFER_SIZES.UNIFORM);
  const f32 = new Float32Array(uniformData);
  const u32 = new Uint32Array(uniformData);

  f32.set(viewProjection, 0);
  f32[16] = cameraState.position[0];
  f32[17] = cameraState.position[1];
  f32[18] = cameraState.position[2];
  f32[19] = 1.0;
  f32[20] = right[0];
  f32[21] = right[1];
  f32[22] = right[2];
  f32[23] = 0.0;
  f32[24] = up[0];
  f32[25] = up[1];
  f32[26] = up[2];
  f32[27] = 0.0;
  f32[28] = time;
  f32[29] = deltaTime;
  u32[30] = viewFlags;
  f32[31] = simTime;

  for (let p = 0; p < 6; p++) {
    f32[32 + p * 4 + 0] = frustum[p][0];
    f32[32 + p * 4 + 1] = frustum[p][1];
    f32[32 + p * 4 + 2] = frustum[p][2];
    f32[32 + p * 4 + 3] = frustum[p][3];
  }

  f32[56] = width;
  f32[57] = height;
  f32[58] = rt.simulation.clock.rate;
  u32[59] = getBackgroundModeIndex();
  f32[60] = sunPos[0];
  f32[61] = sunPos[1];
  f32[62] = sunPos[2];
  f32[63] = 1.0;

  rt.context.writeBuffer(rt.buffers.getBuffers().uniforms, uniformData);
  const motionBlurWeight =
    rt.camera.getViewMode() === 'ground'
      ? groundPresetMotionBlurWeight(rt.groundObserver.getBlendedEffects())
      : undefined;
  const fleetHostVel =
    viewMode === 2
      ? rt.buffers.calculateSatelliteVelocity(rt.fleetHostIndex, simTime)
      : undefined;
  rt.pipeline?.setMotionBlurFrameData(
    viewProjection,
    inverseViewProjection,
    viewMode,
    deltaTime,
    motionBlurWeight,
    fleetHostVel,
  );

  updateBeamParamsTime(rt, time);
}
