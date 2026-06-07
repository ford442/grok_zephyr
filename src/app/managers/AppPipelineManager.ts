
import { GrokZephyrApp } from '@/app/GrokZephyrApp.js';
import { WebGPUCompatibilityManager } from '@/ui/WebGPUCompatibilityManager.js';
import { RenderPipeline } from '@/render/RenderPipeline.js';
import { PostProcessStack } from '@/render/PostProcessStack.js';
import { TrailRenderer } from '@/render/TrailRenderer.js';
import { EarthAtmosphereRenderer } from '@/earth.js';
import { VolumetricBeamRenderer } from '@/render/VolumetricBeamRenderer.js';

export class AppPipelineManager {
  constructor(private app: GrokZephyrApp) {}

  public async setupPipeline(): Promise<void> {
    const { device, presentationFormat } = this.app.context!;

    // Create pipelines
    this.app.pipeline = new RenderPipeline(device, presentationFormat);
    await this.app.pipeline.initialize();

    this.app.postProcessStack = new PostProcessStack(device, presentationFormat);
    await this.app.postProcessStack.initialize();

    // Create trail renderer
    this.app.trailRenderer = new TrailRenderer(device, presentationFormat);
    await this.app.trailRenderer.initialize();

    // Create Earth renderer
    this.app.earthAtmosphereRenderer = new EarthAtmosphereRenderer(device, presentationFormat);
    await this.app.earthAtmosphereRenderer.initialize();

    // Create Volumetric Beams renderer
    this.app.volumetricBeamRenderer = new VolumetricBeamRenderer(device, presentationFormat);
    await this.app.volumetricBeamRenderer.initialize();

    // Bind shared targets
    const renderTargets = this.app.pipeline.getRenderTargets();
    this.app.postProcessStack.setSourceTexture(renderTargets.sceneColor);
    this.app.postProcessStack.setDepthTexture(renderTargets.sceneDepth);

    // Handle resize
    this.app.handleResize();
  }
}
