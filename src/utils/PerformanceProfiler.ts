/**
 * Grok Zephyr - Performance Profiler
 *
 * Tracks GPU and CPU performance metrics including:
 * - FPS with moving average
 * - Frame time
 * - GPU memory usage
 * - Compute and render pass timing
 */

import type { PerformanceStats } from '@/types/index.js';
import { UI } from '@/types/constants.js';
import { setPassTimestampScope, type PassTimestampWrites } from '@/render/passes/passTimestamps.js';

/** Maximum FPS history entries for sparkline visualization */
export const MAX_FPS_HISTORY_LENGTH = 120;

/** Performance metric history entry */
interface MetricHistory {
  values: number[];
  maxSize: number;
  sum: number;
}

/** GPU timing query pair */
interface GPUTimingQuery {
  querySet: GPUQuerySet;
  resolveBuffer: GPUBuffer;
  resultBuffer: GPUBuffer | null;
}

/** Detailed pass timing information */
export interface DetailedTimings {
  compute: number;
  cull: number;
  scene: number;
  bloom: number;
  postProcess: number;
  /** Close-approach bin + pair compute. 0 when the feature is off. */
  conjunction: number;
}

export type GPUTimestampPass =
  'orbital' | 'beam' | 'cull' | 'scene' | 'bloom' | 'post' | 'conjunction';

/** Passes timed per frame; extra passes in a frame simply go unmeasured. */
const MAX_TIMED_PASSES = 64;
/** Two timestamps (beginning/end of pass) per timed pass. */
const GPU_TIMESTAMP_COUNT = MAX_TIMED_PASSES * 2;

/** Options for configuring the PerformanceProfiler */
export interface PerformanceProfilerOptions {
  enableGPUTiming: boolean;
  historySize: number;
  fpsUpdateInterval: number;
}

/**
 * Performance Profiler
 *
 * Monitors simulation performance with:
 * - CPU-side FPS calculation
 * - GPU timestamp queries (if supported)
 * - Memory usage tracking
 * - Moving average smoothing
 */
export class PerformanceProfiler {
  private options: PerformanceProfilerOptions;

  // FPS tracking
  private frameCount = 0;
  private lastFpsTime = 0;
  private currentFps = 0;
  private fpsHistory: number[] = [];

  // Frame timing
  private lastFrameTime = 0;
  private frameTimeHistory: MetricHistory;

  // GPU timing
  private device: GPUDevice | null = null;
  private supportsGPUTiming = false;
  private timingQuery: GPUTimingQuery | null = null;
  /** Owner of each timed pass encoded so far this frame (pair index = position). */
  private frameOwners: GPUTimestampPass[] = [];
  /** Owners of the frame whose timestamps are being copied/read back. */
  private pendingOwners: GPUTimestampPass[] | null = null;

  // Pass timing
  private computeTimeHistory: MetricHistory;
  private renderTimeHistory: MetricHistory;
  private sceneTimeHistory: MetricHistory;
  private cullTimeHistory: MetricHistory;
  private bloomTimeHistory: MetricHistory;
  private postProcessTimeHistory: MetricHistory;
  private conjunctionTimeHistory: MetricHistory;

  // Stats
  private visibleSatellites = 0;
  private gpuMemoryMB = 0;

  // Callbacks
  private statsCallback: ((stats: PerformanceStats) => void) | null = null;

  constructor(options: Partial<PerformanceProfilerOptions> = {}) {
    this.options = {
      enableGPUTiming: true,
      historySize: 60,
      fpsUpdateInterval: UI.FPS_UPDATE_INTERVAL,
      ...options,
    };

    this.frameTimeHistory = this.createHistory(this.options.historySize);
    this.computeTimeHistory = this.createHistory(this.options.historySize);
    this.renderTimeHistory = this.createHistory(this.options.historySize);
    this.sceneTimeHistory = this.createHistory(this.options.historySize);
    this.cullTimeHistory = this.createHistory(this.options.historySize);
    this.bloomTimeHistory = this.createHistory(this.options.historySize);
    this.postProcessTimeHistory = this.createHistory(this.options.historySize);
    this.conjunctionTimeHistory = this.createHistory(this.options.historySize);
  }

