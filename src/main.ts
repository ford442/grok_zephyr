/**
 * Grok Zephyr - Main Entry Point
 * 
 * WebGPU-powered orbital simulation with 1M+ satellites.
 */

import { WebGPUContext, WebGPUError } from '@/core/WebGPUContext.js';
import { SatelliteGPUBuffer } from '@/core/SatelliteGPUBuffer.js';
import { RenderPipeline } from '@/render/RenderPipeline.js';
import { CameraController } from '@/camera/CameraController.js';
import { GroundObserverCamera, GroundObserverPreset } from '@/camera/GroundObserverCamera.js';
import { UIManager } from '@/ui/UIManager.js';
import { PerformanceProfiler } from '@/utils/PerformanceProfiler.js';
import { genSphere, extractFrustum } from '@/utils/math.js';
import { CONSTANTS, BUFFER_SIZES } from '@/types/constants.js';
import { TLELoader } from '@/data/TLELoader.js';

import './styles.css';

/**
 * Known CelesTrak group names for the ?tle= query param shorthand.
 * Usage: ?tle=starlink or ?tle=https://example.com/my-tles.txt
 */
const CELESTRAK_GROUPS: Record<string, string> = {
  starlink: 'starlink',
  oneweb: 'oneweb',
  iridium: 'iridium',
  'iridium-next': 'iridium-NEXT',
  gps: 'gps-ops',
  galileo: 'galileo',
  stations: 'stations',
  active: 'active',
};

/**
 * Main Application Class
 */
class GrokZephyrApp {
  private canvas: HTMLCanvasElement;
  private context: WebGPUContext | null = null;
  private buffers: SatelliteGPUBuffer | null = null;
  private pipeline: RenderPipeline | null = null;
  private camera: CameraController;
  private groundObserver: GroundObserverCamera;
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
    this.groundObserver = new GroundObserverCamera();
    this.ui = new UIManager();
    this.profiler = new PerformanceProfiler();
    
