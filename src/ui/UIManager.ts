/**
 * Grok Zephyr - UI Manager
 * 
 * Handles HUD updates, stats display, control buttons, and animation controls.
 */

import type { PerformanceStats } from '@/types/index.js';
import type { AnimationPattern } from '@/types/animation.js';

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
  patternButtons: HTMLButtonElement[];
  animationButtons: HTMLButtonElement[];
  physicsButtons: HTMLButtonElement[];
  horizonIndicator: HTMLElement;
  angleInfo: HTMLElement;
  resetAngleBtn: HTMLElement;
  animationControls: HTMLElement;
  timeControls: HTMLElement;
  simTimeDisplay: HTMLElement;
  timeScaleSlider: HTMLInputElement;
  timeScaleValue: HTMLElement;
}

/** Animation control options */
export interface AnimationUIState {
  currentPattern: AnimationPattern;
  speed: number;
  isPlaying: boolean;
  loop: boolean;
}

/**
 * UI Manager
 * 
 * Manages all UI updates and interactions including:
 * - View mode buttons
 * - Beam pattern buttons
 * - Animation pattern buttons with speed/loop controls
 * - Physics mode buttons
 * - Stats display
 */
export class UIManager {
  private elements: UIElements;
  private onViewChangeCallback: ((index: number) => void) | null = null;
  private onPatternChangeCallback: ((mode: number) => void) | null = null;
  private onAnimationChangeCallback: ((pattern: AnimationPattern) => void) | null = null;
  private onPhysicsChangeCallback: ((mode: number) => void) | null = null;
  private onSpeedChangeCallback: ((speed: number) => void) | null = null;
  private onLoopToggleCallback: ((loop: boolean) => void) | null = null;
  
  private animationState: AnimationUIState = {
    currentPattern: 'grok',
    speed: 1.0,
    isPlaying: false,
    loop: true,
  };

