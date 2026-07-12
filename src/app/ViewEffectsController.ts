import { DEFAULT_POSTPROCESS_CONFIG } from '@/types/animation.js';
import { kelvinToColorGrading } from '@/camera/groundPresetEffects.js';
import {
  computeEarthLimbScreenUv,
  computeEarthLimbScreenYNormalized,
} from '@/camera/HorizonLimb.js';
import { applyGodZoomBloomTuning } from '@/camera/GodFraming.js';
import {
  computeFleetCockpitTelemetry,
  FLEET_COCKPIT,
} from '@/camera/FleetCockpit.js';
import type { CameraState } from '@/camera/CameraController.js';
import { v3dot, v3norm, v3scale, smoothstep } from '@/utils/math.js';
import type { AppRuntime } from '@/app/AppRuntime.js';

export function applyGroundPresetEffects(rt: AppRuntime, deltaTime: number): void {
  const isGround = rt.camera.getViewMode() === 'ground';

  if (!isGround) {
    rt.pipeline?.setAtmosphereScatteringConfig(
      rt.qualityAtmosphereScatteringEnabled,
      rt.qualityAtmosphereHaze,
    );
    if (rt.postProcessStack) {
      rt.postProcessStack.setLensEffects(DEFAULT_POSTPROCESS_CONFIG.lensEffects);
      rt.postProcessStack.setColorGrading(DEFAULT_POSTPROCESS_CONFIG.colorGrading);
    }
    return;
  }

  rt.groundObserver.updatePresetBlend(deltaTime);
  const effects = rt.groundObserver.getBlendedEffects();
  const grading = kelvinToColorGrading(effects.colorTemperature);

  rt.pipeline?.setAtmosphereScatteringConfig(
    rt.qualityAtmosphereScatteringEnabled,
    rt.qualityAtmosphereHaze * effects.atmosphericScatter,
  );

  if (rt.postProcessStack) {
    rt.postProcessStack.setColorGrading({
      ...DEFAULT_POSTPROCESS_CONFIG.colorGrading,
      ...grading,
    });
    rt.postProcessStack.setLensEffects({
      vignetting: {
        enabled: effects.vignette > 0,
        intensity: effects.vignette,
        smoothness: 1.0,
        roundness: 2.0,
      },
    });
  }

  if (!rt.imageTuningManualOverride) {
    const bloomIntensity = rt.baseViewBloomIntensity * effects.bloomIntensity;
    const tuned = { ...rt.imageTuning, bloomIntensity };
    rt.imageTuning = tuned;
    rt.pipeline?.setImageTuning(tuned);
    rt.webglRenderer?.setImageTuning(tuned);
  }
}

export function applyHorizonViewEffects(
  rt: AppRuntime,
  cameraState: CameraState,
  viewProjection: Float32Array,
  sunPos: readonly [number, number, number],
  screenHeight: number,
): void {
  const isHorizon = rt.camera.getViewMode() === 'horizon-720';

  if (!isHorizon) {
    rt.ui.setHorizonLimbGuide(null);
    if (rt.horizonLensActive && rt.postProcessStack) {
      rt.postProcessStack.setLensEffects(DEFAULT_POSTPROCESS_CONFIG.lensEffects);
      rt.horizonLensActive = false;
    }
    return;
  }

  const limbY = computeEarthLimbScreenYNormalized(
    viewProjection,
    cameraState.position as [number, number, number],
    screenHeight,
  );
  rt.ui.setHorizonLimbGuide(limbY);

  const toEarth = v3norm(v3scale(cameraState.position as [number, number, number], -1));
  const sunDir = v3norm([sunPos[0], sunPos[1], sunPos[2]] as [number, number, number]);
  const terminator = smoothstep(0.05, 0.42, 1 - Math.abs(v3dot(toEarth, sunDir)));

  if (rt.postProcessStack && terminator > 0.01) {
    const warm = kelvinToColorGrading(4200);
    const base = DEFAULT_POSTPROCESS_CONFIG.colorGrading;
    const t = terminator * 0.6;
    const mix3 = (a: number, b: number) => a + (b - a) * t;
    rt.postProcessStack.setColorGrading({
      ...base,
      lift: [mix3(base.lift[0], warm.lift[0]), mix3(base.lift[1], warm.lift[1]), mix3(base.lift[2], warm.lift[2])],
      gamma: [mix3(base.gamma[0], warm.gamma[0]), mix3(base.gamma[1], warm.gamma[1]), mix3(base.gamma[2], warm.gamma[2])],
      gain: [mix3(base.gain[0], warm.gain[0]), mix3(base.gain[1], warm.gain[1]), mix3(base.gain[2], warm.gain[2])],
      saturation: mix3(base.saturation, 1.14),
    });
  }

  const cinematic = rt.currentQualityLevel === 'cinematic';
  if (cinematic && rt.postProcessStack) {
    const uv = computeEarthLimbScreenUv(
      viewProjection,
      cameraState.position as [number, number, number],
    );
    if (uv) {
      rt.postProcessStack.setLensEffects({
        chromaticAberration: { enabled: false, strength: 0 },
        lensFlare: { enabled: true, intensity: 0.2, anamorphic: true },
        starburst: { enabled: false, points: 6, intensity: 0 },
        vignetting: { enabled: false, intensity: 0, smoothness: 1, roundness: 2 },
      });
      rt.postProcessStack.setSunScreenPosition(uv[0], uv[1], 0.3 + terminator * 0.55);
      rt.horizonLensActive = true;
    }
    rt.pipeline?.setBloomConfig({ anamorphicEnabled: true, anamorphicRatio: 0.2 });
  } else if (rt.horizonLensActive && rt.postProcessStack) {
    rt.postProcessStack.setLensEffects(DEFAULT_POSTPROCESS_CONFIG.lensEffects);
    rt.horizonLensActive = false;
  }
}

