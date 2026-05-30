/**
 * Grok Zephyr - Performance Dashboard
 * 
 * Displays real-time GPU timing, pass breakdowns, FPS sparkline,
 * and quality preset impact information.
 */

import type { PerformanceStats } from '@/types/index.js';
import type { QualityLevel } from '@/core/QualityPresets.js';
import { QUALITY_PRESETS } from '@/core/QualityPresets.js';
import type { PerformanceProfiler, DetailedTimings } from '@/utils/PerformanceProfiler.js';
import { MAX_FPS_HISTORY_LENGTH } from '@/utils/PerformanceProfiler.js';

/** Maximum FPS value for sparkline Y-axis scaling (typical high-performance target) */
const MAX_DISPLAY_FPS = 120;

/** Target FPS for headroom calculation (60 FPS baseline) */
const TARGET_FPS = 60;

/** Performance dashboard element references */
interface DashboardElements {
  container: HTMLElement;
  toggleBtn: HTMLButtonElement;
  panel: HTMLElement;
  fpsSparkline: SVGSVGElement;
  computeTime: HTMLElement;
  sceneTime: HTMLElement;
  bloomTime: HTMLElement;
  postTime: HTMLElement;
  totalTime: HTMLElement;
  presetLabel: HTMLElement;
  headroom: HTMLElement;
  timingSource: HTMLElement;
}

/**
 * Performance Dashboard
 * 
 * Shows real-time performance metrics in a collapsible panel:
 * - Per-pass GPU timings
 * - FPS history sparkline
 * - Current quality preset
 * - Estimated performance headroom
 * - GPU/CPU timing source indicator
 */
export class PerformanceDashboard {
  private elements: DashboardElements | null = null;
  private profiler: PerformanceProfiler;
  private isCollapsed = true;
  private maxFrameTime = 16.67; // 60 FPS baseline

  constructor(profiler: PerformanceProfiler) {
    this.profiler = profiler;
  }

  /**
   * Initialize the dashboard and create DOM elements
   */
  initialize(): void {
    this.createUI();
    this.setupEventListeners();
  }

