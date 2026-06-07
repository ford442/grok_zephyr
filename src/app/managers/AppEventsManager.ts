
import { GrokZephyrApp } from '@/app/GrokZephyrApp.js';
import { MobileManager } from '@/app/managers/MobileManager.js';

export class AppEventsManager {
  constructor(private app: GrokZephyrApp) {}

  public get resizeListener() {
    return () => {
      this.app.handleResize();
    };
  }

  public get orientationChangeListener() {
    return () => {
      MobileManager.updateMobileViewportPresentation();
      this.app.handleResize();
    };
  }

  public get orientationLockGestureListener() {
    return () => {
      MobileManager.tryLockLandscapeOrientation();
    };
  }

  public bindEvents() {
    window.addEventListener('resize', this.resizeListener);
    window.addEventListener('orientationchange', this.orientationChangeListener);
    document.addEventListener('touchstart', this.orientationLockGestureListener, { once: true, passive: true });
    document.addEventListener('click', this.orientationLockGestureListener, { once: true, passive: true });

    this.app.canvas.addEventListener('click', (e) => this.app.handleCanvasClick(e));
  }

  public unbindEvents() {
    window.removeEventListener('resize', this.resizeListener);
    window.removeEventListener('orientationchange', this.orientationChangeListener);
    document.removeEventListener('touchstart', this.orientationLockGestureListener);
    document.removeEventListener('click', this.orientationLockGestureListener);
  }
}
