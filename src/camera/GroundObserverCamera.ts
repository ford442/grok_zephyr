/**
 * Ground Observer Camera System
 * 
 * Provides immersive ground-based perspectives for viewing Sky Strips.
 * Each preset simulates a different real-world viewing scenario with
 * appropriate camera positioning and visual effects.
 */

import { mat4, vec3, quat } from '../utils/math.js';

/** Ground observer camera preset types */
export enum GroundObserverPreset {
  HOUSE_WINDOW = 'houseWindow',
  CAR_WINDSHIELD = 'carWindshield',
  BEACH_NIGHT = 'beachNight',
  ROOFTOP = 'rooftop',
  AIRPLANE_WINDOW = 'airplaneWindow',
}

/** Camera configuration for a ground observer preset */
export interface GroundObserverConfig {
  name: string;
  description: string;
  // Camera position (on Earth's surface, looking up)
  position: vec3;
  // Look direction (normalized)
  lookAt: vec3;
  // Field of view in degrees
  fov: number;
  // CSS overlay class name
  overlayClass: string;
  // Additional effects
  effects: {
    motionBlur?: number;
    vignette?: number;
    bloomIntensity?: number;
    colorTemperature?: number;  // Kelvin
  };
  // Parallax settings for mouse movement
  parallax: {
    enabled: boolean;
    strength: number;
  };
  // Atmospheric scattering multiplier
  atmosphericScatter: number;
}

/** Preset configurations */
export const GROUND_OBSERVER_PRESETS: Record<GroundObserverPreset, GroundObserverConfig> = {
  [GroundObserverPreset.HOUSE_WINDOW]: {
    name: 'House Window',
    description: 'Cozy indoor view with warm interior lighting',
    // Position: suburban backyard, looking up at ~70° elevation
    position: [4000, 4500, 3000],
    lookAt: [0, 6921, 0],  // Look toward orbital shell
    fov: 60,
    overlayClass: 'frame-house',
    effects: {
      vignette: 0.4,
      bloomIntensity: 1.2,
      colorTemperature: 3200,  // Warm indoor lighting
    },
    parallax: {
      enabled: true,
      strength: 0.02,
    },
    atmosphericScatter: 1.0,
  },
  
  [GroundObserverPreset.CAR_WINDSHIELD]: {
    name: 'Car Windshield',
    description: 'Driving view with dashboard and motion parallax',
    // Position: driver's seat on highway
    position: [3500, 4000, 3500],
    lookAt: [0, 7500, 0],
    fov: 75,
    overlayClass: 'frame-car',
    effects: {
      motionBlur: 0.3,
      vignette: 0.2,
      bloomIntensity: 0.9,
      colorTemperature: 4500,  // Cool dashboard LEDs
    },
    parallax: {
      enabled: true,
      strength: 0.08,  // Stronger parallax for motion feel
    },
    atmosphericScatter: 0.8,
  },
  
  [GroundObserverPreset.BEACH_NIGHT]: {
    name: 'Beach at Night',
    description: 'Ocean horizon with water reflections',
    // Position: beach shoreline
    position: [6000, 6371, 0],  // Sea level
    lookAt: [0, 7000, 0],
    fov: 90,
    overlayClass: 'frame-beach',
    effects: {
      vignette: 0.3,
      bloomIntensity: 1.4,
      colorTemperature: 2700,  // Very warm
    },
    parallax: {
      enabled: false,
      strength: 0,
    },
    atmosphericScatter: 1.2,  // More scattering over ocean
  },
  
  [GroundObserverPreset.ROOFTOP]: {
    name: 'Rooftop View',
    description: 'Urban overlook with city light pollution',
    // Position: downtown rooftop
    position: [2000, 6500, 2000],
    lookAt: [0, 7200, 0],
    fov: 70,
    overlayClass: 'frame-rooftop',
    effects: {
      vignette: 0.25,
      bloomIntensity: 1.1,
      colorTemperature: 4000,
    },
    parallax: {
      enabled: true,
      strength: 0.03,
    },
    atmosphericScatter: 1.5,  // Heavy light pollution
  },
  
  [GroundObserverPreset.AIRPLANE_WINDOW]: {
    name: 'Airplane Window',
    description: 'High altitude view at cruising height',
    // Position: ~10km altitude
    position: [3000, 12000, 3000],
    lookAt: [0, 6921, 0],
    fov: 55,
    overlayClass: 'frame-airplane',
    effects: {
      vignette: 0.35,
      bloomIntensity: 1.0,
      colorTemperature: 6500,  // Daylight balanced
    },
    parallax: {
      enabled: false,
      strength: 0,
    },
    atmosphericScatter: 0.5,  // Less atmosphere at altitude
  },
};

/**
 * Ground Observer Camera Controller
 */
export class GroundObserverCamera {
  private currentPreset: GroundObserverPreset = GroundObserverPreset.HOUSE_WINDOW;
  private config: GroundObserverConfig = GROUND_OBSERVER_PRESETS[GroundObserverPreset.HOUSE_WINDOW];
  
  // Camera state
  private basePosition: vec3 = [0, 0, 0];
  private currentPosition: vec3 = [0, 0, 0];
  private targetLookAt: vec3 = [0, 0, 0];
  private currentLookAt: vec3 = [0, 0, 0];
  
  // Parallax state
  private mousePosition = { x: 0.5, y: 0.5 };
  private smoothedMousePosition = { x: 0.5, y: 0.5 };
  
