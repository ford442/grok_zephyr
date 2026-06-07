
import { type QualityLevel } from '@/core/QualityPresets.js';

export class MobileManager {
  public static detectMobileDevice(): boolean {
    if (typeof window === 'undefined') return false;
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const isSmallScreen = window.innerWidth <= 800 || window.innerHeight <= 800;
    return isTouch && isSmallScreen;
  }

  public static detectMobileDefaultQuality(): QualityLevel {
    if (typeof window === 'undefined') return 'high';
    const isMobile = MobileManager.detectMobileDevice();
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    if (isMobile) {
      return isIOS ? 'low' : 'medium';
    }
    return 'high';
  }

  public static tryLockLandscapeOrientation(): void {
    if (typeof screen !== 'undefined' && screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(() => {
      });
    }
  }

  public static updateMobileViewportPresentation(): void {
    if (typeof document === 'undefined') return;

    if (window.innerHeight > window.innerWidth) {
      document.body.classList.add('portrait-mode');
    } else {
      document.body.classList.remove('portrait-mode');
    }

    setTimeout(() => {
      window.scrollTo(0, 1);
    }, 100);
  }
}
