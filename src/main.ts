/**
 * Grok Zephyr - Main Entry Point
 * 
 * WebGPU-powered orbital simulation with 1M+ satellites.
 */

import { WebGPUContext, WebGPUError } from '@/core/WebGPUContext.js';
import { SatelliteGPUBuffer } from '@/core/SatelliteGPUBuffer.js';
import { RenderPipeline } from '@/render/RenderPipeline.js';
import { CameraController } from '@/camera/CameraController.js';
import { UIManager } from '@/ui/UIManager.js';
import { PerformanceProfiler } from '@/utils/PerformanceProfiler.js';
import { genSphere, extractFrustum } from '@/utils/math.js';
import { CONSTANTS, RENDER, CAMERA, BUFFER_SIZES } from '@/types/constants.js';

import './styles.css';

/**
 * Main Application Class
 */
class GrokZephyrApp {
  private canvas: HTMLCanvasElement;
  private context: WebGPUContext | null = null;
  private buffers: SatelliteGPUBuffer | null = null;
  private pipeline: RenderPipeline | null = null;
  private camera: CameraController;
  private ui: UIManager;
  private profiler: PerformanceProfiler;
  
  // Earth geometry
  private earthVertexBuffer: GPUBuffer | null = null;
  private earthIndexBuffer: GPUBuffer | null = null;
  private earthIndexCount = 0;
  
  // Animation state
  private animationId = 0;
  private isRunning = false;
  private lastTime = 0;

  constructor() {
    const canvas = document.getElementById('gpu-canvas') as HTMLCanvasElement;
    if (!canvas) {
      throw new Error('Canvas element #gpu-canvas not found');
    }
    this.canvas = canvas;
    
    this.camera = new CameraController();
    this.ui = new UIManager();
    this.profiler = new PerformanceProfiler();
    
    // Setup callbacks
    this.setupCallbacks();
  }

  /**
   * Setup UI and camera callbacks
   */
  private setupCallbacks(): void {
    // Camera mode change updates UI
    this.camera.onModeChange((mode, name, altitude) => {
      this.ui.setViewMode(name, altitude);
      this.ui.setActiveButton(this.camera.getViewModeIndex());
    });

    // UI view change updates camera
    this.ui.onViewModeChange((index) => {
      this.camera.setViewMode(index);
    });

    // Stats update
    this.profiler.onStatsUpdate((stats) => {
      this.ui.updateStats(stats);
    });
  }