  /**
   * Initialize GPU timing support
   */
  initialize(device: GPUDevice): void {
    this.device = device;

    // Check for timestamp query support on the device (not just adapter)
    // The feature must be enabled when creating the device
    this.supportsGPUTiming = device.features.has('timestamp-query');

    if (this.supportsGPUTiming && this.options.enableGPUTiming) {
      try {
        this.initializeGPUTiming();
      } catch (error) {
        console.warn('[PerformanceProfiler] Failed to initialize GPU timing:', error);
        this.supportsGPUTiming = false;
      }
    }

    console.log(
      `[PerformanceProfiler] GPU timing: ${this.supportsGPUTiming ? 'enabled' : 'disabled'}`,
    );
  }

  /**
   * Initialize GPU timestamp queries
   */
  private initializeGPUTiming(): void {
    if (!this.device) return;

    // Beginning/end-of-pass timestamps for up to MAX_TIMED_PASSES passes per frame
    const querySet = this.device.createQuerySet({
      type: 'timestamp',
      count: GPU_TIMESTAMP_COUNT,
    });

    const resolveBuffer = this.device.createBuffer({
      size: GPU_TIMESTAMP_COUNT * 8,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });

    this.timingQuery = {
      querySet,
      resolveBuffer,
      resultBuffer: null,
    };
  }

  /**
   * Begin frame timing
   */
  beginFrame(timestamp: number): void {
    this.lastFrameTime = timestamp;
  }

  /**
   * End frame timing and calculate FPS
   */
  endFrame(timestamp: number): PerformanceStats | null {
    const now = timestamp * 0.001; // Convert to seconds
    const frameTimeMs = timestamp - this.lastFrameTime;

    // Update frame time history
    this.addToHistory(this.frameTimeHistory, frameTimeMs);

    // Update FPS
    this.frameCount++;
    const elapsed = now - this.lastFpsTime;

    if (elapsed >= this.options.fpsUpdateInterval) {
      this.currentFps = Math.round(this.frameCount / elapsed);
      this.frameCount = 0;
      this.lastFpsTime = now;

      // Add FPS to history (keep last entries for sparkline)
      this.fpsHistory.push(this.currentFps);
      if (this.fpsHistory.length > MAX_FPS_HISTORY_LENGTH) {
        this.fpsHistory.shift();
      }

      // Update GPU memory if available
      this.updateGPUMemory();

      // Create stats object
      const stats: PerformanceStats = {
        fps: this.currentFps,
        frameTime: this.getAverage(this.frameTimeHistory),
        gpuMemoryMB: this.gpuMemoryMB,
        visibleSatellites: this.visibleSatellites,
        computeTime: this.getAverage(this.computeTimeHistory),
        renderTime: this.getAverage(this.renderTimeHistory),
      };

      // Notify callback
      if (this.statsCallback) {
        this.statsCallback(stats);
      }

      return stats;
    }

    return null;
  }

  /**
   * Record compute pass timing
   */
  recordComputeTime(timeMs: number): void {
    this.addToHistory(this.computeTimeHistory, timeMs);
  }

  /**
   * Record render pass timing
   */
  recordRenderTime(timeMs: number): void {
    this.addToHistory(this.renderTimeHistory, timeMs);
  }

  recordCullTime(timeMs: number): void {
    this.addToHistory(this.cullTimeHistory, timeMs);
  }

  /**
   * Record scene pass timing
   */
  recordSceneTime(timeMs: number): void {
    this.addToHistory(this.sceneTimeHistory, timeMs);
  }

  /**
   * Record bloom pass timing
   */
  recordBloomTime(timeMs: number): void {
    this.addToHistory(this.bloomTimeHistory, timeMs);
  }

