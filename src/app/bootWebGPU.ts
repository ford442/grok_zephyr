import { WebGPUContext } from '@/core/WebGPUContext.js';
import type { WebGPUErrorReport } from '@/core/WebGPUErrorReporter.js';
import { resolveCanvasPresentationOptions } from '@/core/HdrPresentation.js';
import { loadSavedQualityLevel } from '@/core/QualityPresets.js';
import { REQUESTED_OPTIONAL_FEATURES } from '@/core/GpuCapabilities.js';
import {
  EARTH_MAP_OPTIONAL_FEATURES,
  parseEarthMapTier,
  setActiveEarthMapTier,
} from '@/render/EarthMaps.js';
import { parseInitialStateFromURL } from '@/app/UrlState.js';
import { setupMobileOrientationSupport } from '@/app/MobilePresentation.js';
import { createGpuResources } from '@/app/createGpuResources.js';
import type { AppRuntime } from '@/app/AppRuntime.js';

export interface BootWebGPUHooks {
  onDeviceLost: (info: GPUDeviceLostInfo) => void | Promise<void>;
  onErrorReport?: (report: WebGPUErrorReport) => void;
  startRenderLoop: () => void;
}

export function installZephyrDebugHooks(rt: AppRuntime): void {
  if (typeof window === 'undefined' || rt.backend !== 'webgpu') return;

  const win = window as unknown as {
    zephyrDebug?: { loseDevice: () => void };
    zephyrGPU?: { capture: () => Promise<string> };
  };

  win.zephyrDebug = {
    loseDevice: () => {
      if (!rt.context) {
        throw new Error('WebGPU context is not initialized');
      }
      rt.context.loseDeviceForTesting();
    },
  };

  win.zephyrGPU = {
    capture: () => {
      const cap = rt.loop.offscreenCapture;
      if (!cap) {
        return Promise.reject(
          new Error('Offscreen capture requires ?capture=offscreen (skips swapchain present)'),
        );
      }
      return cap.capture();
    },
  };
}

export async function bootWebGPU(
  rt: AppRuntime,
  resizeListener: () => void,
  orientationChangeListener: () => void,
  orientationLockGestureListener: () => void,
  hooks: BootWebGPUHooks,
): Promise<void> {
  const urlParams = parseInitialStateFromURL();
  const initialQuality =
    urlParams.qualityLevel ??
    loadSavedQualityLevel() ??
    (rt.isMobileDevice ? rt.mobileDefaultQuality : 'high');

  // Earth plates are decided before the device exists: device features are
  // frozen at creation, so `texture-compression-*` cannot be added later when
  // the first .ktx2 arrives (see GpuCapabilities.REQUESTED_OPTIONAL_FEATURES).
  const earthMapTier = parseEarthMapTier(window.location.search, initialQuality);
  setActiveEarthMapTier(earthMapTier);

  rt.context = new WebGPUContext(rt.canvas, {
    canvas: resolveCanvasPresentationOptions(initialQuality),
    qualityLevel: initialQuality,
    optionalFeatures:
      earthMapTier === 'off'
        ? [...REQUESTED_OPTIONAL_FEATURES]
        : [...REQUESTED_OPTIONAL_FEATURES, ...EARTH_MAP_OPTIONAL_FEATURES],
    onDeviceLost: (info) => {
      void hooks.onDeviceLost(info);
    },
    onErrorReport: hooks.onErrorReport,
  });
  await rt.context.initialize();

  rt.camera.attachToCanvas(rt.canvas);
  setupMobileOrientationSupport(rt, orientationChangeListener, orientationLockGestureListener);

  await createGpuResources(rt, { mode: 'boot', resizeListener });

  installZephyrDebugHooks(rt);
  hooks.startRenderLoop();

  console.log('[GrokZephyr] Initialization complete');
}
