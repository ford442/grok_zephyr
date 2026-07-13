import { WebGPUContext } from '@/core/WebGPUContext.js';
import type { WebGPUErrorReport } from '@/core/WebGPUErrorReporter.js';
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
  };

  win.zephyrDebug = {
    loseDevice: () => {
      if (!rt.context) {
        throw new Error('WebGPU context is not initialized');
      }
      rt.context.loseDeviceForTesting();
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
  rt.context = new WebGPUContext(rt.canvas, {
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