  /**
   * Record post-process pass timing
   */
  recordPostProcessTime(timeMs: number): void {
    this.addToHistory(this.postProcessTimeHistory, timeMs);
  }

  /**
   * Update visible satellite count
   */
  setVisibleSatellites(count: number): void {
    this.visibleSatellites = count;
  }

  /**
   * Set GPU memory usage
   */
  setGPUMemoryMB(mb: number): void {
    this.gpuMemoryMB = mb;
  }

  /**
   * Register stats update callback
   */
  onStatsUpdate(callback: (stats: PerformanceStats) => void): void {
    this.statsCallback = callback;
  }

  /**
   * Get current stats snapshot
   */
  getStats(): PerformanceStats {
    return {
      fps: this.currentFps,
      frameTime: this.getAverage(this.frameTimeHistory),
      gpuMemoryMB: this.gpuMemoryMB,
      visibleSatellites: this.visibleSatellites,
      computeTime: this.getAverage(this.computeTimeHistory),
      renderTime: this.getAverage(this.renderTimeHistory),
    };
  }

  /**
   * Get detailed pass timings for dashboard
   */
  getDetailedTimings(): DetailedTimings {
    return {
      compute: this.getAverage(this.computeTimeHistory),
      cull: this.getAverage(this.cullTimeHistory),
      scene: this.getAverage(this.sceneTimeHistory),
      bloom: this.getAverage(this.bloomTimeHistory),
      postProcess: this.getAverage(this.postProcessTimeHistory),
      conjunction: this.getAverage(this.conjunctionTimeHistory),
    };
  }

  /**
   * Get FPS history for sparkline visualization
   */
  getFPSHistory(): number[] {
    return [...this.fpsHistory];
  }

  /**
   * Get supports GPU timing flag
   */
  supportsTimestampQuery(): boolean {
    return this.supportsGPUTiming;
  }

  /**
   * Open a timing scope. Every pass begun until {@link endGPUTimestamp} takes
   * its `timestampWrites` from the scope (see `passTimestampWrites`), and the
   * scope's passes are summed on readback.
   */
  beginGPUTimestamp(pass: GPUTimestampPass): void {
    if (!this.timingQuery || !this.supportsGPUTiming) return;
    setPassTimestampScope(() => this.allocatePassTimestamps(pass));
  }

  endGPUTimestamp(_pass: GPUTimestampPass): void {
    setPassTimestampScope(null);
  }

  private allocatePassTimestamps(pass: GPUTimestampPass): PassTimestampWrites | undefined {
    const query = this.timingQuery;
    if (!query || this.frameOwners.length >= MAX_TIMED_PASSES) return undefined;
    const begin = this.frameOwners.length * 2;
    this.frameOwners.push(pass);
    return {
      querySet: query.querySet,
      beginningOfPassWriteIndex: begin,
      endOfPassWriteIndex: begin + 1,
    };
  }

