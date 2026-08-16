import type { AppRuntime } from '@/app/AppRuntime.js';
import { ISL_PARAM_BYTES } from '@/types/isl.js';
import { getActiveFleetSize } from '@/core/FleetScale.js';

export function setIslEnabled(rt: AppRuntime, enabled: boolean): void {
  rt.simulation.islEnabled = enabled;
  rt.simulation.islUserOverride = enabled;
  rt.ui.setIslEnabled(enabled);
  writeIslParams(rt);
}

export function setIslDensity(rt: AppRuntime, density: number): void {
  rt.simulation.islDensity = Math.min(1, Math.max(0.05, density));
  rt.ui.setIslDensity(rt.simulation.islDensity);
  writeIslParams(rt);
}

export function applyIslForQuality(rt: AppRuntime, qualityForcesOff: boolean): void {
  if (rt.simulation.islUserOverride !== null) {
    rt.simulation.islEnabled = qualityForcesOff ? false : rt.simulation.islUserOverride;
  } else {
    rt.simulation.islEnabled = !qualityForcesOff;
  }
  rt.ui.setIslEnabled(rt.simulation.islEnabled);
}

export function writeIslParams(rt: AppRuntime): void {
  if (!rt.context || !rt.buffers) return;
  const ab = new ArrayBuffer(ISL_PARAM_BYTES);
  const f32 = new Float32Array(ab);
  const u32 = new Uint32Array(ab);
  const tle = rt.buffers.getTleRealCount();
  const realism = rt.simulation.realismMode && tle > 0;
  u32[0] = rt.simulation.islEnabled ? 1 : 0;
  f32[1] = rt.simulation.islDensity;
  u32[2] = rt.selectedSatelliteIndex >= 0 ? rt.selectedSatelliteIndex : 0xffffffff;
  u32[3] = realism ? tle : getActiveFleetSize();
  f32[4] = rt.simulation.clock.simTime;
  u32[5] = realism ? 1 : 0;
  rt.context.writeBuffer(rt.buffers.getBuffers().islParams, ab);
}
