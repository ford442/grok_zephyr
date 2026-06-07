
import { GrokZephyrApp } from '@/app/GrokZephyrApp.js';
import { mat4inv } from '@/utils/math.js';
import { CONSTANTS } from '@/types/constants.js';

export class AppRenderLoop {
  constructor(private app: GrokZephyrApp) {}

  public render(timestamp: number): void {
    if (!this.app.context || !this.app.buffers || !this.app.pipeline) return;

    const context = this.app.context;
    const device = context.device;
    const { width, height } = this.app.canvas;

    if (width === 0 || height === 0) {
      this.app.animationFrameId = requestAnimationFrame((t) => this.render(t));
      return;
    }

    try {
      this.app.profiler.beginFrame();

      const timeScale = this.app.timeScale;
      let dt = 0;
      if (this.app.lastTime > 0) {
        dt = (timestamp - this.app.lastTime) * 0.001 * timeScale;
      }
      this.app.lastTime = timestamp;

      // Adjust dt if we're generating patterns to skip visual jumps
      if (this.app.patternMode !== 0 && this.app.simTime === 0) {
        dt = 1/60; // Force initial dt
      }

      this.app.simTime += dt;
      this.app.audio.update(this.app.simTime, dt, this.app.camera);

      // Handle cinematic mode
      if (this.app.camera.isCinematicActive()) {
        const timeSinceActivity = (performance.now() * 0.001) - this.app.lastUserActivityTime;
        if (timeSinceActivity > 3.0) {
          this.app.camera.updateCinematic(performance.now() * 0.001);
          const camState = this.app.camera.getState();
          this.app.ui.setViewMode(this.app.camera.getViewModeName(), this.app.camera.getCameraAngles().distance);
          this.app.updateGroundObserverOverlay();
          this.app.audio.setViewMode(this.app.camera.getViewModeName() as any);
        }
      }

      const cameraState = this.app.camera.getState();

      // Update UI
      this.app.ui.updateCoordinates(cameraState.position);

      // Update uniform buffers
      this.app.appRenderManager.writeUniforms(this.app.simTime, dt, cameraState);
      this.app.appSceneManager.updateBeamParamsTime(this.app.simTime);

      this.app.appRenderManager.recordPassTimings(); // Simulate overhead

      // 1. COMPUTE PASS
      this.app.profiler.beginPass('COMPUTE_ORBITAL');

      const computePass = device.createCommandEncoder({ label: 'compute_pass' });
      const pass = computePass.beginComputePass();

      if (this.app.animationMode === 0) {
         // Standard orbital propagation
         pass.setPipeline(this.app.pipeline.getComputePipeline());
         pass.setBindGroup(0, this.app.pipeline.getComputeBindGroup());

         const workgroups = Math.ceil(CONSTANTS.NUM_SATELLITES / 64);
         pass.dispatchWorkgroups(workgroups);
      } else {
         // Smile V2 procedural animation
         pass.setPipeline(this.app.pipeline.getSmileV2ComputePipeline());
         pass.setBindGroup(0, this.app.pipeline.getComputeBindGroup());
         pass.setBindGroup(1, this.app.pipeline.getSmileV2BindGroup());

         const workgroups = Math.ceil(CONSTANTS.NUM_SATELLITES / 64);
         pass.dispatchWorkgroups(workgroups);

         this.app.profiler.endPass('COMPUTE_ORBITAL');
         this.app.profiler.beginPass('COMPUTE_SMILE');
         this.app.profiler.endPass('COMPUTE_SMILE');
      }

      if (this.app.patternMode === 4) { // sky_strips
         this.app.profiler.beginPass('COMPUTE_SKY_STRIPS');
         pass.setPipeline(this.app.pipeline.getSkyStripsComputePipeline());
         pass.setBindGroup(0, this.app.pipeline.getComputeBindGroup());
         pass.setBindGroup(1, this.app.pipeline.getSkyStripsBindGroup());
         const workgroups = Math.ceil(CONSTANTS.NUM_SATELLITES / 64);
         pass.dispatchWorkgroups(workgroups);
         this.app.profiler.endPass('COMPUTE_SKY_STRIPS');
      }

      pass.end();
      device.queue.submit([computePass.finish()]);

      // 2. RENDERING PIPELINE
      const renderTargets = this.app.pipeline.getRenderTargets();
      const currentTexture = context.getCurrentTexture();

      // Record trail samples (requires CPU readback of camera state)
      if (this.app.trailRenderer && this.app.trailsEnabled) {
         this.app.recordTrailSamplesForCamera(this.app.simTime, cameraState);

         this.app.profiler.beginPass('SCENE_TRAILS');
         const trailEncoder = device.createCommandEncoder({ label: 'trail_update' });
         this.app.trailRenderer.update(device, trailEncoder, this.app.camera.getViewMatrix(), this.app.camera.getProjectionMatrix(), this.app.simTime);
         device.queue.submit([trailEncoder.finish()]);
         this.app.profiler.endPass('SCENE_TRAILS');
      }

      // Render Scene
      const sceneEncoder = device.createCommandEncoder({ label: 'scene_pass' });
      const scenePassDesc: GPURenderPassDescriptor = {
        colorAttachments: [{
          view: renderTargets.sceneColor.createView(),
          loadOp: 'clear' as GPULoadOp,
          storeOp: 'store' as GPUStoreOp,
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
        }],
        depthStencilAttachment: {
          view: renderTargets.sceneDepth.createView(),
          depthClearValue: 1.0,
          depthLoadOp: 'clear' as GPULoadOp,
          depthStoreOp: 'store' as GPUStoreOp,
        }
      };

      const sceneRenderPass = sceneEncoder.beginRenderPass(scenePassDesc);

      // Stars
      if (this.app.earthGeometry) {
        this.app.profiler.beginPass('SCENE_STARS');
        sceneRenderPass.setPipeline(this.app.pipeline.getStarsPipeline());
        sceneRenderPass.setBindGroup(0, this.app.pipeline.getRenderBindGroup());
        sceneRenderPass.setVertexBuffer(0, this.app.earthGeometry.vertexBuffer);
        sceneRenderPass.setIndexBuffer(this.app.earthGeometry.indexBuffer, 'uint32');
        sceneRenderPass.drawIndexed(this.app.earthGeometry.indexCount, 4000, 0, 0, 0);
        this.app.profiler.endPass('SCENE_STARS');
      }

      // Volumetric Beams (Behind Earth)
      if (this.app.volumetricBeamRenderer && this.app.volumetricBeamRenderer.isInitialized()) {
        this.app.profiler.beginPass('SCENE_BEAMS');
        this.app.volumetricBeamRenderer.render(
          sceneRenderPass,
          this.app.pipeline.getRenderBindGroup(),
          this.app.camera.getViewMatrix(),
          this.app.camera.getProjectionMatrix()
        );
        this.app.profiler.endPass('SCENE_BEAMS');
      }

      // Earth & Atmosphere
      if (this.app.earthAtmosphereRenderer && this.app.earthGeometry) {
        this.app.profiler.beginPass('SCENE_EARTH');
        this.app.earthAtmosphereRenderer.render(
          sceneRenderPass,
          this.app.pipeline.getRenderBindGroup(),
          this.app.earthGeometry.vertexBuffer,
          this.app.earthGeometry.indexBuffer,
          this.app.earthGeometry.indexCount,
          cameraState,
          this.app.calculateSunPosition(this.app.simTime)
        );
        this.app.profiler.endPass('SCENE_EARTH');
      }

      // Constellation Patterns
      if (this.app.patternMode !== 0 && this.app.earthGeometry) {
        this.app.profiler.beginPass('SCENE_PATTERNS');
        sceneRenderPass.setPipeline(this.app.pipeline.getPatternsPipeline());
        sceneRenderPass.setBindGroup(0, this.app.pipeline.getRenderBindGroup());
        sceneRenderPass.setBindGroup(1, this.app.pipeline.getPatternsBindGroup());
        sceneRenderPass.setVertexBuffer(0, this.app.earthGeometry.vertexBuffer);
        sceneRenderPass.setIndexBuffer(this.app.earthGeometry.indexBuffer, 'uint32');
        sceneRenderPass.drawIndexed(this.app.earthGeometry.indexCount, 16384, 0, 0, 0);
        this.app.profiler.endPass('SCENE_PATTERNS');
      }

      // Trails
      if (this.app.trailRenderer && this.app.trailsEnabled) {
        this.app.trailRenderer.render(sceneRenderPass, this.app.pipeline.getRenderBindGroup());
      }

      // Satellites
      this.app.profiler.beginPass('SCENE_SATELLITES');
      sceneRenderPass.setPipeline(this.app.pipeline.getRenderPipeline());
      sceneRenderPass.setBindGroup(0, this.app.pipeline.getRenderBindGroup());
      sceneRenderPass.draw(6, CONSTANTS.NUM_SATELLITES, 0, 0);
      this.app.profiler.endPass('SCENE_SATELLITES');

      sceneRenderPass.end();
      device.queue.submit([sceneEncoder.finish()]);

      // Focus query back-read
      if (this.app.focusManager) {
         this.app.focusManager.readbackFocus(this.app.simTime);
      }

      // Post-Processing
      if (this.app.postProcessStack && this.app.postProcessEnabled) {
         const ppEncoder = device.createCommandEncoder({ label: 'postprocess_pass' });

         const curViewMat = this.app.camera.getViewMatrix();
         const curProjMat = this.app.camera.getProjectionMatrix();
         const curInvViewProj = mat4inv(this.app.camera.getViewProjMatrix());

         const prevViewProj = this.app.camera.getPreviousViewProjMatrix();

         this.app.postProcessStack.updateUniforms(
             cameraState,
             this.app.exposureSettings,
             curViewMat,
             curProjMat,
             curInvViewProj,
             prevViewProj,
             dt,
             this.app.taaEnabled
         );

         this.app.postProcessStack.render(ppEncoder, currentTexture, this.app.profiler);
         device.queue.submit([ppEncoder.finish()]);
      } else {
         const ppEncoder = device.createCommandEncoder({ label: 'postprocess_bypass' });
         const pass = ppEncoder.beginRenderPass({
            colorAttachments: [{
               view: currentTexture.createView(),
               loadOp: 'clear' as GPULoadOp,
               storeOp: 'store' as GPUStoreOp,
               clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
            }]
         });

         this.app.postProcessStack?.renderBypass(pass);
         pass.end();
         device.queue.submit([ppEncoder.finish()]);
      }

      this.app.camera.updatePreviousMatrices();
      this.app.profiler.endFrame();

    } catch (e) {
      this.app.handleError(e);
      return; // Stop animation loop on error
    }

    this.app.animationFrameId = requestAnimationFrame((t) => this.render(t));
  }
}
