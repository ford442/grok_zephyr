
import { GrokZephyrApp } from '@/app/GrokZephyrApp.js';
import { type ConstellationStats } from '@/focus.js';
import { type CameraState } from '@/camera/CameraController.js';

export class AppRenderManager {
  constructor(private app: GrokZephyrApp) {}

  public recordPassTimings(): void {
    const profiler = this.app.profiler;
    profiler.beginPass('CPU_OVERHEAD');
    profiler.endPass('CPU_OVERHEAD');
  }

  public estimateVisibleSatellites(): number {
    return Math.min(
      this.app.buffers?.getRealSatelliteCount() || 0,
      1000000
    );
  }

  public buildConstellationStats(): ConstellationStats {
    const satellites = this.estimateVisibleSatellites();
    return {
      totalSatellites: satellites,
      visibleSatellites: satellites,
      activeConstellations: this.app.getTLESource() ? 1 : 0
    };
  }

  public writeUniforms(time: number, deltaTime: number, camera: CameraState | null = null): void {
    if (!this.app.pipeline) return;

    const camState = camera || this.app.camera.getState();
    const [sunX, sunY, sunZ] = this.app.calculateSunPosition(time);

    this.app.pipeline.writeCommonUniforms({
      time,
      deltaTime,
      sunDirection: [sunX, sunY, sunZ],
      cameraPosition: [camState.position[0], camState.position[1], camState.position[2]],
      viewMatrix: this.app.camera.getViewMatrix(),
      projectionMatrix: this.app.camera.getProjectionMatrix(),
      resolution: [this.app.canvas.width, this.app.canvas.height],
    });
  }
}
