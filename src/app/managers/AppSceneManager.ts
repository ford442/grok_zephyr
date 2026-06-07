
import { GrokZephyrApp } from '@/app/GrokZephyrApp.js';
import { extractFrustum, genSphere } from '@/utils/math.js';

export class AppSceneManager {
  constructor(private app: GrokZephyrApp) {}

  public createEarthGeometry(): void {
    const { vertices, indices } = genSphere(128, 128);

    if (!this.app.context) return;
    const device = this.app.context.device;

    const vBuf = device.createBuffer({
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vBuf, 0, vertices);

    const iBuf = device.createBuffer({
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(iBuf, 0, indices);

    this.app.earthGeometry = {
      vertexBuffer: vBuf,
      indexBuffer: iBuf,
      indexCount: indices.length,
    };
  }

  public updateBeamParamsTime(time: number): void {
    if (this.app.volumetricBeamRenderer && this.app.volumetricBeamRenderer.isInitialized()) {
      const mode = this.app.patternMode === 0 ? 0 : 1;
      const count = mode === 1 ? 4096 : 2048;

      const config = {
        intensity: 2.0,
        length: 8000,
        thickness: 1.5,
        fadeStart: 2000,
        timeScale: 0.5,
        beamCount: count,
        mode,
        patternSeed: this.app.patternSeed
      };
      this.app.volumetricBeamRenderer.setConfig(config);
      this.app.volumetricBeamRenderer.updateTime(time);
    }
  }

  public calculateSunPosition(simTime: number): [number, number, number] {
    const period = 24 * 60 * 60;
    const t = (simTime % period) / period;
    const angle = t * Math.PI * 2;
    const tilt = 23.5 * Math.PI / 180;

    const sunX = Math.cos(angle);
    const sunZ = Math.sin(angle);
    const sunY = Math.sin(tilt) * Math.sin(angle);

    const len = Math.sqrt(sunX * sunX + sunY * sunY + sunZ * sunZ);
    return [sunX / len, sunY / len, sunZ / len];
  }
}
