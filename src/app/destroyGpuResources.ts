import type { AppRuntime } from '@/app/AppRuntime.js';

export interface DestroyGpuResourcesOptions {
  /** When true, skip GPU destroy calls — the device is already lost. */
  deviceLost?: boolean;
}

function destroyBuffer(buffer: GPUBuffer | null | undefined, deviceLost: boolean): void {
  if (!buffer || deviceLost) return;
  buffer.destroy();
}

function destroyOptional(resource: { destroy?: () => void } | null | undefined, deviceLost: boolean): void {
  if (!resource || deviceLost) return;
  resource.destroy?.();
}

/**
 * Tear down WebGPU-backed resources while keeping CPU-side app state (camera, UI, simulation).
 */
export function destroyGpuResources(
  rt: AppRuntime,
  options: DestroyGpuResourcesOptions = {},
): void {
  const { deviceLost = false } = options;

  destroyOptional(rt.volumetricBeamRenderer, deviceLost);
  rt.volumetricBeamRenderer = null;

  destroyOptional(rt.earthAtmosphereRenderer, deviceLost);
  rt.earthAtmosphereRenderer = null;

  destroyOptional(rt.moonRingGuide, deviceLost);
  rt.moonRingGuide = null;

  destroyOptional(rt.constellationGuides, deviceLost);
  rt.constellationGuides = null;

  destroyOptional(rt.trailRenderer, deviceLost);
  rt.trailRenderer = null;

  destroyOptional(rt.postProcessStack, deviceLost);
  rt.postProcessStack = null;

  destroyOptional(rt.pipeline, deviceLost);
  rt.pipeline = null;

  destroyBuffer(rt.earthVertexBuffer, deviceLost);
  rt.earthVertexBuffer = null;
  destroyBuffer(rt.earthIndexBuffer, deviceLost);
  rt.earthIndexBuffer = null;
  rt.earthIndexCount = 0;

  if (!deviceLost) {
    rt.buffers?.destroy();
  }
  rt.buffers = null;

  rt.focusManager = null;

  if (!deviceLost) {
    rt.skyline.destroy(false);
  } else {
    rt.skyline.destroy(true);
  }
}
