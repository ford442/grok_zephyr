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

/** Performance profiler options */
export interface PerformanceProfilerOptions {
  /** Enable GPU timestamp queries */
  enableGPUTiming: boolean;
  /** History size for moving averages */
  historySize: number;
  /** FPS update interval in seconds */
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
  }

  /**
   * Initialize GPU timing support
   */
  async initialize(device: GPUDevice): Promise<void> {
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
    
    console.log(`[PerformanceProfiler] GPU timing: ${this.supportsGPUTiming ? 'enabled' : 'disabled'}`);
  }

  /**
   * Initialize GPU timestamp queries
   */
  private initializeGPUTiming(): void {
    if (!this.device) return;
    
    // Create query set for 2 timestamps per frame (start/end)
    const querySet = this.device.createQuerySet({
      type: 'timestamp',
      count: 4, // 2 for compute, 2 for render
    });
    
    // Create resolve buffer
    const resolveBuffer = this.device.createBuffer({
      size: 4 * 8, // 4 timestamps * 8 bytes each
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
    const frameTimeMs = (timestamp - this.lastFrameTime);
    
    // Update frame time history
    this.addToHistory(this.frameTimeHistory, frameTimeMs);
    
    // Update FPS
    this.frameCount++;
    const elapsed = now - this.lastFpsTime;
    
    if (elapsed >= this.options.fpsUpdateInterval) {
      this.currentFps = Math.round(this.frameCount / elapsed);
      this.frameCount = 0;
      this.lastFpsTime = now;
      
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
   * Begin GPU timing for a pass
   */
  beginGPUPass(encoder: GPUCommandEncoder, passType: 'compute' | 'render'): void {
    if (!this.timingQuery || !this.supportsGPUTiming) return;
    
    const index = passType === 'compute' ? 0 : 2;
    encoder.writeTimestamp(this.timingQuery.querySet, index);
  }

  /**
   * End GPU timing for a pass
   */
  endGPUPass(encoder: GPUCommandEncoder, passType: 'compute' | 'render'): void {
    if (!this.timingQuery || !this.supportsGPUTiming) return;
    
    const index = passType === 'compute' ? 1 : 3;
    encoder.writeTimestamp(this.timingQuery.querySet, index);
  }

  /**
   * Resolve GPU timestamps
   */
  resolveTimestamps(encoder: GPUCommandEncoder): void {
    if (!this.timingQuery || !this.supportsGPUTiming) return;
    
    encoder.resolveQuerySet(
      this.timingQuery.querySet,
      0,
      4,
      this.timingQuery.resolveBuffer,
      0
    );
    
    // Create result buffer if needed
    if (!this.timingQuery.resultBuffer) {
      this.timingQuery.resultBuffer = this.device!.createBuffer({
        size: 4 * 8,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
    }
    
    encoder.copyBufferToBuffer(
      this.timingQuery.resolveBuffer,
      0,
      this.timingQuery.resultBuffer,
      0,
      4 * 8
    );
    
    this.pendingQueries++;
  }

  /**
   * Read back GPU timing results
   */
  async readbackTimestamps(): Promise<void> {
    if (!this.timingQuery?.resultBuffer || this.pendingQueries === 0) return;
    
    const buffer = this.timingQuery.resultBuffer;
    
    await buffer.mapAsync(GPUMapMode.READ);
    const data = new BigInt64Array(buffer.getMappedRange());
    
    // Convert nanoseconds to milliseconds
    const computeTime = Number(data[1] - data[0]) / 1_000_000;
    const renderTime = Number(data[3] - data[2]) / 1_000_000;
    
    buffer.unmap();
    
    if (computeTime > 0 && computeTime < 1000) {
      this.addToHistory(this.computeTimeHistory, computeTime);
    }
    if (renderTime > 0 && renderTime < 1000) {
      this.addToHistory(this.renderTimeHistory, renderTime);
    }
    
    this.pendingQueries--;
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
    this.frameTimeHistory = this.createHistory(this.options.historySize);
    this.computeTimeHistory = this.createHistory(this.options.historySize);
    this.renderTimeHistory = this.createHistory(this.options.historySize);
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

/**
 * Simple FPS counter for basic usage
 */
export class FPSCounter {
  private frameCount = 0;
  private lastTime = 0;
  private currentFps = 0;
  private callback: ((fps: number) => void) | null = null;
  private interval: number;

  constructor(interval = 0.5) {
    this.interval = interval;
  }

  onUpdate(callback: (fps: number) => void): void {
    this.callback = callback;
  }

  tick(timestamp: number): number {
    const now = timestamp * 0.001;
    this.frameCount++;
    
    const elapsed = now - this.lastTime;
    if (elapsed >= this.interval) {
      this.currentFps = Math.round(this.frameCount / elapsed);
      this.frameCount = 0;
      this.lastTime = now;
      
      if (this.callback) {
        this.callback(this.currentFps);
      }
    }
    
    return this.currentFps;
  }

  getFPS(): number {
    return this.currentFps;
  }

  reset(): void {
    this.frameCount = 0;
    this.lastTime = 0;
    this.currentFps = 0;
  }
}

export default PerformanceProfiler;
