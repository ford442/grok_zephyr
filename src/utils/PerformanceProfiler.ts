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
  startIndex: number;
  endIndex: number;
}

/** Detailed pass timing information */
export interface DetailedTimings {
  compute: number;
  cull: number;
  scene: number;
  bloom: number;
  postProcess: number;
}

export type GPUTimestampPass = 'orbital' | 'beam' | 'cull' | 'scene' | 'post';

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
  private pendingQueries = 0;

  // Pass timing
  private computeTimeHistory: MetricHistory;
  private renderTimeHistory: MetricHistory;
  private sceneTimeHistory: MetricHistory;
  private cullTimeHistory: MetricHistory;
  private bloomTimeHistory: MetricHistory;
  private postProcessTimeHistory: MetricHistory;

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

    // Create query set for 2 timestamps per frame (start/end)
    const querySet = this.device.createQuerySet({
      type: 'timestamp',
      count: 10,
    });

    const resolveBuffer = this.device.createBuffer({
      size: 10 * 8,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });

    this.timingQuery = {
      querySet,
      resolveBuffer,
      resultBuffer: null,
      startIndex: 0,
      endIndex: 1,
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

  private passTimestampIndex(pass: GPUTimestampPass): number {
    switch (pass) {
      case 'orbital':
        return 0;
      case 'beam':
        return 2;
      case 'cull':
        return 4;
      case 'scene':
        return 6;
      case 'post':
        return 8;
    }
  }

  beginGPUTimestamp(encoder: GPUCommandEncoder, pass: GPUTimestampPass): void {
    if (!this.timingQuery || !this.supportsGPUTiming) return;
    const index = this.passTimestampIndex(pass);
    (
      encoder as unknown as { writeTimestamp(set: GPUQuerySet, index: number): void }
    ).writeTimestamp(this.timingQuery.querySet, index);
  }

  endGPUTimestamp(encoder: GPUCommandEncoder, pass: GPUTimestampPass): void {
    if (!this.timingQuery || !this.supportsGPUTiming) return;
    const index = this.passTimestampIndex(pass) + 1;
    (
      encoder as unknown as { writeTimestamp(set: GPUQuerySet, index: number): void }
    ).writeTimestamp(this.timingQuery.querySet, index);
  }

  /**
   * @deprecated Use beginGPUTimestamp/endGPUTimestamp with a pass id.
   */
  beginGPUPass(encoder: GPUCommandEncoder, passType: 'compute' | 'render'): void {
    this.beginGPUTimestamp(encoder, passType === 'compute' ? 'orbital' : 'scene');
  }

  /**
   * @deprecated Use beginGPUTimestamp/endGPUTimestamp with a pass id.
   */
  endGPUPass(encoder: GPUCommandEncoder, passType: 'compute' | 'render'): void {
    this.endGPUTimestamp(encoder, passType === 'compute' ? 'orbital' : 'scene');
  }

  resolveTimestamps(encoder: GPUCommandEncoder): void {
    if (!this.timingQuery || !this.supportsGPUTiming) return;

    encoder.resolveQuerySet(this.timingQuery.querySet, 0, 10, this.timingQuery.resolveBuffer, 0);

    if (!this.timingQuery.resultBuffer) {
      this.timingQuery.resultBuffer = this.device!.createBuffer({
        size: 10 * 8,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
    }

    encoder.copyBufferToBuffer(
      this.timingQuery.resolveBuffer,
      0,
      this.timingQuery.resultBuffer,
      0,
      10 * 8,
    );

    this.pendingQueries++;
  }

  async readbackTimestamps(): Promise<void> {
    if (!this.timingQuery?.resultBuffer || this.pendingQueries === 0) return;

    const buffer = this.timingQuery.resultBuffer;

    await buffer.mapAsync(GPUMapMode.READ);
    const data = new BigInt64Array(buffer.getMappedRange());

    const toMs = (start: number, end: number): number =>
      Number(data[end] - data[start]) / 1_000_000;

    const orbital = toMs(0, 1);
    const beam = toMs(2, 3);
    const cull = toMs(4, 5);
    const scene = toMs(6, 7);
    const post = toMs(8, 9);

    buffer.unmap();

    const record = (history: MetricHistory, value: number): void => {
      if (value > 0 && value < 1000) this.addToHistory(history, value);
    };

    record(this.computeTimeHistory, orbital + beam);
    record(this.cullTimeHistory, cull);
    record(this.sceneTimeHistory, scene);
    record(this.postProcessTimeHistory, post);
    record(this.renderTimeHistory, scene + post);

    this.pendingQueries--;
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
    this.visibleSatellites = 0;
  }

  /**
   * Destroy and cleanup
   */
  destroy(): void {
    if (this.timingQuery) {
      this.timingQuery.querySet.destroy();
      this.timingQuery.resolveBuffer.destroy();
      this.timingQuery.resultBuffer?.destroy();
      this.timingQuery = null;
    }
    this.device = null;
  }
}
