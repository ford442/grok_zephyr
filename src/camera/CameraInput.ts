import type { ViewMode } from '@/types/index.js';
import { MATH } from '@/types/constants.js';
import type { CameraAngles, GodViewParams, MouseState } from './cameraTypes.js';

export interface CameraInputDelegate {
  getCurrentMode(): ViewMode;
  getPitchLimit(): number;
  hasFocus(): boolean;
  getMutableCameraAngles(): CameraAngles;
  getGodView(): GodViewParams;
  getGodVelocity(): { yaw: number; pitch: number };
  getFleetTouchRoll(): number;
  setFleetTouchRoll(value: number): void;
  handleUserInteraction(): void;
  panBy(dx: number, dy: number): void;
  resetCameraAngle(): void;
  toggleOrbitLock(): void;
  notifyAngleChange(yaw: number, pitch: number): void;
  handleTouchDoubleTap(x: number, y: number): void;
  syncGodViewFromAngles(): void;
  seedGodVelocity(yaw: number, pitch: number): void;
  applyZoomSteps(steps: number): void;
}

export class CameraInput {
  private readonly MOUSE_SENSITIVITY = 0.25;
  private readonly TOUCH_SENSITIVITY = 0.25;
  private readonly TOUCH_ROTATION_SENSITIVITY = 0.6;

  readonly mouse: MouseState = {
    down: false,
    lastX: 0,
    lastY: 0,
  };

  readonly keys: Record<string, boolean> = {};

  private touchState = {
    active: new Map<number, { x: number; y: number }>(),
    lastPinchDist: 0,
    lastAngleRad: 0,
    lastCentroid: { x: 0, y: 0 },
    lastTapTime: 0,
    lastTapX: 0,
    lastTapY: 0,
  };

  private canvas: HTMLCanvasElement | null = null;
  private mouseMode: 'rotate' | 'pan' | null = null;

  constructor(private readonly delegate: CameraInputDelegate) {}

  isMouseDown(): boolean {
    return this.mouse.down;
  }

  getMouseMode(): 'rotate' | 'pan' | null {
    return this.mouseMode;
  }

  attachToCanvas(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;

    canvas.addEventListener('mousedown', (e) => {
      this.delegate.handleUserInteraction();
      if (e.button === 0 && !e.altKey) {
        this.mouseMode = 'rotate';
      } else if (e.button === 2 || e.button === 1 || (e.button === 0 && e.altKey)) {
        this.mouseMode = 'pan';
      } else {
        return;
      }

      this.mouse.down = true;
      this.mouse.lastX = e.clientX;
      this.mouse.lastY = e.clientY;
      canvas.style.cursor = 'grabbing';
    });

    window.addEventListener('mouseup', () => {
      this.mouse.down = false;
      this.mouseMode = null;
      if (this.canvas) {
        this.canvas.style.cursor = 'grab';
      }
    });

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.mouse.down || !this.mouseMode) return;

      const dx = e.movementX || (e.clientX - this.mouse.lastX);
      const dy = e.movementY || (e.clientY - this.mouse.lastY);

      if (this.mouseMode === 'rotate') {
        this.applyRotationDelta(dx, dy, this.MOUSE_SENSITIVITY);
      } else {
        this.delegate.panBy(-dx, dy);
      }