export function applyGodViewEffects(rt: AppRuntime, cameraState: CameraState): void {
  const isGod = rt.camera.getViewMode() === 'god';
  if (!isGod || rt.imageTuningManualOverride) return;

  const distanceKm = Math.hypot(
    cameraState.position[0],
    cameraState.position[1],
    cameraState.position[2],
  );
  const tuned = applyGodZoomBloomTuning(rt.imageTuning, distanceKm);
  rt.imageTuning = tuned;
  rt.pipeline?.setImageTuning(tuned);
  rt.webglRenderer?.setImageTuning(tuned);
}

export function applyFleetViewEffects(rt: AppRuntime, simTime: number): void {
  const isFleet = rt.camera.getViewMode() === 'sat-pov';

  if (!isFleet) {
    rt.ui.setFleetCockpitVisible(false);
    if (rt.fleetLensActive && rt.postProcessStack) {
      rt.postProcessStack.setLensEffects(DEFAULT_POSTPROCESS_CONFIG.lensEffects);
      rt.fleetLensActive = false;
    }
    return;
  }

  rt.ui.setFleetCockpitVisible(true);

  const orbital = rt.buffers?.getOrbitalElements() ?? rt.webglOrbital;
  if (orbital) {
    const hostIdx = FLEET_COCKPIT.HOST_SATELLITE_INDEX;
    const hostPos = orbital.calculatePosition(hostIdx, simTime);
    const velDir = orbital.calculateVelocity(hostIdx, simTime);
    const telem = computeFleetCockpitTelemetry(orbital, hostIdx, hostPos, velDir, simTime);
    rt.ui.setFleetCockpitTelemetry(
      telem.speedKms,
      telem.altitudeKm,
      telem.headingDeg,
      telem.nearbyCount,
    );
  }

  const drift = rt.camera.getFleetDriftOffset();
  const driftMag = Math.hypot(drift[0], drift[1], drift[2]);
  const reticleX = (drift[0] / 80) * 10;
  const reticleY = (-drift[2] / 80) * 8;
  const hudJitter = Math.min(3.5, driftMag * 0.04);
  rt.ui.setFleetCockpitDrift(reticleX, reticleY, hudJitter);

  const cinematic = rt.currentQualityLevel === 'cinematic';
  if (cinematic && rt.postProcessStack) {
    rt.postProcessStack.setLensEffects({
      chromaticAberration: { enabled: true, strength: 0.14 },
      vignetting: {
        enabled: true,
        intensity: 0.38,
        smoothness: 1.15,
        roundness: 1.55,
      },
      lensFlare: { enabled: false, intensity: 0, anamorphic: false },
      starburst: { enabled: false, points: 6, intensity: 0 },
    });
    rt.fleetLensActive = true;
  } else if (rt.fleetLensActive && rt.postProcessStack) {
    rt.postProcessStack.setLensEffects(DEFAULT_POSTPROCESS_CONFIG.lensEffects);
    rt.fleetLensActive = false;
  }
}