  /**
   * Initialize the application
   */
  async initialize(): Promise<void> {
    try {
      console.log('[GrokZephyr] Initializing...');
      
      // Initialize WebGPU
      this.context = new WebGPUContext(this.canvas);
      const { device } = await this.context.initialize();
      
      // Initialize performance profiler
      await this.profiler.initialize(device);
      
      // Attach camera to canvas
      this.camera.attachToCanvas(this.canvas);
      
      // Initialize buffers
      this.buffers = new SatelliteGPUBuffer(this.context);
      const bufferSet = this.buffers.initialize();
      
      // Generate and upload orbital elements
      this.buffers.generateOrbitalElements();
      this.buffers.uploadOrbitalElements();
      
      // Create Earth geometry
      this.createEarthGeometry();
      
      // Initialize render pipeline
      this.pipeline = new RenderPipeline(this.context, bufferSet);
      
      // Set initial canvas size and initialize pipeline
      const dpr = window.devicePixelRatio || 1;
      const width = Math.floor(this.canvas.clientWidth * dpr);
      const height = Math.floor(this.canvas.clientHeight * dpr);
      this.pipeline.initialize(width, height);
      this.buffers.updateBloomUniforms(width, height);
      
      // Update UI
      this.ui.setFleetCount(CONSTANTS.NUM_SATELLITES);
      this.ui.hideError();
      
      // Set initial view mode
      this.camera.setViewMode(0);
      
      // Start render loop
      this.start();
      
      console.log('[GrokZephyr] Initialization complete');
      
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Create Earth sphere geometry
   */
  private createEarthGeometry(): void {
    if (!this.context) return;
    
    const sphere = genSphere(
      CONSTANTS.EARTH_RADIUS_KM,
      64, // rings
      64  // segments
    );
    
    this.earthIndexCount = sphere.indices.length;
    
    // Interleave position and normal data
    const vertexCount = sphere.vertices.length / 3;
    const interleaved = new Float32Array(vertexCount * 6);
    
    for (let i = 0; i < vertexCount; i++) {
      interleaved[i * 6 + 0] = sphere.vertices[i * 3 + 0];
      interleaved[i * 6 + 1] = sphere.vertices[i * 3 + 1];
      interleaved[i * 6 + 2] = sphere.vertices[i * 3 + 2];
      interleaved[i * 6 + 3] = sphere.normals[i * 3 + 0];
      interleaved[i * 6 + 4] = sphere.normals[i * 3 + 1];
      interleaved[i * 6 + 5] = sphere.normals[i * 3 + 2];
    }
    
    this.earthVertexBuffer = this.context.createVertexBuffer(interleaved.byteLength);
    this.context.writeBuffer(this.earthVertexBuffer, interleaved);
    
    this.earthIndexBuffer = this.context.createIndexBuffer(sphere.indices.byteLength);
    this.context.writeBuffer(this.earthIndexBuffer, sphere.indices);
  }

  /**
   * Handle window resize
   */
  private handleResize(): void {
    if (!this.context || !this.buffers || !this.pipeline) return;
    
    const dpr = window.devicePixelRatio || 1;
    const width = Math.floor(this.canvas.clientWidth * dpr);
    const height = Math.floor(this.canvas.clientHeight * dpr);
    
    this.context.resize(width, height);
    this.pipeline.resize(width, height);
    this.buffers.updateBloomUniforms(width, height);
  }

  /**
   * Write uniform buffer data
   */
  private writeUniforms(time: number, deltaTime: number): void {
    if (!this.context || !this.buffers) return;
    
    const { width, height } = this.context.getCanvasSize();
    const aspect = width / height;
    
    // Calculate camera
    const camera = this.camera.calculateCamera(
      (idx, t) => this.buffers!.calculateSatellitePosition(idx, t),
      (idx, t) => this.buffers!.calculateSatelliteVelocity(idx, t),
      time
    );
    
    const { viewProjection, view } = this.camera.buildViewProjection(camera, aspect);
    const { right, up } = this.camera.getCameraAxes(view);
    
    // Extract frustum planes
    const frustum = extractFrustum(viewProjection);
    
    // Build uniform buffer (256 bytes)
    const uniformData = new ArrayBuffer(BUFFER_SIZES.UNIFORM);
    const f32 = new Float32Array(uniformData);
    const u32 = new Uint32Array(uniformData);
    
    // View-projection matrix (0-63)
    f32.set(viewProjection, 0);
    
    // Camera position (64-79)
    f32[16] = camera.position[0];
    f32[17] = camera.position[1];
    f32[18] = camera.position[2];
    f32[19] = 1.0;
    
    // Camera right (80-95)
    f32[20] = right[0];
    f32[21] = right[1];
    f32[22] = right[2];
    f32[23] = 0.0;
    
    // Camera up (96-111)
    f32[24] = up[0];
    f32[25] = up[1];
    f32[26] = up[2];
    f32[27] = 0.0;
    
    // Time, delta time, view mode (112-123)
    f32[28] = time;
    f32[29] = deltaTime;
    u32[30] = this.camera.getViewModeIndex();
    u32[31] = 0;
    
    // Frustum planes (128-223) - 6 planes * 4 floats each
    for (let p = 0; p < 6; p++) {
      f32[32 + p * 4 + 0] = frustum[p][0];
      f32[32 + p * 4 + 1] = frustum[p][1];
      f32[32 + p * 4 + 2] = frustum[p][2];
      f32[32 + p * 4 + 3] = frustum[p][3];
    }
    
    // Screen size (224-231)
    f32[56] = width;
    f32[57] = height;
    f32[58] = 0.0;
    f32[59] = 0.0;
    
    // Write to GPU
    this.context.writeBuffer(this.buffers.getBuffers().uniforms, uniformData);
  }

  /**
   * Main render loop
   */
  private render = (timestamp: number): void => {
    if (!this.isRunning || !this.context || !this.pipeline || !this.earthVertexBuffer || !this.earthIndexBuffer) {
      return;
    }
    
    // Handle resize
    const dpr = window.devicePixelRatio || 1;
    const width = Math.floor(this.canvas.clientWidth * dpr);
    const height = Math.floor(this.canvas.clientHeight * dpr);
    if (width !== this.canvas.width || height !== this.canvas.height) {
      this.handleResize();
    }
    
    // Calculate timing
    const time = timestamp * 0.001;
    const deltaTime = Math.min(time - this.lastTime, 0.1);
    this.lastTime = time;
    
    // Update profiler
    this.profiler.beginFrame(timestamp);
    
    // Write uniforms
    this.writeUniforms(time, deltaTime);
    
    // Create command encoder
    const encoder = this.context.createCommandEncoder('frame');
    
    // Pass 1: Compute orbital positions
    this.pipeline.encodeComputePass(encoder);
    
    // Pass 2: Scene rendering (different for ground view)
    if (this.camera.getViewMode() === 'ground') {
      this.pipeline.encodeGroundScenePass(encoder);
    } else {
      this.pipeline.encodeScenePass(
        encoder,
        this.earthVertexBuffer,
        this.earthIndexBuffer,
        this.earthIndexCount
      );
    }
    
    // Passes 3-5: Bloom
    this.pipeline.encodeBloomPasses(encoder);
    
    // Pass 6: Composite to screen
    const outputView = this.context.getContext().getCurrentTexture().createView();
    this.pipeline.encodeCompositePass(encoder, outputView);
    
    // Submit
    this.context.submit([encoder.finish()]);
    
    // Update profiler
    const stats = this.profiler.endFrame(timestamp);
    if (stats) {
      // Estimate visible satellites (this is approximate)
      // In a full implementation, we'd use occlusion queries
      stats.visibleSatellites = this.estimateVisibleSatellites();
    }
    
    // Next frame
    this.animationId = requestAnimationFrame(this.render);
  };

  /**
   * Estimate visible satellites (simplified)
   */
  private estimateVisibleSatellites(): number {
    // This is a rough estimate based on view mode
    const mode = this.camera.getViewModeIndex();
    if (mode === 0) {
      // Horizon view - roughly 10-15% visible
      return Math.floor(CONSTANTS.NUM_SATELLITES * 0.12);
    } else if (mode === 2) {
      // Fleet POV - very few visible
      return Math.floor(CONSTANTS.NUM_SATELLITES * 0.001);
    } else if (mode === 3) {
      // Ground view - can see satellites above horizon
      return Math.floor(CONSTANTS.NUM_SATELLITES * 0.15);
    } else {
      // God view - depends on distance
      return Math.floor(CONSTANTS.NUM_SATELLITES * 0.25);
    }
  }

  /**
   * Start the render loop
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.animationId = requestAnimationFrame(this.render);
  }

  /**
   * Stop the render loop
   */
  stop(): void {
    this.isRunning = false;
    cancelAnimationFrame(this.animationId);
  }

  /**
   * Handle initialization errors
   */
  private handleError(error: unknown): void {
    console.error('[GrokZephyr] Error:', error);
    
    let message = 'Unknown error occurred';
    
    if (error instanceof WebGPUError) {
      message = error.message;
    } else if (error instanceof Error) {
      message = error.message;
    }
    
    this.ui.showError(
      message +
      '<br><br>Please use a modern browser with WebGPU enabled (Chrome 113+, Edge 113+, or Firefox Nightly).'
    );
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stop();
    this.pipeline?.destroy();
    this.buffers?.destroy();
    this.context?.destroy();
    this.profiler.destroy();
    this.earthVertexBuffer?.destroy();
    this.earthIndexBuffer?.destroy();
  }
}

/**
 * Initialize application when DOM is ready
 */
function main(): void {
  const app = new GrokZephyrApp();
  app.initialize().catch(console.error);
  
  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    app.destroy();
  });
  
  // Expose for debugging
  (window as unknown as { zephyr: GrokZephyrApp }).zephyr = app;
}

// Start
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}

export default GrokZephyrApp;
