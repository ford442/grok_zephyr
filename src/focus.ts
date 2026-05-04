/**
 * Focus Manager
 * Selects satellites by raycast and keeps the camera locked to the chosen satellite.
 */

import type { Vec3 } from '@/types/index.js';
import type { CameraController } from '@/camera/CameraController.js';
import type { SatelliteGPUBuffer } from '@/core/SatelliteGPUBuffer.js';
import { mat4inv, v3dot, v3len, v3norm, v3scale, v3sub } from '@/utils/math.js';
import { CONSTANTS } from '@/types/constants.js';

export type FocusSelection = {
  index: number;
  position: Vec3;
  velocity: Vec3;
  altitude: number;
  speed: number;
};

export type FocusSelectionCallback = (selectedIndex: number) => void;

export class FocusManager {
  private selectedIndex = -1;
  private focusOverlay: HTMLDivElement;
  private previousModeIndex = 0;
  private currentTime = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: CameraController,
    private buffers: SatelliteGPUBuffer,
    private selectionChanged: FocusSelectionCallback,
  ) {
    this.focusOverlay = this.createOverlay();
    this.hideOverlay();
  }

  isFocused(): boolean {
    return this.selectedIndex >= 0;
  }

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  selectSatellite(selection: FocusSelection): void {
    this.selectedIndex = selection.index;
    this.previousModeIndex = this.camera.getViewModeIndex();
    this.camera.setFocusSatellite(selection.index, 70, this.currentTime);

    this.selectionChanged(this.selectedIndex);
    this.showOverlay(selection);
  }

  releaseFocus(): void {
    if (this.selectedIndex < 0) return;
    this.selectedIndex = -1;
    this.hideOverlay();
    this.camera.clearFocus();
    this.camera.setViewMode(this.previousModeIndex);
    this.selectionChanged(-1);
  }

  update(time: number): void {
    this.currentTime = time;
    if (this.selectedIndex < 0) return;

    const position = this.buffers.calculateSatellitePosition(this.selectedIndex, time);
    const velocityDir = this.buffers.calculateSatelliteVelocity(this.selectedIndex, time);
    const speed = this.getOrbitalSpeed(this.selectedIndex);
    const velocity = v3scale(velocityDir, speed);

    const altitude = Math.max(0, v3len(position) - CONSTANTS.EARTH_RADIUS_KM);
    this.updateOverlay({
      index: this.selectedIndex,
      position,
      velocity,
      altitude,
      speed,
    });
  }

  raycast(
    clientX: number,
    clientY: number,
    cameraState: { position: Vec3; target: Vec3; up: Vec3 },
    viewProjection: Float32Array,
    time: number,
  ): FocusSelection | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2.0 - 1.0;
    const y = 1.0 - ((clientY - rect.top) / rect.height) * 2.0;

    const invVP = mat4inv(viewProjection);
    const near = this.unproject(invVP, [x, y, 0, 1]);
    const far = this.unproject(invVP, [x, y, 1, 1]);
    const rayOrigin = cameraState.position;
    const rayDir = v3norm(v3sub(far, near));

    const coarseStep = 1024;
    const coarseThreshold2 = 300 * 300;
    let bestIndex = -1;
    let bestDist2 = Number.POSITIVE_INFINITY;

    for (let idx = 0; idx < CONSTANTS.NUM_SATELLITES; idx += coarseStep) {
      const pos = this.buffers.calculateSatellitePosition(idx, time);
      const dist2 = this.pointToRayDist2(pos, rayOrigin, rayDir);
      if (dist2 < bestDist2 && this.isPointInFront(pos, rayOrigin, rayDir)) {
        bestDist2 = dist2;
        bestIndex = idx;
      }
    }

    if (bestIndex < 0 || bestDist2 > coarseThreshold2) {
      return null;
    }

    const windowRadius = 8192;
    const start = Math.max(0, bestIndex - windowRadius);
    const end = Math.min(CONSTANTS.NUM_SATELLITES - 1, bestIndex + windowRadius);
    let closestIndex = -1;
    let closestDist2 = Number.POSITIVE_INFINITY;

    for (let idx = start; idx <= end; idx++) {
      const pos = this.buffers.calculateSatellitePosition(idx, time);
      if (!this.isPointInFront(pos, rayOrigin, rayDir)) continue;
      const dist2 = this.pointToRayDist2(pos, rayOrigin, rayDir);
      if (dist2 < closestDist2) {
        closestDist2 = dist2;
        closestIndex = idx;
      }
    }

    if (closestIndex < 0 || closestDist2 > 150 * 150) {
      return null;
    }

    const position = this.buffers.calculateSatellitePosition(closestIndex, time);
    const velocityDir = this.buffers.calculateSatelliteVelocity(closestIndex, time);
    const speed = this.getOrbitalSpeed(closestIndex);
    const velocity = v3scale(velocityDir, speed);
    const altitude = Math.max(0, v3len(position) - CONSTANTS.EARTH_RADIUS_KM);

    return { index: closestIndex, position, velocity, altitude, speed };
  }

  private getOrbitalSpeed(index: number): number {
    const data = this.buffers.getOrbitalElementData();
    const i = index * 4;
    const shellData = data[i + 3];
    const shellIndex = (shellData >> 8) & 0xff;
    const orbitRadii = [6711.0, 6921.0, 7521.0];
    const meanMotions = [0.001153, 0.001097, 0.000946];
    const radius = orbitRadii[shellIndex] ?? 6921.0;
    const meanMotion = meanMotions[shellIndex] ?? 0.001097;
    return radius * meanMotion;
  }

  private unproject(inv: Float32Array, point: [number, number, number, number]): Vec3 {
    const x = point[0];
    const y = point[1];
    const z = point[2];
    const w = point[3];
    const xp = inv[0] * x + inv[4] * y + inv[8] * z + inv[12] * w;
    const yp = inv[1] * x + inv[5] * y + inv[9] * z + inv[13] * w;
    const zp = inv[2] * x + inv[6] * y + inv[10] * z + inv[14] * w;
    const wp = inv[3] * x + inv[7] * y + inv[11] * z + inv[15] * w;
    return [xp / wp, yp / wp, zp / wp];
  }

  private pointToRayDist2(point: Vec3, origin: Vec3, direction: Vec3): number {
    const difference = v3sub(point, origin);
    const t = v3dot(difference, direction);
    const closest = v3sub(difference, v3scale(direction, t));
    return v3dot(closest, closest);
  }

  private isPointInFront(point: Vec3, origin: Vec3, direction: Vec3): boolean {
    const difference = v3sub(point, origin);
    return v3dot(difference, direction) > 0.0;
  }

  private createOverlay(): HTMLDivElement {
    const overlay = document.createElement('div');
    overlay.id = 'satellite-focus-info';
    overlay.className = 'satellite-focus-overlay';
    document.body.appendChild(overlay);
    return overlay;
  }

  private showOverlay(selection: FocusSelection): void {
    this.focusOverlay.style.display = 'block';
    this.updateOverlay(selection);
  }

  private hideOverlay(): void {
    this.focusOverlay.style.display = 'none';
  }

  private updateOverlay(selection: FocusSelection): void {
    const { index, altitude, speed } = selection;
    const velocityMagnitude = speed.toFixed(2);
    const altitudeKm = altitude.toFixed(1);

    this.focusOverlay.innerHTML = `
      <strong>Satellite #${index.toLocaleString()}</strong><br>
      Altitude: ${altitudeKm} km<br>
      Speed: ${velocityMagnitude} km/s
    `;
  }
}