    // Setup callbacks
    this.setupCallbacks();
  }

  /** Current beam pattern mode (0=chaos, 1=GROK, 2=X logo) */
  private currentPatternMode = 1;

  /** Current animation pattern mode (0=none, 3=smile, 4=digital_rain, 5=heartbeat) */
  private currentAnimationPattern = 0;

  /** Current physics mode (0=simple, 1=keplerian, 2=J2) */
  private currentPhysicsMode = 0;

  /** Time scale for simulation (1.0 = real-time) */
  private timeScale: number = 1.0;

  /** Scaled simulation time (accumulated based on timeScale) */
  private simTime: number = 0.0;

  /**
   * Setup UI and camera callbacks
   */
  private setupCallbacks(): void {
    // Camera mode change updates UI + ground observer overlay
    this.camera.onModeChange((_mode, name, altitude) => {
      this.ui.setViewMode(name, altitude);
      this.ui.setActiveButton(this.camera.getViewModeIndex());
      this.updateGroundObserverOverlay();
    });

    // UI view change updates camera
    this.ui.onViewModeChange((index) => {
      this.camera.setViewMode(index);
    });

    // Stats update
    this.profiler.onStatsUpdate((stats) => {
      this.ui.updateStats(stats);
    });

    // Pattern button setup
    this.setupPatternButtons();
    
    // Animation pattern button setup
    this.setupAnimationPatternButtons();
    
    // Physics mode button setup
    this.setupPhysicsButtons();
    
    // Ground observer preset buttons
    this.setupGroundPresetButtons();
    
    // Time scale controls
    this.ui.createTimeScaleControl();
    this.ui.onTimeScaleChange((scale) => {
      this.setTimeScale(scale);
    });
    
    // Camera angle change updates UI
    this.camera.onAngleChange((yaw, pitch) => {
      this.updateAngleDisplay(yaw, pitch);
    });
    
    // Reset angle button
    const resetBtn = document.getElementById('resetAngle');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.camera.resetCameraAngle();
        this.updateAngleDisplay(0, 0);
      });
    }
  }

  /**
   * Setup ground observer preset selector buttons
   */
  private setupGroundPresetButtons(): void {
    const presetButtons = document.querySelectorAll('.preset-btn');
    presetButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.target as HTMLButtonElement;
        const preset = target.dataset.preset as GroundObserverPreset;
        if (!preset) return;

        this.groundObserver.setPreset(preset);

        // Update overlay class
        this.applyGroundOverlayClass(this.groundObserver.getOverlayClass());

        // Update active button
        presetButtons.forEach(b => b.classList.remove('active'));
        target.classList.add('active');
      });
    });
  }

  /**
   * Show or hide the ground observer overlay based on current camera mode
   */
  private updateGroundObserverOverlay(): void {
    const overlay = document.getElementById('ground-observer-overlay');
    const presetSelector = document.getElementById('ground-preset-selector');
    const isGround = this.camera.getViewMode() === 'ground';

    if (overlay) overlay.style.display = isGround ? 'block' : 'none';
    if (presetSelector) presetSelector.style.display = isGround ? 'flex' : 'none';

    if (isGround) {
      this.applyGroundOverlayClass(this.groundObserver.getOverlayClass());
    }
  }

  /**
   * Apply a preset's frame class to the overlay element
   */
  private applyGroundOverlayClass(overlayClass: string): void {
    const overlay = document.getElementById('ground-observer-overlay');
    if (!overlay) return;
    // Remove all frame-* classes then add the current one
    for (const cls of Array.from(overlay.classList)) {
      if (cls.startsWith('frame-')) overlay.classList.remove(cls);
    }
    overlay.classList.add(overlayClass);
  }
  
  /**
   * Update angle display in UI
   */
  private updateAngleDisplay(yaw: number, pitch: number): void {
    const angleInfo = document.getElementById('angleInfo');
    if (angleInfo) {
      angleInfo.textContent = `Yaw: ${yaw.toFixed(0)}° Pitch: ${pitch.toFixed(0)}°`;
    }
  }

  /**
   * Setup pattern switcher buttons
   */
  private setupPatternButtons(): void {
    const patternButtons = document.querySelectorAll('.pbtn');
    patternButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.target as HTMLButtonElement;
        const mode = parseInt(target.dataset.pattern || '1');
        this.setPatternMode(mode);
        
        // Update active state
        patternButtons.forEach(b => b.classList.remove('active'));
        target.classList.add('active');
      });
    });
  }

  /**
   * Resolve the TLE data source from the query string.
   *
   * Supports:
   *   ?tle=starlink       → CelesTrak Starlink group
   *   ?tle=oneweb         → CelesTrak OneWeb group
   *   ?tle=https://...    → arbitrary URL returning 3-line TLE text
   *
   * Returns null if no ?tle param is present (uses default procedural mode).
   */
  private getTLESource(): string | null {
    const params = new URLSearchParams(window.location.search);
    const tleParam = params.get('tle');
    if (!tleParam) return null;

    const lower = tleParam.toLowerCase();
    if (CELESTRAK_GROUPS[lower]) {
      return `https://celestrak.org/NORAD/elements/gp.php?GROUP=${CELESTRAK_GROUPS[lower]}&FORMAT=tle`;
    }

    // Treat as a direct URL if it starts with http(s)
    if (tleParam.startsWith('http://') || tleParam.startsWith('https://')) {
      return tleParam;
    }

    // Otherwise treat as a CelesTrak group name (best-effort)
    return `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(tleParam)}&FORMAT=tle`;
  }

  /**
   * Set beam pattern mode (0=chaos, 1=GROK, 2=X logo)
   */
  setPatternMode(mode: number): void {
    if (!this.context || !this.buffers) return;
    
    this.currentPatternMode = mode;
    
    // Update beam params uniform buffer
    const beamParamsData = new ArrayBuffer(16);
    const f32 = new Float32Array(beamParamsData);
    const u32 = new Uint32Array(beamParamsData);
    
    f32[0] = performance.now() / 1000;  // time
    u32[1] = mode;                       // patternMode
    u32[2] = 65536;                      // density
    u32[3] = 0;                          // padding
    
    this.context.writeBuffer(this.buffers.getBuffers().beamParams, beamParamsData);

    // For 𝕏 LOGO (mode 2), activate the logo satellite pattern via patternParams.
    // For any other beam pattern, clear any active satellite animation so logos
    // don't linger when the user switches back to CHAOS or GROK.
    const patternParamsData = new ArrayBuffer(16);
    const ppf32 = new Float32Array(patternParamsData);
    const ppu32 = new Uint32Array(patternParamsData);

    ppf32[0] = performance.now() / 1000;  // animation_time (start of reveal)
    ppu32[1] = mode === 2 ? 2 : 0;        // pattern_mode: 2=X LOGO, 0=none
    ppu32[2] = 0;
    ppu32[3] = 0;

    this.context.writeBuffer(this.buffers.getBuffers().patternParams, patternParamsData);
    
    const modeNames = ['CHAOS', 'GROK', '𝕏 LOGO'];
    console.log(`🔄 Beam pattern switched to: ${modeNames[mode]}`);
  }
  
  /**
   * Set animation pattern mode (3=smile, 4=digital_rain, 5=heartbeat)
   */
  setAnimationPattern(mode: number): void {
    if (!this.context || !this.buffers) return;

    // Toggle off if clicking the same pattern again
    if (this.currentAnimationPattern === mode) {
      mode = 0;
    }

    this.currentAnimationPattern = mode;

    // Update pattern params uniform buffer
    const patternParamsData = new ArrayBuffer(16);
    const f32 = new Float32Array(patternParamsData);
    const u32 = new Uint32Array(patternParamsData);

    f32[0] = performance.now() / 1000;  // animation time
    u32[1] = mode;                       // pattern mode
    u32[2] = 0;                          // seed
    u32[3] = 0;                          // padding

    this.context.writeBuffer(this.buffers.getBuffers().patternParams, patternParamsData);

    const modeNames = ['OFF', '', '', '😊 SMILE', '💧 DIGITAL RAIN', '💓 HEARTBEAT'];
    console.log(`🎭 Animation pattern: ${modeNames[mode]}`);
  }
  
  /**
   * Setup animation pattern buttons
   */
  private setupAnimationPatternButtons(): void {
    const animButtons = document.querySelectorAll('.anim-btn');
    animButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.target as HTMLButtonElement;
        const mode = parseInt(target.dataset.pattern || '3');
        this.setAnimationPattern(mode);
        
        // Update active state
        animButtons.forEach(b => b.classList.remove('active'));
        target.classList.add('active');
      });
    });
  }

  /**
   * Setup physics mode switcher buttons
   */
  private setupPhysicsButtons(): void {
    const physicsButtons = document.querySelectorAll('.physics-btn:not(.disabled)');
    physicsButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.target as HTMLButtonElement;
        const mode = parseInt(target.dataset.physics || '0');
        this.setPhysicsMode(mode);
        
        // Update active state
        physicsButtons.forEach(b => b.classList.remove('active'));
        target.classList.add('active');
      });
    });
  }

  /**
   * Set physics propagation mode (0=simple, 1=keplerian, 2=J2)
   */
  setPhysicsMode(mode: number): void {
    if (mode < 0 || mode > 2) {
      console.warn(`Invalid physics mode: ${mode}`);
      return;
    }
    
    this.currentPhysicsMode = mode;
    
    const modeNames = ['Simple (Circular)', 'Keplerian', 'J2 Perturbed'];
    const implemented = [true, true, false];
    
    console.log(`⚛️ Physics mode switched to: ${modeNames[mode]} ${implemented[mode] ? '' : '(placeholder)'}`);
    
    // TODO: Update GPU uniform or reinitialize orbital elements based on mode
    // For now, this is a UI-only change that affects future calculations
    // Full implementation would require:
    // 1. Updating the compute shader to use different propagation math
    // 2. Recomputing orbital elements with J2 perturbations if needed
    // 3. Updating CPU-side position calculations for camera tracking
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

      // Load orbital data: TLE if requested via query param, else procedural Walker
      const tleSource = this.getTLESource();
      let dataSourceLabel = 'Procedural Walker';
      let realTLECount = 0;

      if (tleSource) {
        try {
          console.log(`[GrokZephyr] Loading TLE data from: ${tleSource}`);
          const tles = await TLELoader.fromFile(tleSource);
          if (tles.length > 0) {
            realTLECount = this.buffers.loadFromTLEData(tles);
            dataSourceLabel = `TLE (${realTLECount.toLocaleString()} real)`;
            console.log(`[GrokZephyr] Loaded ${realTLECount} TLE satellites, padded to ${CONSTANTS.NUM_SATELLITES.toLocaleString()}`);
          } else {
            console.warn('[GrokZephyr] TLE source returned 0 records, falling back to procedural');
            this.buffers.generateOrbitalElements();
          }
        } catch (err) {
          console.warn('[GrokZephyr] TLE fetch/parse failed, falling back to procedural generation:', err);
          this.buffers.generateOrbitalElements();
        }
      } else {
        this.buffers.generateOrbitalElements();
      }
      this.buffers.uploadOrbitalElements();
      
      // Create Earth geometry
      this.createEarthGeometry();
      
      // Initialize render pipeline
      this.pipeline = new RenderPipeline(this.context, bufferSet);
      
      // Set initial canvas size and initialize pipeline
      const dpr = window.devicePixelRatio || 1;
      const width = Math.floor(this.canvas.clientWidth * dpr);
      const height = Math.floor(this.canvas.clientHeight * dpr);
      
      // Explicitly set canvas dimensions
      this.canvas.width = width;
      this.canvas.height = height;
      
      this.pipeline.initialize(width, height);
      this.buffers.updateBloomUniforms(width, height);
      
      // Update UI
      this.ui.setFleetCount(CONSTANTS.NUM_SATELLITES);
      this.ui.setDataSource(dataSourceLabel);
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
    
    // Explicitly set canvas dimensions
    this.canvas.width = width;
    this.canvas.height = height;
    
    this.context.resize(width, height);
    this.pipeline.resize(width, height);
    this.buffers.updateBloomUniforms(width, height);
  }

  /**
   * Calculate sun position in ECI frame for eclipse shadow calculation.
   * Sun orbits at 1 AU in the XY plane.
   */
  private calculateSunPosition(simTime: number): [number, number, number] {
    // Sun at 1 AU, rotating in XY plane
    // Angular frequency: 2π / (365.25 days in seconds)
    const SUN_DISTANCE_KM = 149597870.0;
    const ORBITAL_PERIOD_SEC = 31557600.0; // 365.25 days
    const angle = (simTime / ORBITAL_PERIOD_SEC) * Math.PI * 2;
    return [
      Math.cos(angle) * SUN_DISTANCE_KM,
      Math.sin(angle) * SUN_DISTANCE_KM,
      0.0
    ];
  }

  /**
   * Set time scale for simulation (1.0 = real-time).
   * @param scale - Time multiplier (clamped between 1 and 100000)
   */
  setTimeScale(scale: number): void {
    this.timeScale = Math.max(1, Math.min(100000, scale));
    console.log(`⏱️ Time scale: ${this.timeScale}x`);
  }

  /**
   * Get current time scale.
   * @returns Current time multiplier
   */
  getTimeScale(): number {
    return this.timeScale;
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
    
    // Calculate camera radius for ground view detection
    const cameraRadius = Math.sqrt(
      camera.position[0] * camera.position[0] +
      camera.position[1] * camera.position[1] +
      camera.position[2] * camera.position[2]
    );
    
    // Pack view_flags: view_mode (bits 0-15), is_ground_view (bit 16), physics_mode (bits 17-19)
    const viewMode = this.camera.getViewModeIndex();
    const isGroundView = cameraRadius < CONSTANTS.EARTH_RADIUS_KM + 100.0 ? 1 : 0;
    const physicsMode = this.currentPhysicsMode;
    const viewFlags = (viewMode & 0xFFFF) | ((isGroundView & 0x1) << 16) | ((physicsMode & 0x7) << 17);
    
    // Calculate sun position based on scaled simulation time
    const sunPos = this.calculateSunPosition(this.simTime);
    
    // Build uniform buffer (256 bytes)
    const uniformData = new ArrayBuffer(BUFFER_SIZES.UNIFORM);
    const f32 = new Float32Array(uniformData);
    const u32 = new Uint32Array(uniformData);
    
    // View-projection matrix (0-63) - f32[0-15]
    f32.set(viewProjection, 0);
    
    // Camera position (64-79) - f32[16-19]
    f32[16] = camera.position[0];
    f32[17] = camera.position[1];
    f32[18] = camera.position[2];
    f32[19] = 1.0;
    
    // Camera right (80-95) - f32[20-23]
    f32[20] = right[0];
    f32[21] = right[1];
    f32[22] = right[2];
    f32[23] = 0.0;
    
    // Camera up (96-111) - f32[24-27]
    f32[24] = up[0];
    f32[25] = up[1];
    f32[26] = up[2];
    f32[27] = 0.0;
    
    // Time (112-115) - f32[28]
    f32[28] = time;
    // Delta time (116-119) - f32[29]
    f32[29] = deltaTime;
    // View flags (120-123) - u32[30]
    u32[30] = viewFlags;
    // Sim time (124-127) - f32[31]
    f32[31] = this.simTime;
    
    // Frustum planes (128-223) - 6 planes * 4 floats each - f32[32-55]
    for (let p = 0; p < 6; p++) {
      f32[32 + p * 4 + 0] = frustum[p][0];
      f32[32 + p * 4 + 1] = frustum[p][1];
      f32[32 + p * 4 + 2] = frustum[p][2];
      f32[32 + p * 4 + 3] = frustum[p][3];
    }
    
    // Screen size (224-231) - f32[56-57]
    f32[56] = width;
    f32[57] = height;
    // Time scale (232-235) - f32[58]
    f32[58] = this.timeScale;
    // Padding (236-239) - u32[59]
    u32[59] = 0;
    
    // Sun position (240-255) - vec4f - f32[60-63]
    f32[60] = sunPos[0];
    f32[61] = sunPos[1];
    f32[62] = sunPos[2];
    f32[63] = 1.0; // w component
    
    // Write to GPU
    this.context.writeBuffer(this.buffers.getBuffers().uniforms, uniformData);
    
    // Update beam params time
    this.updateBeamParamsTime(time);
  }

  /**
   * Update beam params time for animation
   */
  private updateBeamParamsTime(time: number): void {
    if (!this.context || !this.buffers) return;
    
    const beamParamsData = new ArrayBuffer(16);
    const f32 = new Float32Array(beamParamsData);
    const u32 = new Uint32Array(beamParamsData);
    
    f32[0] = time;
    u32[1] = this.currentPatternMode;
    u32[2] = 65536;
    u32[3] = 0;
    
    this.context.writeBuffer(this.buffers.getBuffers().beamParams, beamParamsData);
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
    
    // Update scaled simulation time based on timeScale
    this.simTime += deltaTime * this.timeScale;
    
    // Update profiler
    this.profiler.beginFrame(timestamp);
    
    // Update ground observer parallax if in ground mode
    if (this.camera.getViewMode() === 'ground') {
      this.groundObserver.update();
    }
    
    // Write uniforms
    this.writeUniforms(time, deltaTime);
    
    // Create command encoder
    const encoder = this.context.createCommandEncoder('frame');
    
    // Pass 1: Compute orbital positions
    this.pipeline.encodeComputePass(encoder);

    // Pass 1.5: Compute beam positions
    this.pipeline.encodeBeamComputePass(encoder);

    // Note: Animation patterns (Smile, Digital Rain, Heartbeat) are rendered
    // directly in the satellite vertex shader via patternParams uniform.
    // No separate compute pass is needed.

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
    const { width: canvasWidth, height: canvasHeight } = this.context.getCanvasSize();
    this.pipeline.encodeCompositePass(encoder, outputView, canvasWidth, canvasHeight);
    
    // Submit
    this.context.submit([encoder.finish()]);
    
    // Update profiler
    const stats = this.profiler.endFrame(timestamp);
    if (stats) {
      // Estimate visible satellites (this is approximate)
      // In a full implementation, we'd use occlusion queries
      stats.visibleSatellites = this.estimateVisibleSatellites();
      // Update UI with modified stats
      this.ui.updateStats(stats);
      
      // Update simulation time display
      this.ui.updateSimTime(this.simTime);
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
    } else if (mode === 4) {
      // Moon view - can see most of the near-side constellation
      return Math.floor(CONSTANTS.NUM_SATELLITES * 0.45);
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
