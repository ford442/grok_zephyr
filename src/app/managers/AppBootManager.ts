
import { GrokZephyrApp } from '@/app/GrokZephyrApp.js';
import { WebGPUContext } from '@/core/WebGPUContext.js';
import { SatelliteGPUBuffer } from '@/core/SatelliteGPUBuffer.js';
import { FocusManager } from '@/focus.js';
import { TLELoader } from '@/data/TLELoader.js';
import { CONSTANTS } from '@/types/constants.js';

export class AppBootManager {
  constructor(private app: GrokZephyrApp) {}

  public async initialize(): Promise<void> {
    try {
      console.log('[GrokZephyr] Initializing...');

      this.app.context = new WebGPUContext(this.app.canvas);
      const { device } = await this.app.context.initialize();

      await this.app.profiler.initialize(device);

      this.app.camera.attachToCanvas(this.app.canvas);

      this.app.buffers = new SatelliteGPUBuffer(this.app.context);
      this.app.buffers.initialize();

      this.app.focusManager = new FocusManager(
        this.app.canvas,
        this.app.camera,
        this.app.buffers,
        (selection) => this.app.handleFocusSelectionChange(selection)
      );

      const tleSource = this.app.appInitializer.getTLESource();
      let dataSourceLabel = 'Procedural Walker';
      let realTLECount = 0;

      if (tleSource) {
        try {
          console.log(`[GrokZephyr] Loading TLE data from: ${tleSource}`);
          const tles = await TLELoader.fromFile(tleSource);
          if (tles.length > 0) {
            realTLECount = this.app.buffers.loadFromTLEData(tles);
            dataSourceLabel = `TLE (${realTLECount.toLocaleString()} real)`;
            console.log(`[GrokZephyr] Loaded ${realTLECount} TLE satellites, padded to ${CONSTANTS.NUM_SATELLITES.toLocaleString()}`);
          } else {
            console.warn('[GrokZephyr] TLE source returned 0 records, falling back to procedural');
            this.app.buffers.generateOrbitalElements();
          }
        } catch (err) {
          console.warn('[GrokZephyr] TLE fetch/parse failed, falling back to procedural generation:', err);
          this.app.buffers.generateOrbitalElements();
        }
      } else {
        this.app.buffers.generateOrbitalElements();
      }
      this.app.buffers.uploadOrbitalElements();

      this.app.ui.setDataSourceLabel(dataSourceLabel);

      await this.app.appPipelineManager.setupPipeline();

      const initialState = this.app.appInitializer.parseInitialStateFromURL();
      const initialQuality = initialState.quality as any ??
        (this.app.isMobileDevice ? this.app.mobileDefaultQuality : 'high');

      this.app.appQualityManager.applyQualityPreset(initialQuality);
      this.app.appQualityManager.applyExposureSettings();

      if (initialState.cameraIndex >= 0) {
        this.app.camera.setViewMode(initialState.cameraIndex);
        if (initialState.cameraIndex === 0 && initialState.groundAltitude > 0) {
          this.app.camera.setGroundAltitude(initialState.groundAltitude);
        }
      }

      this.app.appRenderLoop.start();

      this.app.ui.hideLoading();
      this.app.audio.playClick();

      console.log('[GrokZephyr] Ready!');
    } catch (e) {
      this.app.handleError(e);
    }
  }
}
