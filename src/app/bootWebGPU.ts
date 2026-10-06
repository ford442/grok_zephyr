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
import { parseSkyMode, setActiveSkyMode } from '@/render/SkyCatalog.js';
import { conjunctionOptionalFeatures } from '@/app/ConjunctionController.js';
import { parseInitialStateFromURL } from '@/app/UrlState.js';
import { setupMobileOrientationSupport } from '@/app/MobilePresentation.js';
import { createGpuResources } from '@/app/createGpuResources.js';
import type { AppRuntime } from '@/app/AppRuntime.js';
import { hasXrGpuBinding } from '@/xr/XrSupport.js';

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
    zephyrBrush?: {
      stampNdc: (x: number, y: number) => void;
      release: () => void;
      isEnabled: () => boolean;
    };
    zephyrStrips?: {
      setTime: (seconds: number) => void;
      isEnabled: () => boolean;
    };
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

  // Deterministic strokes for golden frames and scripted demos (?brush=1).
  win.zephyrBrush = {
    stampNdc: (x, y) => rt.brush.beginNdcStroke(x, y),
    release: () => rt.brush.endStroke(),
    isEnabled: () => rt.brush.enabled,
  };

  // Pin the show clock for golden frames (?strips=1).
  win.zephyrStrips = {
    setTime: (seconds) => rt.strips.setTime(seconds, true),
    isEnabled: () => rt.strips.enabled,
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
  // Sky catalog (docs/SKY.md) needs no device feature, but is settled here with
  // the plates so the render pipeline can load it before building bind groups.
  setActiveSkyMode(parseSkyMode(window.location.search, initialQuality));

  // Close approaches (docs/CONJUNCTIONS.md): same frozen-features rule. The
  // subgroup prefix sum is requested only when `?ca=1` will run at this
  // quality; otherwise the pass uses the workgroup scan with the same result.
  const conjunctionFeatures = conjunctionOptionalFeatures(
    window.location.search,
    initialQuality,
    rt.isMobileDevice,
  );

  rt.context = new WebGPUContext(rt.canvas, {
    canvas: resolveCanvasPresentationOptions(initialQuality),
    qualityLevel: initialQuality,
    optionalFeatures: [
      ...REQUESTED_OPTIONAL_FEATURES,
      ...(earthMapTier === 'off' ? [] : EARTH_MAP_OPTIONAL_FEATURES),
      ...conjunctionFeatures,
    ],
    onDeviceLost: (info) => {
      void hooks.onDeviceLost(info);
    },
    onErrorReport: hooks.onErrorReport,
    // WebXR Stage 3: an XRGPUBinding can only wrap a device from an xrCompatible
    // adapter, and that is fixed at requestAdapter. `?xr=0` opts out.
    xrCompatible: hasXrGpuBinding() && new URLSearchParams(window.location.search).get('xr') !== '0',
  });
  await rt.context.initialize();

  rt.camera.attachToCanvas(rt.canvas);
  setupMobileOrientationSupport(rt, orientationChangeListener, orientationLockGestureListener);

  await createGpuResources(rt, { mode: 'boot', resizeListener });

  installZephyrDebugHooks(rt);
  hooks.startRenderLoop();

  console.log('[GrokZephyr] Initialization complete');
}