  resolveTimestamps(encoder: GPUCommandEncoder): void {
    setPassTimestampScope(null);
    const owners = this.frameOwners;
    this.frameOwners = [];
    if (!this.timingQuery || !this.supportsGPUTiming || owners.length === 0) return;
    // One readback at a time: a mapped or mapping result buffer cannot be a
    // copy destination, so frames that land mid-readback go unmeasured.
    if (this.pendingOwners) return;

    const count = owners.length * 2;
    encoder.resolveQuerySet(this.timingQuery.querySet, 0, count, this.timingQuery.resolveBuffer, 0);

    if (!this.timingQuery.resultBuffer) {
      this.timingQuery.resultBuffer = this.device!.createBuffer({
        size: GPU_TIMESTAMP_COUNT * 8,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
    }

    encoder.copyBufferToBuffer(
      this.timingQuery.resolveBuffer,
      0,
      this.timingQuery.resultBuffer,
      0,
      count * 8,
    );

    this.pendingOwners = owners;
  }

  async readbackTimestamps(): Promise<void> {
    const buffer = this.timingQuery?.resultBuffer;
    const owners = this.pendingOwners;
    if (!buffer || !owners || buffer.mapState !== 'unmapped') return;

    try {
      await buffer.mapAsync(GPUMapMode.READ);
    } catch {
      this.pendingOwners = null;
      return;
    }
    const data = new BigInt64Array(buffer.getMappedRange(), 0, owners.length * 2);

    const totals: Record<GPUTimestampPass, number> = {
      orbital: 0,
      beam: 0,
      cull: 0,
      scene: 0,
      bloom: 0,
      post: 0,
      conjunction: 0,
    };
    owners.forEach((pass, i) => {
      const delta = data[i * 2 + 1] - data[i * 2];
      // Timestamps are allowed to be non-monotonic (e.g. across power states).
      if (delta > 0n) totals[pass] += Number(delta) / 1_000_000;
    });

    buffer.unmap();
    this.pendingOwners = null;

    const record = (history: MetricHistory, value: number): void => {
      if (value > 0 && value < 1000) this.addToHistory(history, value);
    };

    record(this.computeTimeHistory, totals.orbital + totals.beam);
    record(this.cullTimeHistory, totals.cull);
    record(this.sceneTimeHistory, totals.scene);
    record(this.bloomTimeHistory, totals.bloom);
    record(this.postProcessTimeHistory, totals.post);
    // Zero on any frame the close-approach pass was skipped, which is what
    // makes "off costs nothing" measurable rather than asserted.
    record(this.conjunctionTimeHistory, totals.conjunction);
    record(this.renderTimeHistory, totals.scene + totals.bloom + totals.post);
  }

  hasGpuTimings(): boolean {
    return this.supportsGPUTiming;
  }

  /**
   * Update GPU memory from performance API (if available)
   */
  private updateGPUMemory(): void {
    // Check for WebGPU memory info extension
    const perf = performance as Performance & {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number };
    };

    if (perf.memory) {
      // This is JavaScript heap, not GPU memory, but useful as reference
      const jsHeapMB = perf.memory.usedJSHeapSize / 1024 / 1024;
      this.gpuMemoryMB = Math.max(this.gpuMemoryMB, jsHeapMB);
    }
  }

  /**
   * Create a metric history buffer
   */
  private createHistory(maxSize: number): MetricHistory {
    return {
      values: [],
      maxSize,
      sum: 0,
    };
  }

  /**
   * Add value to history with moving average
   */
  private addToHistory(history: MetricHistory, value: number): void {
    // Remove oldest if at capacity
    if (history.values.length >= history.maxSize) {
      history.sum -= history.values.shift()!;
    }

    history.values.push(value);
    history.sum += value;
  }

  /**
   * Get average from history
   */
  private getAverage(history: MetricHistory): number {
    if (history.values.length === 0) return 0;
    return history.sum / history.values.length;
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.frameCount = 0;
    this.lastFpsTime = 0;
    this.currentFps = 0;
    this.fpsHistory = [];
    this.frameTimeHistory = this.createHistory(this.options.historySize);
    this.computeTimeHistory = this.createHistory(this.options.historySize);
    this.renderTimeHistory = this.createHistory(this.options.historySize);
    this.sceneTimeHistory = this.createHistory(this.options.historySize);
    this.cullTimeHistory = this.createHistory(this.options.historySize);
    this.bloomTimeHistory = this.createHistory(this.options.historySize);
    this.postProcessTimeHistory = this.createHistory(this.options.historySize);
    this.conjunctionTimeHistory = this.createHistory(this.options.historySize);
    this.visibleSatellites = 0;
  }

  /**
   * Destroy and cleanup
   */
  destroy(): void {
    setPassTimestampScope(null);
    this.frameOwners = [];
    this.pendingOwners = null;
    if (this.timingQuery) {
      this.timingQuery.querySet.destroy();
      this.timingQuery.resolveBuffer.destroy();
      this.timingQuery.resultBuffer?.destroy();
      this.timingQuery = null;
    }
    this.device = null;
  }
}
