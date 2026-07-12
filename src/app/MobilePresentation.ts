import type { QualityLevel } from '@/core/QualityPresets.js';
import type { AppRuntime } from '@/app/AppRuntime.js';

export function detectMobileDevice(): boolean {
  if (navigator.maxTouchPoints > 1) {
    if ('userAgentData' in navigator) {
      const data = (navigator as { userAgentData?: { mobile?: boolean } }).userAgentData;
      if (data && typeof data.mobile === 'boolean') return data.mobile;
    }
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  }
  return false;
}

export function detectMobileDefaultQuality(): QualityLevel {
  if (!detectMobileDevice()) {
    return 'high';
  }

  const nav = navigator as Navigator & { deviceMemory?: number };
  const deviceMemory = nav.deviceMemory ?? 0;
  const cores = navigator.hardwareConcurrency || 0;
  const isAndroid = /Android/i.test(navigator.userAgent);

  const lowMemory = deviceMemory > 0 && deviceMemory <= 4;
  const lowCoreCount = cores > 0 && cores <= 4;
  const constrainedAndroid = isAndroid && ((deviceMemory > 0 && deviceMemory <= 6) || (cores > 0 && cores <= 6));

  return (lowMemory || lowCoreCount || constrainedAndroid) ? 'low' : 'balanced';
}

export function getDrawableSize(rt: AppRuntime): { width: number; height: number } | null {
  const rawDpr = window.devicePixelRatio || 1;
  const dpr = rt.isMobileDevice ? Math.min(rawDpr, 1.5) : rawDpr;
  const width = Math.floor(rt.canvas.clientWidth * dpr);
  const height = Math.floor(rt.canvas.clientHeight * dpr);
  return width > 0 && height > 0 ? { width, height } : null;
}

export function updateMobileViewportPresentation(rt: AppRuntime): void {
  if (!rt.isMobileDevice) return;

  const portrait = window.innerHeight > window.innerWidth;
  document.body.classList.toggle('is-portrait-mobile', portrait);

  if (portrait) {
    const letterboxAspect = 16 / 9;
    const letterboxHeight = Math.max(1, Math.floor(window.innerWidth / letterboxAspect));
    const height = Math.min(window.innerHeight, letterboxHeight);
    const top = Math.max(0, Math.floor((window.innerHeight - height) * 0.5));
    rt.canvas.style.width = '100vw';
    rt.canvas.style.height = `${height}px`;
    rt.canvas.style.top = `${top}px`;
    rt.canvas.style.left = '0px';
  } else {
    rt.canvas.style.width = '100vw';
    rt.canvas.style.height = '100vh';
    rt.canvas.style.top = '0px';
    rt.canvas.style.left = '0px';
  }
}

export function tryLockLandscapeOrientation(rt: AppRuntime): void {
  if (rt.orientationLockAttempted) return;
  rt.orientationLockAttempted = true;

  if (!('orientation' in screen)) return;
  const orientation = screen.orientation as ScreenOrientation & {
    lock?: (orientation: 'any' | 'natural' | 'landscape' | 'portrait' | 'portrait-primary' | 'portrait-secondary' | 'landscape-primary' | 'landscape-secondary') => Promise<void>;
  };
  if (typeof orientation.lock !== 'function') return;

  orientation.lock('landscape').catch(() => {
    // Ignore lock errors (unsupported, denied, or unavailable without fullscreen).
  });
}

export function setupMobileOrientationSupport(
  rt: AppRuntime,
  orientationChangeListener: () => void,
  orientationLockGestureListener: () => void,
): void {
  if (!rt.isMobileDevice) return;
  updateMobileViewportPresentation(rt);
  window.addEventListener('orientationchange', orientationChangeListener);
  window.addEventListener('pointerdown', orientationLockGestureListener, { passive: true });
  window.addEventListener('touchstart', orientationLockGestureListener, { passive: true });
}

export function teardownMobileOrientationSupport(
  orientationChangeListener: () => void,
  orientationLockGestureListener: () => void,
): void {
  window.removeEventListener('orientationchange', orientationChangeListener);
  window.removeEventListener('pointerdown', orientationLockGestureListener);
  window.removeEventListener('touchstart', orientationLockGestureListener);
}

export function handleResize(rt: AppRuntime): void {
  updateMobileViewportPresentation(rt);

  if (rt.backend === 'webgl') {
    const size = getDrawableSize(rt);
    if (size && rt.webglRenderer) {
      rt.webglRenderer.resize(size.width, size.height);
    }
    return;
  }

  if (!rt.context || !rt.buffers || !rt.pipeline) return;

  const size = getDrawableSize(rt);
  if (!size) return;
  const { width, height } = size;

  rt.canvas.width = width;
  rt.canvas.height = height;

  rt.context.resize(width, height);
  rt.pipeline.resize(width, height);
  rt.postProcessStack?.resize(width, height);
  rt.volumetricBeamRenderer?.resize(width, height);
  rt.buffers.updateBloomUniforms(width, height);
}
