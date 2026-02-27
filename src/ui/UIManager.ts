/**
 * Grok Zephyr - UI Manager
 * 
 * Handles HUD updates, stats display, and control buttons.
 */

import type { PerformanceStats } from '@/types/index.js';
import { VIEW_MODES } from '@/types/constants.js';

/** UI element references */
export interface UIElements {
  altitude: HTMLElement;
  fleet: HTMLElement;
  fps: HTMLElement;
  viewMode: HTMLElement;
  visible: HTMLElement;
  error: HTMLElement;
  controls: HTMLElement;
  buttons: HTMLButtonElement[];
  horizonIndicator: HTMLElement;
}

/**
 * UI Manager
 * 
 * Manages all UI updates and interactions.
 */
export class UIManager {
  private elements: UIElements;
  private onViewChange: ((index: number) => void) | null = null;

  constructor() {
    this.elements = this.getElements();
    this.setupEventListeners();
  }

  /**
   * Get references to UI elements
   */
  private getElements(): UIElements {
    const getEl = (id: string) => document.getElementById(id)!;
    
    return {
      altitude: getEl('s-alt'),
      fleet: getEl('s-fleet'),
      fps: getEl('s-fps'),
      viewMode: getEl('s-view'),
      visible: getEl('s-visible'),
      error: getEl('error'),
      controls: getEl('controls'),
      buttons: [
        document.getElementById('btn0') as HTMLButtonElement,
        document.getElementById('btn1') as HTMLButtonElement,
        document.getElementById('btn2') as HTMLButtonElement,
        document.getElementById('btn3') as HTMLButtonElement,
      ],
      horizonIndicator: getEl('horizon-indicator'),
    };
  }

  /**
   * Setup event listeners for controls
   */
  private setupEventListeners(): void {
    this.elements.buttons.forEach((btn, index) => {
      btn.addEventListener('click', () => {
        this.setActiveButton(index);
        if (this.onViewChange) {
          this.onViewChange(index);
        }
      });
    });
  }

  /**
   * Set the active view mode button
   */
  setActiveButton(index: number): void {
    this.elements.buttons.forEach((btn, i) => {
      btn.classList.toggle('active', i === index);
    });
  }

  /**
   * Update view mode display
   */
  setViewMode(modeName: string, altitude: string): void {
    this.elements.viewMode.textContent = `View     : ${modeName}`;
    this.elements.altitude.textContent = `Altitude : ${altitude} km`;
    
    // Show/hide horizon indicator and update content
    if (modeName === '720km Horizon') {
      this.elements.horizonIndicator.style.display = 'block';
      this.elements.horizonIndicator.innerHTML = `
        <div>Earth Radius: 6,371 km</div>
        <div>Orbit Altitude: 550 km</div>
        <div>Camera Altitude: 720 km</div>
        <div>Horizon Distance: ~2,970 km</div>
      `;
    } else if (modeName === 'Ground View') {
      this.elements.horizonIndicator.style.display = 'block';
      this.elements.horizonIndicator.innerHTML = `
        <div>Earth Radius: 6,371 km</div>
        <div>Orbit Altitude: 550 km</div>
        <div>Camera Altitude: 0 km (Surface)</div>
        <div>Zenith View: Starlink Constellation</div>
      `;
    } else {
      this.elements.horizonIndicator.style.display = 'none';
    }
  }

  /**
   * Update FPS display
   */
  setFPS(fps: number): void {
    this.elements.fps.textContent = `FPS      : ${fps}`;
  }

  /**
   * Update fleet count
   */
  setFleetCount(count: number): void {
    this.elements.fleet.textContent = `Fleet    : ${count.toLocaleString()}`;
  }

  /**
   * Update visible satellite count
   */
  setVisibleCount(count: number): void {
    this.elements.visible.textContent = `Visible  : ${count.toLocaleString()}`;
  }

  /**
   * Update all stats from performance data
   */
  updateStats(stats: PerformanceStats): void {
    this.setFPS(stats.fps);
    this.setVisibleCount(stats.visibleSatellites);
  }

  /**
   * Show error message
   */
  showError(message: string): void {
    this.elements.error.style.display = 'block';
    this.elements.error.innerHTML = `<b>WebGPU Error</b><br>${message}`;
  }

  /**
   * Hide error message
   */
  hideError(): void {
    this.elements.error.style.display = 'none';
  }

  /**
   * Register view change callback
   */
  onViewModeChange(callback: (index: number) => void): void {
    this.onViewChange = callback;
  }

  /**
   * Get button elements for external control
   */
  getButtons(): HTMLButtonElement[] {
    return this.elements.buttons;
  }

  /**
   * Create UI HTML structure
   * Call this if the HTML doesn't have the required elements
   */
  static createUI(): string {
    return `
      <div id="ui">
        <div class="title">◈ GROK ZEPHYR</div>
        <div class="stat" id="s-alt">Altitude : 720 km</div>
        <div class="stat" id="s-fleet">Fleet    : 1,048,576</div>
        <div class="stat" id="s-fps">FPS      : --</div>
        <div class="stat" id="s-view">View     : 720km Horizon</div>
        <div class="stat" id="s-visible">Visible  : --</div>
      </div>
      <div id="controls">
        <button class="vbtn active" id="btn0">720km HORIZON</button>
        <button class="vbtn" id="btn1">GOD VIEW</button>
        <button class="vbtn" id="btn2">FLEET POV</button>
        <button class="vbtn" id="btn3">GROUND VIEW</button>
      </div>
      <div id="horizon-indicator">
        <div>Earth Radius: 6,371 km</div>
        <div>Orbit Altitude: 550 km</div>
        <div>Camera Altitude: 720 km</div>
        <div>Horizon Distance: ~2,970 km</div>
      </div>
      <div id="error"></div>
    `;
  }
}

export default UIManager;