  // View matrix cache
  private viewMatrix: Float32Array = new Float32Array(16);
  private projectionMatrix: Float32Array = new Float32Array(16);
  private viewProjMatrix: Float32Array = new Float32Array(16);
  
  constructor() {
    this.setPreset(GroundObserverPreset.HOUSE_WINDOW);
    this.setupMouseTracking();
  }
  
  /**
   * Setup mouse tracking for parallax effect
   */
  private setupMouseTracking(): void {
    window.addEventListener('mousemove', (e) => {
      this.mousePosition.x = e.clientX / window.innerWidth;
      this.mousePosition.y = e.clientY / window.innerHeight;
    });
  }
  
  /**
   * Set the current ground observer preset
   */
  setPreset(preset: GroundObserverPreset): void {
    this.currentPreset = preset;
    this.config = GROUND_OBSERVER_PRESETS[preset];
    
    // Copy base position
    this.basePosition = [...this.config.position];
    this.currentPosition = [...this.config.position];
    this.targetLookAt = [...this.config.lookAt];
    this.currentLookAt = [...this.config.lookAt];
    
    console.log(`[GroundObserverCamera] Switched to preset: ${this.config.name}`);
  }
  
  /**
   * Get the current preset enum
   */
  getCurrentPreset(): GroundObserverPreset {
    return this.currentPreset;
  }
  
  /**
   * Get the current preset configuration
   */
  getConfig(): GroundObserverConfig {
    return this.config;
  }
  
  /**
   * Get CSS overlay class for the current preset
   */
  getOverlayClass(): string {
    return this.config.overlayClass;
  }
  
  /**
   * Get all available presets
   */
  getAvailablePresets(): { id: GroundObserverPreset; name: string; description: string }[] {
    return Object.entries(GROUND_OBSERVER_PRESETS).map(([id, config]) => ({
      id: id as GroundObserverPreset,
      name: config.name,
      description: config.description,
    }));
  }
  
  /**
   * Update camera position based on parallax
   */
  update(deltaTime: number): void {
    const { parallax } = this.config;
    
    // Smooth mouse position
    const smoothing = 0.1;
    this.smoothedMousePosition.x += (this.mousePosition.x - this.smoothedMousePosition.x) * smoothing;
    this.smoothedMousePosition.y += (this.mousePosition.y - this.smoothedMousePosition.y) * smoothing;
    
    if (parallax.enabled) {
      // Calculate parallax offset (centered at 0.5)
      const offsetX = (this.smoothedMousePosition.x - 0.5) * parallax.strength * 1000;
      const offsetY = (this.smoothedMousePosition.y - 0.5) * parallax.strength * 1000;
      
      // Apply offset to position
      this.currentPosition[0] = this.basePosition[0] + offsetX;
      this.currentPosition[1] = this.basePosition[1] + offsetY;
      
      // Slight look target drift
      this.currentLookAt[0] = this.targetLookAt[0] + offsetX * 0.3;
      this.currentLookAt[1] = this.targetLookAt[1] + offsetY * 0.3;
    }
  }
  
  /**
   * Calculate view and projection matrices
   */
  calculateMatrices(aspectRatio: number): Float32Array {
    // Calculate view matrix
    mat4.lookAt(
      this.viewMatrix,
      this.currentPosition,
      this.currentLookAt,
      [0, 1, 0]  // Up vector
    );
    
    // Calculate projection matrix
    const fovRad = (this.config.fov * Math.PI) / 180;
    mat4.perspective(
      this.projectionMatrix,
      fovRad,
      aspectRatio,
      10,    // Near plane
      500000 // Far plane (Moon distance)
    );
    
    // Combine view and projection
    mat4.multiply(this.viewProjMatrix, this.projectionMatrix, this.viewMatrix);
    
    return this.viewProjMatrix;
  }
  
  /**
   * Get current camera position
   */
  getPosition(): vec3 {
    return this.currentPosition;
  }
  
  /**
   * Get current look target
   */
  getLookAt(): vec3 {
    return this.currentLookAt;
  }
  
  /**
   * Get field of view
   */
  getFOV(): number {
    return this.config.fov;
  }
  
  /**
   * Get effect parameters for post-processing
   */
  getEffectParameters(): GroundObserverConfig['effects'] {
    return this.config.effects;
  }
  
  /**
   * Get atmospheric scattering multiplier
   */
  getAtmosphericScatter(): number {
    return this.config.atmosphericScatter;
  }
  
  /**
   * Cycle to next preset
   */
  nextPreset(): void {
    const presets = Object.values(GroundObserverPreset);
    const currentIndex = presets.indexOf(this.currentPreset);
    const nextIndex = (currentIndex + 1) % presets.length;
    this.setPreset(presets[nextIndex]);
  }
  
  /**
   * Cycle to previous preset
   */
  previousPreset(): void {
    const presets = Object.values(GroundObserverPreset);
    const currentIndex = presets.indexOf(this.currentPreset);
    const prevIndex = (currentIndex - 1 + presets.length) % presets.length;
    this.setPreset(presets[prevIndex]);
  }
  
  /**
   * Serialize current state
   */
  serialize(): object {
    return {
      preset: this.currentPreset,
      mousePosition: { ...this.mousePosition },
    };
  }
  
  /**
   * Restore from serialized state
   */
  deserialize(state: any): void {
    if (state.preset) {
      this.setPreset(state.preset as GroundObserverPreset);
    }
    if (state.mousePosition) {
      this.mousePosition = { ...state.mousePosition };
    }
  }
}

export default GroundObserverCamera;
