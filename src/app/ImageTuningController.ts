import {
  resolveImageTuning,
  saveImageTuning,
} from '@/core/ImageTuning.js';
import { resolveViewTuning } from '@/core/ViewTuningProfile.js';
import type { AppRuntime } from '@/app/AppRuntime.js';

export function setupImageTuning(rt: AppRuntime): void {
  const search = window.location.search;
  const params = new URLSearchParams(search);
  rt.imageTuningManualOverride =
    params.has('bloomThreshold') ||
    params.has('bloomKnee') ||
    params.has('bloomIntensity') ||
    params.has('satCore') ||
    params.has('satFalloff') ||
    params.has('satCoreInner');
  rt.imageTuning = resolveImageTuning(search);
  rt.animationMasterIntensity = rt.imageTuning.animationMasterIntensity;
  rt.ui.setImageTuningControls(rt.imageTuning, {
    enforceFloors: rt.imageTuning.enforceFloors,
  });
  if (rt.imageTuningManualOverride) {
    applyImageTuning(rt);
  } else {
    applyViewTuning(rt, performance.now() * 0.001);
  }
}

export function applyImageTuning(rt: AppRuntime): void {
  rt.pipeline?.setImageTuning(rt.imageTuning);
  rt.webglRenderer?.setImageTuning(rt.imageTuning);
  saveImageTuning(rt.imageTuning);
}

/** Blend per-view bloom/satellite/animation profiles during camera mode transitions. */
export function applyViewTuning(rt: AppRuntime, time: number): void {
  const blend = rt.camera.getViewTuningBlend(time);
  const resolved = resolveViewTuning(
    blend.fromIndex,
    blend.toIndex,
    blend.t,
    rt.imageTuning.enforceFloors,
    rt.animationMasterIntensity,
  );
  rt.baseViewBloomIntensity = resolved.settings.bloomIntensity;

  if (!rt.imageTuningManualOverride) {
    rt.imageTuning = resolved.settings;
    rt.pipeline?.setImageTuning(resolved.settings);
    rt.webglRenderer?.setImageTuning(resolved.settings);
  } else {
    rt.imageTuning = {
      ...rt.imageTuning,
      animationIntensity: resolved.settings.animationIntensity,
      animationContrast: resolved.settings.animationContrast,
      animationMasterIntensity: rt.animationMasterIntensity,
    };
    rt.pipeline?.setImageTuning(rt.imageTuning);
    rt.webglRenderer?.setImageTuning(rt.imageTuning);
  }
  rt.ui.setTuningProfile(resolved.profileLabel);
}