  /**
   * Create dashboard HTML structure
   */
  private createUI(): void {
    // Create container
    const container = document.createElement('div');
    container.id = 'perf-dashboard';
    container.className = 'perf-dashboard';
    
    container.innerHTML = `
      <div class="perf-dashboard-toggle">
        <button id="perf-toggle" class="perf-toggle-btn" title="Toggle Performance Dashboard">
          ⚡ PERF
        </button>
      </div>
      
      <div class="perf-dashboard-panel" style="display: none;">
        <div class="perf-header">
          <div class="perf-title">PERFORMANCE</div>
          <button class="perf-close-btn" title="Close">×</button>
        </div>
        
        <div class="perf-content">
          <!-- FPS Sparkline -->
          <div class="perf-section">
            <div class="perf-section-title">FPS History</div>
            <svg id="perf-sparkline" class="perf-sparkline" width="180" height="40" preserveAspectRatio="none"></svg>
          </div>
          
          <!-- Current Metrics -->
          <div class="perf-section">
            <div class="perf-section-title">Pass Timings (ms)</div>
            <div class="perf-timing">
              <div class="perf-timing-row">
                <span class="perf-label">Compute</span>
                <span class="perf-value" id="perf-compute">--</span>
              </div>
              <div class="perf-timing-row">
                <span class="perf-label">Scene</span>
                <span class="perf-value" id="perf-scene">--</span>
              </div>
              <div class="perf-timing-row">
                <span class="perf-label">Bloom</span>
                <span class="perf-value" id="perf-bloom">--</span>
              </div>
              <div class="perf-timing-row">
                <span class="perf-label">Post-Process</span>
                <span class="perf-value" id="perf-post">--</span>
              </div>
              <div class="perf-timing-row perf-total">
                <span class="perf-label">Frame Total</span>
                <span class="perf-value" id="perf-total">--</span>
              </div>
            </div>
          </div>
          
          <!-- Quality Preset Info -->
          <div class="perf-section">
            <div class="perf-section-title">Quality Preset</div>
            <div class="perf-preset-info">
              <div class="perf-preset-label" id="perf-preset">HIGH</div>
              <div class="perf-preset-headroom" id="perf-headroom">--</div>
              <div class="perf-timing-source" id="perf-source">CPU Timing</div>
            </div>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(container);
    
    // Store element references
    this.elements = {
      container,
      toggleBtn: container.querySelector('#perf-toggle') as HTMLButtonElement,
      panel: container.querySelector('.perf-dashboard-panel') as HTMLElement,
      fpsSparkline: container.querySelector('#perf-sparkline') as SVGSVGElement,
      computeTime: container.querySelector('#perf-compute') as HTMLElement,
      sceneTime: container.querySelector('#perf-scene') as HTMLElement,
      bloomTime: container.querySelector('#perf-bloom') as HTMLElement,
      postTime: container.querySelector('#perf-post') as HTMLElement,
      totalTime: container.querySelector('#perf-total') as HTMLElement,
      presetLabel: container.querySelector('#perf-preset') as HTMLElement,
      headroom: container.querySelector('#perf-headroom') as HTMLElement,
      timingSource: container.querySelector('#perf-source') as HTMLElement,
    };
    
    // Update timing source indicator
    if (this.profiler.supportsTimestampQuery()) {
      this.elements.timingSource.textContent = 'GPU Timing';
      this.elements.timingSource.style.color = '#00ff88';
    } else {
      this.elements.timingSource.textContent = 'CPU Timing';
      this.elements.timingSource.style.color = '#ffaa00';
    }
  }

  /**
   * Setup event listeners for dashboard controls
   */
  private setupEventListeners(): void {
    if (!this.elements) return;
    
    // Toggle button
    this.elements.toggleBtn.addEventListener('click', () => {
      this.togglePanel();
    });
    
    // Close button
    const closeBtn = this.elements.container.querySelector('.perf-close-btn') as HTMLButtonElement;
    closeBtn?.addEventListener('click', () => {
      this.closePanel();
    });
  }

  /**
   * Toggle the dashboard panel visibility
   */
  private togglePanel(): void {
    if (!this.elements) return;
    
    this.isCollapsed = !this.isCollapsed;
    this.elements.panel.style.display = this.isCollapsed ? 'none' : 'block';
    
    // Update button appearance
    if (this.isCollapsed) {
      this.elements.toggleBtn.classList.remove('active');
    } else {
      this.elements.toggleBtn.classList.add('active');
    }
  }

  /**
   * Close the dashboard panel
   */
  private closePanel(): void {
    if (!this.elements) return;
    this.isCollapsed = true;
    this.elements.panel.style.display = 'none';
    this.elements.toggleBtn.classList.remove('active');
  }

  /**
   * Update dashboard with new performance stats
   */
  updateStats(stats: PerformanceStats): void {
    if (!this.elements) return;
    
    const timings: DetailedTimings = this.profiler.getDetailedTimings();
    
    // Update timing displays
    this.elements.computeTime.textContent = timings.compute.toFixed(2);
    this.elements.sceneTime.textContent = timings.scene.toFixed(2);
    this.elements.bloomTime.textContent = timings.bloom.toFixed(2);
    this.elements.postTime.textContent = timings.postProcess.toFixed(2);
    
    // Calculate frame total (average of all recorded frame times)
    const frameTime = stats.frameTime;
    this.elements.totalTime.textContent = frameTime.toFixed(2);
    
    // Update headroom indicator
    this.updateHeadroom(frameTime);
    
    // Update FPS sparkline
    this.updateSparkline();
  }

  /**
   * Update performance headroom indicator
   */
  private updateHeadroom(frameTime: number): void {
    if (!this.elements) return;
    
    // Calculate headroom as percentage of 60 FPS budget (16.67ms)
    const headroom = Math.max(0, ((this.maxFrameTime - frameTime) / this.maxFrameTime) * 100);
    const headroomText = headroom > 10 ? `${headroom.toFixed(0)}% headroom` : 'Low headroom';
    const color = headroom > 30 ? '#00ff88' : headroom > 15 ? '#ffff00' : '#ff6644';
    
    this.elements.headroom.textContent = headroomText;
    this.elements.headroom.style.color = color;
  }

  /**
   * Calculate SVG Y coordinate for a given FPS value
   */
  private calculateYPosition(fps: number, height: number, padding: number): number {
    const scaledFps = Math.min(fps, MAX_DISPLAY_FPS);
    return height - padding - (scaledFps / MAX_DISPLAY_FPS) * (height - padding * 2);
  }

  /**
   * Update FPS sparkline visualization
   */
  private updateSparkline(): void {
    if (!this.elements) return;
    
    const fpsHistory = this.profiler.getFPSHistory();
    if (fpsHistory.length === 0) return;
    
    const svg = this.elements.fpsSparkline;
    const width = 180;
    const height = 40;
    const padding = 2;
    
    // Clear previous paths
    svg.innerHTML = '';
    
    // Draw background grid (optional)
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', width.toString());
    bg.setAttribute('height', height.toString());
    bg.setAttribute('fill', 'rgba(0, 255, 136, 0.02)');
    svg.appendChild(bg);
    
    // Draw reference line at TARGET_FPS (60 FPS)
    const refLineY = this.calculateYPosition(TARGET_FPS, height, padding);
    const refLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    refLine.setAttribute('x1', '0');
    refLine.setAttribute('y1', refLineY.toString());
    refLine.setAttribute('x2', width.toString());
    refLine.setAttribute('y2', refLineY.toString());
    refLine.setAttribute('stroke', 'rgba(0, 255, 136, 0.2)');
    refLine.setAttribute('stroke-width', '0.5');
    refLine.setAttribute('stroke-dasharray', '2,2');
    svg.appendChild(refLine);
    
    // Create sparkline path
    const pointCount = Math.min(fpsHistory.length, MAX_FPS_HISTORY_LENGTH);
    const stepX = (width - padding * 2) / Math.max(1, pointCount - 1);
    
    let pathData = '';
    for (let i = 0; i < pointCount; i++) {
      const fps = fpsHistory[fpsHistory.length - pointCount + i];
      const x = padding + i * stepX;
      const y = this.calculateYPosition(fps, height, padding);
      
      if (i === 0) {
        pathData += `M ${x} ${y}`;
      } else {
        pathData += ` L ${x} ${y}`;
      }
    }
    
    // Draw area under sparkline with gradient effect (append first so it renders below)
    const areaPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    areaPath.setAttribute('d', `${pathData} L ${width - padding} ${height} L ${padding} ${height} Z`);
    areaPath.setAttribute('fill', 'rgba(0, 255, 136, 0.1)');
    svg.appendChild(areaPath);
    
    // Draw sparkline path on top
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    path.setAttribute('stroke', '#00ff88');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
  }

  /**
   * Update quality preset display and track transitions
   */
  updateQualityPreset(level: QualityLevel): void {
    if (!this.elements) return;
    
    const preset = QUALITY_PRESETS[level];
    this.elements.presetLabel.textContent = preset.label;
    
    
    // Add transition animation class for visual feedback
    const presetEl = this.elements.presetLabel;
    presetEl.classList.add('perf-preset-changing');
    setTimeout(() => {
      presetEl.classList.remove('perf-preset-changing');
    }, 600);
  }

  /**
   * Destroy and cleanup
   */
  destroy(): void {
    if (this.elements) {
      this.elements.container.remove();
      this.elements = null;
    }
  }
}

export default PerformanceDashboard;
