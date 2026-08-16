import { getBackgroundModeIndex } from '@/core/background.js';
import { PHYSICS_MODE_NAMES } from '@/physics/physicsMode.js';
import { groundPresetMotionBlurWeight } from '@/camera/groundPresetEffects.js';
import type { CameraState } from '@/camera/CameraController.js';
import {
  viewDescriptorFromCameraState,
  type ViewDescriptor,
} from '@/camera/ViewDescriptor.js';
import type { ConstellationStats } from '@/camera/FocusManager.js';
import { mat4inv } from '@/utils/math.js';
import { SCENE_UNI_SCHEMA } from '@/shaders/schemas/sceneUni.js';
import { UniformBufferWriter } from '@/shaders/uniformSchema.js';
import { CONSTANTS } from '@/types/constants.js';
import type { AppRuntime } from '@/app/AppRuntime.js';
import { stationGpuState } from '@/ground/GroundStation.js';
import { artSunPositionEci, resolveSunPosition } from '@/physics/sun.js';

/**
 * Art-mode sun (XY-plane circle). Kept for visual-baseline compatibility.
 * Prefer `sunPositionForRuntime` when the ART/ASTRO toggle matters.
 */
export function calculateSunPosition(simTime: number): [number, number, number] {
  return artSunPositionEci(simTime);
}

export function sunPositionForRuntime(rt: AppRuntime): [number, number, number] {
  return resolveSunPosition({
    mode: rt.simulation.sunMode,
    simTimeSec: rt.simulation.clock.simTime,
    utcMs: rt.simulation.clock.simUtcMs,
  });
}

export function buildConstellationStats(rt: AppRuntime): ConstellationStats {
  const animNames: Record<number, string> = {
    0: 'None',
    3: 'Smile',
    4: 'Digital Rain',
    5: 'Heartbeat',
  };
  return {
    viewModeName: rt.camera.getViewMode(),
    physicsModeName: PHYSICS_MODE_NAMES[rt.simulation.currentPhysicsMode] ?? 'Simple',
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

/**
 * Resolve a mono ViewDescriptor from an optional camera state (or live camera).
 * Prefer passing an explicit ViewDescriptor for stereo / XR.
 */
export function resolveViewDescriptor(
  rt: AppRuntime,
  time: number,
  camera: CameraState | null = null,
  screenWidth?: number,
  screenHeight?: number,
): ViewDescriptor {
  const size = rt.context?.getCanvasSize() ?? { width: 1, height: 1 };
  const width = screenWidth ?? size.width;
  const height = screenHeight ?? size.height;

  const cameraState =
    camera ??
    rt.camera.calculateCamera(
      (idx, t) => {
        if (rt.buffers) return rt.buffers.calculateSatellitePosition(idx, t);
        return rt.webglOrbital!.calculatePosition(idx, t);
      },
      (idx, t) => {
        if (rt.buffers) return rt.buffers.calculateSatelliteVelocity(idx, t);
        return rt.webglOrbital!.calculateVelocity(idx, t);
      },
      time,
    );

  return viewDescriptorFromCameraState(cameraState, width, height);
}

export function writeUniforms(
  rt: AppRuntime,
  time: number,
  deltaTime: number,
  camera: CameraState | null = null,
  view?: ViewDescriptor | null,
): void {
  const station = stationGpuState(rt.simulation.groundStations.active, rt.simulation.clock.simUtcMs);
  const stationData = new Float32Array([
    station.positionEciKm[0], station.positionEciKm[1], station.positionEciKm[2], station.active ? 1 : 0,
    station.zenithEci[0], station.zenithEci[1], station.zenithEci[2], station.minimumElevationSin,
  ]);
  const stationBuffer = rt.buffers?.getBuffers().stationUniform;
  if (stationBuffer && rt.context) rt.context.writeBuffer(stationBuffer, stationData);
  if (!rt.context || !rt.buffers) return;

  const desc = view ?? resolveViewDescriptor(rt, time, camera);
  const viewProjection = desc.viewProjection;
  const inverseViewProjection = mat4inv(viewProjection);
  const { cameraPos, cameraRight: right, cameraUp: up, frustum } = desc;
  const width = desc.screenWidth;
  const height = desc.screenHeight;

  const cameraRadius = Math.sqrt(
    cameraPos[0] * cameraPos[0] + cameraPos[1] * cameraPos[1] + cameraPos[2] * cameraPos[2],
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
  const sunPos = sunPositionForRuntime(rt);

  const frustumPacked = new Float32Array(24);
  for (let p = 0; p < 6; p++) {
    frustumPacked.set(frustum[p], p * 4);
  }

  const uni = new UniformBufferWriter(SCENE_UNI_SCHEMA)
    .set('view_proj', viewProjection)
    .set('camera_pos', [cameraPos[0], cameraPos[1], cameraPos[2], 1.0])
    .set('camera_right', [right[0], right[1], right[2], 0.0])
    .set('camera_up', [up[0], up[1], up[2], 0.0])
    .set('time', time)
    .set('delta_time', deltaTime)
    .setU32('view_mode', viewFlags)
    .set('sim_time', simTime)
    .set('frustum', frustumPacked)
    .set('screen_size', [width, height])
    .set('time_scale', rt.simulation.clock.rate)
    .setU32('background_mode', getBackgroundModeIndex())
    .set('sun_position', [sunPos[0], sunPos[1], sunPos[2], 1.0]);

  rt.context.writeBuffer(rt.buffers.getBuffers().uniforms, uni.bytes());
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