      this.mouse.lastX = e.clientX;
      this.mouse.lastY = e.clientY;
    });

    canvas.addEventListener('wheel', (e) => {
      this.delegate.handleUserInteraction();
      e.preventDefault();
      const mode = this.delegate.getCurrentMode();
      if (mode === 'god' || this.delegate.hasFocus()) {
        this.applyExponentialZoomSteps(Math.sign(e.deltaY));
      } else {
        const angles = this.delegate.getMutableCameraAngles();
        const zoomSpeed = 40;
        angles.distance = Math.max(
          500,
          Math.min(180000, angles.distance + e.deltaY * zoomSpeed),
        );
      }
    });

    canvas.addEventListener('dblclick', () => {
      this.delegate.resetCameraAngle();
    });

    canvas.style.cursor = 'grab';

    window.addEventListener('keydown', (e) => {
      this.delegate.handleUserInteraction();
      this.keys[e.key.toLowerCase()] = true;
      if (e.key.toLowerCase() === 'o') {
        this.delegate.toggleOrbitLock();
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false;
    });

    canvas.style.touchAction = 'none';

    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.delegate.handleUserInteraction();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches.item(i);
        if (!t) continue;
        this.touchState.active.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
      const count = this.touchState.active.size;
      if (count === 1) {
        const touch = [...this.touchState.active.values()][0];
        this.mouse.lastX = touch.x;
        this.mouse.lastY = touch.y;
        this.mouseMode = 'rotate';
        this.mouse.down = true;
      } else if (count === 2) {
        this.mouse.down = false;
        this.mouseMode = null;
        const [a, b] = this.getTouchPair();
        this.touchState.lastPinchDist = Math.hypot(b.x - a.x, b.y - a.y);
        this.touchState.lastAngleRad = Math.atan2(b.y - a.y, b.x - a.x);
        this.touchState.lastCentroid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches.item(i);
        if (!t) continue;
        this.touchState.active.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
      const count = this.touchState.active.size;
      if (count === 1) {
        const touch = [...this.touchState.active.values()][0];
        const dx = touch.x - this.mouse.lastX;
        const dy = touch.y - this.mouse.lastY;
        this.applyRotationDelta(dx, dy, this.TOUCH_SENSITIVITY);
        this.mouse.lastX = touch.x;
        this.mouse.lastY = touch.y;
      } else if (count === 2) {
        const [a, b] = this.getTouchPair();
        const newDist = Math.hypot(b.x - a.x, b.y - a.y);
        const newAngleRad = Math.atan2(b.y - a.y, b.x - a.x);
        const newCentroid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const ddx = newCentroid.x - this.touchState.lastCentroid.x;
        const ddy = newCentroid.y - this.touchState.lastCentroid.y;

        const minGestureSpanPx = 18;
        const hasStableSpan = newDist >= minGestureSpanPx && this.touchState.lastPinchDist >= minGestureSpanPx;
        const ratio = hasStableSpan && this.touchState.lastPinchDist > 0
          ? newDist / this.touchState.lastPinchDist
          : 1;
        const pinchStrength = Math.abs(Math.log(Math.max(1e-6, ratio)));
        const panStrength = Math.hypot(ddx, ddy) * 0.003;
        const angleDeltaRaw = newAngleRad - this.touchState.lastAngleRad;
        const angleDelta = Math.atan2(Math.sin(angleDeltaRaw), Math.cos(angleDeltaRaw));
        const rotateStrength = Math.abs(angleDelta);

        if (pinchStrength >= panStrength && pinchStrength >= rotateStrength && hasStableSpan) {
          const zoomSteps = -Math.log(Math.max(1e-6, ratio)) / Math.log(1.08);
          this.applyExponentialZoomSteps(zoomSteps);
        } else if (rotateStrength > 0.03 && hasStableSpan) {
          if (this.delegate.getCurrentMode() === 'sat-pov') {
            const maxTouchRoll = 18 * MATH.DEG_TO_RAD;
            const roll = this.delegate.getFleetTouchRoll();
            this.delegate.setFleetTouchRoll(Math.max(
              -maxTouchRoll,
              Math.min(maxTouchRoll, roll + angleDelta * this.TOUCH_ROTATION_SENSITIVITY),
            ));
          } else {
            const rotateDeg = angleDelta * MATH.RAD_TO_DEG * this.TOUCH_ROTATION_SENSITIVITY;
            const angles = this.delegate.getMutableCameraAngles();
            angles.yaw -= rotateDeg;
            angles.yaw = ((angles.yaw % 360) + 360) % 360;
            if (this.delegate.getCurrentMode() === 'god') {
              this.delegate.syncGodViewFromAngles();
            }
            this.delegate.notifyAngleChange(angles.yaw, angles.pitch);
          }
        } else if (ddx !== 0 || ddy !== 0) {
          this.delegate.panBy(-ddx, ddy);
        }

        this.touchState.lastPinchDist = newDist;
        this.touchState.lastAngleRad = newAngleRad;
        this.touchState.lastCentroid = newCentroid;
      }
    }, { passive: false });

    const endTouch = (e: TouchEvent): void => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches.item(i);
        if (!t) continue;
        this.touchState.active.delete(t.identifier);
      }
      const count = this.touchState.active.size;
      if (count === 0) {
        this.mouse.down = false;
        this.mouseMode = null;
        const now = performance.now();
        const lastTouch = e.changedTouches[0];
        if (lastTouch) {
          const dt = now - this.touchState.lastTapTime;
          const dx = lastTouch.clientX - this.touchState.lastTapX;
          const dy = lastTouch.clientY - this.touchState.lastTapY;
          if (dt < 350 && Math.hypot(dx, dy) < 50) {
            this.delegate.handleTouchDoubleTap(lastTouch.clientX, lastTouch.clientY);
            this.touchState.lastTapTime = 0;
          } else {
            this.touchState.lastTapTime = now;
            this.touchState.lastTapX = lastTouch.clientX;
            this.touchState.lastTapY = lastTouch.clientY;
          }
        }
      } else if (count === 1) {
        const touch = [...this.touchState.active.values()][0];
        this.mouse.lastX = touch.x;
        this.mouse.lastY = touch.y;
        this.mouse.down = true;
        this.mouseMode = 'rotate';
      } else if (count === 2) {
        const [a, b] = this.getTouchPair();
        this.touchState.lastPinchDist = Math.hypot(b.x - a.x, b.y - a.y);
        this.touchState.lastAngleRad = Math.atan2(b.y - a.y, b.x - a.x);
        this.touchState.lastCentroid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
    };
    canvas.addEventListener('touchend', endTouch, { passive: false });
    canvas.addEventListener('touchcancel', endTouch, { passive: false });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.touchState.active.clear();
        this.touchState.lastPinchDist = 0;
        this.touchState.lastAngleRad = 0;
        this.mouse.down = false;
        this.mouseMode = null;
      }
    });
  }

  private applyRotationDelta(dx: number, dy: number, sensitivity: number): void {
    const angles = this.delegate.getMutableCameraAngles();
    const mode = this.delegate.getCurrentMode();
    const pitchLimit = mode === 'sat-pov' ? 89 : this.delegate.getPitchLimit();

    angles.yaw -= dx * sensitivity;
    angles.yaw = ((angles.yaw % 360) + 360) % 360;
    angles.pitch += dy * sensitivity;
    angles.pitch = Math.max(-pitchLimit, Math.min(pitchLimit, angles.pitch));

    if (mode === 'god') {
      this.delegate.syncGodViewFromAngles();
      this.delegate.seedGodVelocity(dx * sensitivity, dy * sensitivity);
    }

    this.delegate.notifyAngleChange(angles.yaw, angles.pitch);
  }

  getTouchPair(): [{ x: number; y: number }, { x: number; y: number }] {
    const sorted = [...this.touchState.active.entries()].sort((a, b) => a[0] - b[0]);
    return [sorted[0][1], sorted[1][1]];
  }

  applyExponentialZoomSteps(steps: number): void {
    if (!Number.isFinite(steps) || steps === 0) return;
    this.delegate.applyZoomSteps(steps);
  }
}