  constructor() {
    this.elements = this.getElements();
    this.setupEventListeners();
    this.createAnimationControls();
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
        document.getElementById('btn4') as HTMLButtonElement,
      ],
      patternButtons: [
        document.getElementById('pbtn0') as HTMLButtonElement,
        document.getElementById('pbtn1') as HTMLButtonElement,
        document.getElementById('pbtn2') as HTMLButtonElement,
      ],
      animationButtons: [
        document.getElementById('anim3') as HTMLButtonElement,
        document.getElementById('anim4') as HTMLButtonElement,
        document.getElementById('anim5') as HTMLButtonElement,
      ],
      physicsButtons: [
        document.getElementById('phys0') as HTMLButtonElement,
        document.getElementById('phys1') as HTMLButtonElement,
        document.getElementById('phys2') as HTMLButtonElement,
      ],
      horizonIndicator: getEl('horizon-indicator'),
      angleInfo: getEl('angleInfo'),
      resetAngleBtn: getEl('resetAngle'),
      animationControls: getEl('animation-controls'),
    };
  }

  /**
   * Setup event listeners for controls
   */
  private setupEventListeners(): void {
    // View mode buttons
    this.elements.buttons.forEach((btn, index) => {
      btn?.addEventListener('click', () => {
        this.setActiveButton(index);
        if (this.onViewChangeCallback) {
          this.onViewChangeCallback(index);
        }
      });
    });

    // Pattern buttons (Chaos/Grok/X)
    this.elements.patternButtons.forEach((btn) => {
      btn?.addEventListener('click', (e) => {
        const target = e.target as HTMLButtonElement;
        const mode = parseInt(target.dataset.pattern || '1');
        this.setActivePatternButton(mode);
        if (this.onPatternChangeCallback) {
          this.onPatternChangeCallback(mode);
        }
      });
    });

    // Animation buttons (Smile/Matrix/Heartbeat)
    this.elements.animationButtons.forEach((btn) => {
      btn?.addEventListener('click', (e) => {
        const target = e.target as HTMLButtonElement;
        const patternIdx = parseInt(target.dataset.pattern || '3');
        const patternMap: Record<number, AnimationPattern> = {
          3: 'smile',
          4: 'rain',
          5: 'heartbeat',
        };
        const pattern = patternMap[patternIdx] || 'grok';
        
        this.setActiveAnimationButton(patternIdx);
        this.animationState.currentPattern = pattern;
        this.animationState.isPlaying = true;
        
        if (this.onAnimationChangeCallback) {
          this.onAnimationChangeCallback(pattern);
        }
      });
    });

    // Physics buttons
    this.elements.physicsButtons.forEach((btn) => {
      btn?.addEventListener('click', (e) => {
        const target = e.target as HTMLButtonElement;
        if (target.classList.contains('disabled')) return;
        
        const mode = parseInt(target.dataset.physics || '0');
        this.setActivePhysicsButton(mode);
        if (this.onPhysicsChangeCallback) {
          this.onPhysicsChangeCallback(mode);
        }
      });
    });
  }

  /**
   * Create additional animation controls (speed slider, loop toggle)
   */
  private createAnimationControls(): void {
    const container = document.createElement('div');
    container.className = 'animation-controls-extended';
    container.innerHTML = `
      <div class="anim-controls-row">
        <label>Speed:</label>
        <input type="range" id="animSpeed" min="0.25" max="4.0" step="0.25" value="1.0">
        <span id="animSpeedValue">1.0x</span>
      </div>
      <div class="anim-controls-row">
        <label>Loop:</label>
        <input type="checkbox" id="animLoop" checked>
      </div>
    `;
    
    this.elements.animationControls?.appendChild(container);
    
    // Setup controls
    const speedSlider = document.getElementById('animSpeed') as HTMLInputElement;
    const speedValue = document.getElementById('animSpeedValue');
    const loopCheckbox = document.getElementById('animLoop') as HTMLInputElement;
    
    speedSlider?.addEventListener('input', (e) => {
      const value = parseFloat((e.target as HTMLInputElement).value);
      this.animationState.speed = value;
      if (speedValue) speedValue.textContent = value.toFixed(2) + 'x';
      if (this.onSpeedChangeCallback) {
        this.onSpeedChangeCallback(value);
      }
    });
    
    loopCheckbox?.addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      this.animationState.loop = checked;
      if (this.onLoopToggleCallback) {
        this.onLoopToggleCallback(checked);
      }
    });
  }

  /**
   * Set the active view mode button
   */
  setActiveButton(index: number): void {
    this.elements.buttons.forEach((btn, i) => {
      btn?.classList.toggle('active', i === index);
    });
  }

  /**
   * Set the active pattern button
   */
  setActivePatternButton(mode: number): void {
    this.elements.patternButtons.forEach((btn) => {
      const btnMode = parseInt(btn?.dataset.pattern || '-1');
      btn?.classList.toggle('active', btnMode === mode);
    });
  }

  /**
   * Set the active animation button
   */
  setActiveAnimationButton(patternIdx: number): void {
    this.elements.animationButtons.forEach((btn) => {
      const btnPattern = parseInt(btn?.dataset.pattern || '-1');
      btn?.classList.toggle('active', btnPattern === patternIdx);
    });
  }

  /**
   * Set the active physics button
   */
  setActivePhysicsButton(mode: number): void {
    this.elements.physicsButtons.forEach((btn) => {
      const btnMode = parseInt(btn?.dataset.physics || '-1');
      btn?.classList.toggle('active', btnMode === mode);
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
    } else if (modeName === 'Moon View') {
      this.elements.horizonIndicator.style.display = 'block';
      this.elements.horizonIndicator.innerHTML = `
        <div>Earth-Moon Distance: 384,400 km</div>
        <div>Earth Radius: 6,371 km</div>
        <div>Orbit Altitude: 550 km</div>
        <div>View: Earth with Satellite Swarm</div>
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
   * Display the orbital data source (procedural or TLE)
   */
  setDataSource(label: string): void {
    let el = document.getElementById('s-datasrc');
    if (!el) {
      el = document.createElement('div');
      el.id = 's-datasrc';
      el.className = 'stat';
      this.elements.fleet.parentElement?.insertBefore(el, this.elements.fleet.nextSibling);
    }
    el.textContent = `Source   : ${label}`;
  }

  /**
   * Update animation UI state
   */
  setAnimationState(state: Partial<AnimationUIState>): void {
    this.animationState = { ...this.animationState, ...state };
    
    // Update UI elements
    const speedSlider = document.getElementById('animSpeed') as HTMLInputElement;
    const speedValue = document.getElementById('animSpeedValue');
    const loopCheckbox = document.getElementById('animLoop') as HTMLInputElement;
    
    if (speedSlider && state.speed !== undefined) {
      speedSlider.value = state.speed.toString();
      if (speedValue) speedValue.textContent = state.speed.toFixed(2) + 'x';
    }
    
    if (loopCheckbox && state.loop !== undefined) {
      loopCheckbox.checked = state.loop;
    }
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
    this.onViewChangeCallback = callback;
  }

  /**
   * Register pattern change callback
   */
  onPatternChange(callback: (mode: number) => void): void {
    this.onPatternChangeCallback = callback;
  }

  /**
   * Register animation pattern change callback
   */
  onAnimationChange(callback: (pattern: AnimationPattern) => void): void {
    this.onAnimationChangeCallback = callback;
  }

  /**
   * Register physics mode change callback
   */
  onPhysicsChange(callback: (mode: number) => void): void {
    this.onPhysicsChangeCallback = callback;
  }

  /**
   * Register animation speed change callback
   */
  onSpeedChange(callback: (speed: number) => void): void {
    this.onSpeedChangeCallback = callback;
  }

  /**
   * Register loop toggle callback
   */
  onLoopToggle(callback: (loop: boolean) => void): void {
    this.onLoopToggleCallback = callback;
  }

  // Time scale control properties
  private onTimeScaleChangeCallback: ((scale: number) => void) | null = null;
  private currentTimeScale: number = 1.0;
  private timePresets = [
    { label: '1x', value: 1 },
    { label: '1h/s', value: 3600 },
    { label: '1d/s', value: 86400 },
    { label: '1w/s', value: 604800 },
  ];

  /**
   * Create time scale control UI
   */
  createTimeScaleControl(): void {
    const container = document.createElement('div');
    container.id = 'time-controls';
    container.className = 'time-controls';
    
    container.innerHTML = `
      <div class="time-label">⏱ TIME SCALE</div>
      <div class="time-display" id="sim-time-display">Sim Time: 0h</div>
      <div class="time-slider-row">
        <input type="range" id="timeScaleSlider" min="0" max="4" step="0.1" value="0">
        <span id="timeScaleValue">1x</span>
      </div>
      <div class="time-presets">
        <button class="time-preset-btn active" data-scale="1">1x</button>
        <button class="time-preset-btn" data-scale="3600">1h/s</button>
        <button class="time-preset-btn" data-scale="86400">1d/s</button>
        <button class="time-preset-btn" data-scale="604800">1w/s</button>
      </div>
    `;
    
    // Insert after animation controls or at the end of body
    const animationControls = document.getElementById('animation-controls');
    if (animationControls && animationControls.parentElement) {
      animationControls.parentElement.insertBefore(container, animationControls.nextSibling);
    } else {
      document.body.appendChild(container);
    }
    
    // Store references
    this.elements.timeControls = container;
    this.elements.simTimeDisplay = document.getElementById('sim-time-display')!;
    this.elements.timeScaleSlider = document.getElementById('timeScaleSlider') as HTMLInputElement;
    this.elements.timeScaleValue = document.getElementById('timeScaleValue')!;
    
    // Setup slider event (logarithmic scale: 0->1, 1->10, 2->100, 3->1000, 4->10000)
    this.elements.timeScaleSlider.addEventListener('input', (e) => {
      const sliderValue = parseFloat((e.target as HTMLInputElement).value);
      const scale = Math.pow(10, sliderValue);
      this.setTimeScale(scale);
    });
    
    // Setup preset buttons
    const presetButtons = container.querySelectorAll('.time-preset-btn');
    presetButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.target as HTMLButtonElement;
        const scale = parseInt(target.dataset.scale || '1');
        this.setTimeScale(scale);
        
        // Update active state
        presetButtons.forEach(b => b.classList.remove('active'));
        target.classList.add('active');
      });
    });
    
    // Keyboard shortcuts (+/- to adjust speed)
    document.addEventListener('keydown', (e) => {
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        this.adjustTimeScale(1.5);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        this.adjustTimeScale(0.67);
      } else if (e.key === '0') {
        e.preventDefault();
        this.setTimeScale(1);
      }
    });
  }

  /**
   * Set time scale and update UI
   */
  private setTimeScale(scale: number): void {
    // Clamp to valid range (1 to 10000)
    this.currentTimeScale = Math.max(1, Math.min(10000, Math.round(scale)));
    
    // Update slider position (logarithmic)
    if (this.elements.timeScaleSlider) {
      const sliderValue = Math.log10(this.currentTimeScale);
      this.elements.timeScaleSlider.value = Math.max(0, Math.min(4, sliderValue)).toString();
    }
    
    // Update value display
    if (this.elements.timeScaleValue) {
      this.elements.timeScaleValue.textContent = this.formatTimeScale(this.currentTimeScale);
    }
    
    // Update preset button active state
    const presetButtons = document.querySelectorAll('.time-preset-btn');
    presetButtons.forEach((btn) => {
      const btnScale = parseInt((btn as HTMLButtonElement).dataset.scale || '0');
      btn.classList.toggle('active', btnScale === this.currentTimeScale);
    });
    
    // Notify callback
    if (this.onTimeScaleChangeCallback) {
      this.onTimeScaleChangeCallback(this.currentTimeScale);
    }
  }

  /**
   * Adjust time scale by a multiplier
   */
  private adjustTimeScale(multiplier: number): void {
    const newScale = this.currentTimeScale * multiplier;
    this.setTimeScale(newScale);
  }

  /**
   * Format time scale for display
   */
  private formatTimeScale(scale: number): string {
    if (scale >= 604800) {
      return `${(scale / 604800).toFixed(1)}w/s`;
    } else if (scale >= 86400) {
      return `${(scale / 86400).toFixed(1)}d/s`;
    } else if (scale >= 3600) {
      return `${(scale / 3600).toFixed(1)}h/s`;
    } else if (scale >= 60) {
      return `${(scale / 60).toFixed(1)}m/s`;
    } else {
      return `${Math.round(scale)}x`;
    }
  }

  /**
   * Update displayed simulation time
   */
  updateSimTime(simTime: number): void {
    if (this.elements.simTimeDisplay) {
      this.elements.simTimeDisplay.textContent = `Sim Time: ${this.formatSimTime(simTime)}`;
    }
  }

  /**
   * Format simulation time to human-readable string
   */
  private formatSimTime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 365) {
      const years = (days / 365.25).toFixed(1);
      return `Year ${years}`;
    } else if (days > 30) {
      const months = Math.floor(days / 30);
      const remDays = days % 30;
      return `${months}mo ${remDays}d`;
    } else if (days > 0) {
      return `Day ${days} ${hours}h`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${Math.floor(seconds / 60)}m`;
    }
  }

  /**
   * Register time scale change callback
   */
  onTimeScaleChange(callback: (scale: number) => void): void {
    this.onTimeScaleChangeCallback = callback;
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
        <button class="vbtn" id="btn4">MOON VIEW</button>
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
