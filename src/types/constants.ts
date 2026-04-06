/**
 * Grok Zephyr - Simulation Constants
 */

import type { SimulationConstants, ViewModeConfig } from './index.js';

/** Satellite and orbital constants */
export const CONSTANTS: SimulationConstants = {
  NUM_SATELLITES: 1048576,    // 2^20 satellites
  EARTH_RADIUS_KM: 6371.0,    // km - Earth radius
  ORBIT_RADIUS_KM: 6921.0,    // km - 550km altitude orbit
  CAMERA_RADIUS_KM: 7091.0,   // km - 720km altitude camera
  MOON_DISTANCE_KM: 384400.0, // km - average Earth-Moon distance
  MEAN_MOTION: 0.001097,      // rad/s - orbital angular velocity
  NUM_PLANES: 1024,           // orbital planes
  SATELLITES_PER_PLANE: 1024, // satellites per plane
} as const;

/** Math constants */
export const MATH = {
  DEG_TO_RAD: Math.PI / 180,
  RAD_TO_DEG: 180 / Math.PI,
  TWO_PI: Math.PI * 2,
  HALF_PI: Math.PI / 2,
} as const;

/** Inclination shells for Walker constellation */
export const INCLINATION_SHELLS = [
  53 * MATH.DEG_TO_RAD,    // 53° - main Starlink shell
  70 * MATH.DEG_TO_RAD,    // 70° - polar coverage
  97.6 * MATH.DEG_TO_RAD,  // 97.6° - sun-synchronous
  30 * MATH.DEG_TO_RAD,    // 30° - equatorial
] as const;

/** View mode configurations */
export const VIEW_MODES: ViewModeConfig[] = [
  { id: 0, name: '720km Horizon', altitude: '720', default: true },
  { id: 1, name: 'God View', altitude: '---', default: false },
  { id: 2, name: 'Fleet POV', altitude: '550', default: false },
  { id: 3, name: 'Ground View', altitude: '0', default: false },
  { id: 4, name: 'Moon View', altitude: '384400', default: false },
] as const;

/** Camera settings */
export const CAMERA = {
  DEFAULT_FOV: 60 * MATH.DEG_TO_RAD,
  NEAR_PLANE: 10,
  FAR_PLANE: 500000,
  GOD_VIEW_DISTANCE: 25000,
  GOD_VIEW_MIN_DISTANCE: 8000,
  GOD_VIEW_MAX_DISTANCE: 60000,
} as const;

/** Rendering settings */
export const RENDER = {
  HDR_FORMAT: 'rgba16float' as GPUTextureFormat,
  DEPTH_FORMAT: 'depth24plus' as GPUTextureFormat,
  SWAPCHAIN_FORMAT: 'bgra8unorm' as GPUTextureFormat,
  BLOOM_THRESHOLD: 0.75,
  BLOOM_INTENSITY: 1.8,
  WORKGROUP_SIZE: 64,
} as const;

/** Culling distances */
export const CULLING = {
  /** Max distance for satellite rendering (km) - increased for ground/Moon views */
  MAX_DISTANCE: 150000.0,
  /** Frustum culling margin (km) */
  FRUSTUM_MARGIN: 200.0,
} as const;

/** Satellite visual settings */
export const SATELLITE_VISUAL = {
  /** Number of color variations */
  COLOR_COUNT: 7,
  /** Base billboard size in km at reference distance */
  BASE_SIZE: 1200.0,
  /** Reference distance for size calculation */
  REF_DISTANCE: 50.0,
  /** Minimum billboard size */
  MIN_SIZE: 0.4,
  /** Maximum billboard size */
  MAX_SIZE: 60.0,
  /** Attenuation factor */
  ATTENUATION: 0.00075,
} as const;

/** Earth visual settings */
export const EARTH_VISUAL = {
  SPHERE_SEGMENTS: 64,
  SPHERE_RINGS: 64,
  ATMOSPHERE_SCALE: 6471.0 / 6371.0, // 100km atmosphere
} as const;

/** UI update intervals (seconds) */
export const UI = {
  FPS_UPDATE_INTERVAL: 0.5,
  STATS_UPDATE_INTERVAL: 1.0,
} as const;

/** Buffer sizes */
export const BUFFER_SIZES = {
  UNIFORM: 256,           // 256 bytes aligned
  BLOOM_UNIFORM: 32,      // 32 bytes for bloom params
  SATELLITE_DATA: 16,     // vec4f per satellite
  ORBITAL_ELEMENT: 16,    // vec4f per satellite
  /** Per-satellite RGBA color: packed rgba8unorm as u32 (4 bytes/sat) */
  SATELLITE_COLOR: 4,     // u32 per satellite (rgba8unorm packed)
} as const;

/**
 * Walker constellation angular separation constants.
 *
 * T/P/F = 1,048,576 / 1024 / 1
 * In-plane: Δν = 2π/1024 = 0.006136 rad = 0.3516°
 * Cross-plane: ΔΩ = 2π/1024 = 0.006136 rad
 *
 * Linear spacing at each shell:
 *   340km (6711km): 41.18 km
 *   550km (6921km): 42.47 km
 *   1150km (7521km): 46.15 km
 *
 * Apparent angular separation from 720km camera:
 *   Closest 550km shell (170km range): 14.31°
 *   Typical range (2000km): 1.2°
 *   Max render (14000km): 0.17°
 */
export const CONSTELLATION_OPTICS = {
  /** In-plane angular separation (rad): 2π/1024 */
  IN_PLANE_ANGULAR_SEP_RAD: 0.006136,
  /** In-plane angular separation (deg) */
  IN_PLANE_ANGULAR_SEP_DEG: 0.3516,
  /** Cross-plane RAAN separation (rad) */
  CROSS_PLANE_RAAN_SEP_RAD: 0.006136,
  /** Bloom PSF half-angle for mag-5 star (rad): 4 arcmin */
  MAG5_BLOOM_HALFANGLE_RAD: 0.00116,
  /** HDR scale factor for bloom visibility */
  BLOOM_HDR_SCALE: 5.0,
  /** Billboard angular half-size (rad): bloom × HDR_scale */
  BILLBOARD_ANGULAR_SIZE_RAD: 0.0058,
  /** Billboard minimum size (km) */
  BILLBOARD_MIN_KM: 0.3,
  /** Billboard maximum size (km) */
  BILLBOARD_MAX_KM: 40.0,
} as const;

/**
 * Blink timing model constants for coherent ground image.
 *
 * Image: 1024×1024 = 1,048,576 pixels (= satellite count)
 * Ground FOV: 5° (observer looking up)
 *
 * Per-shell pixel drift rates:
 *   340km: 244.5 px/s (max flash 2.05 ms for 0.5px blur)
 *   550km: 148.8 px/s (max flash 3.36 ms)
 *   1150km: 62.9 px/s (max flash 7.95 ms)
 *
 * Conservative flash window: 2 ms (limited by 340km shell)
 * Recommended frame rate: 30 fps, 6% duty cycle
 */
export const BLINK_TIMING = {
  /** Recommended frame rate (Hz) */
  FRAME_RATE: 30,
  /** Flash duration (ms) — conservative, < 2.05ms Nyquist for 340km */
  FLASH_DURATION_MS: 2.0,
  /** Duty cycle (flash / frame period) */
  DUTY_CYCLE: 0.06,
  /** Ground observer FOV (degrees) */
  GROUND_FOV_DEG: 5.0,
  /** Projected image size (pixels per side) */
  IMAGE_SIZE: 1024,
  /** Pixel drift: 340km shell (px/s) */
  DRIFT_340KM_PX_PER_SEC: 244.5,
  /** Pixel drift: 550km shell (px/s) */
  DRIFT_550KM_PX_PER_SEC: 148.8,
  /** Pixel drift: 1150km shell (px/s) */
  DRIFT_1150KM_PX_PER_SEC: 62.9,
} as const;

/** Physics mode configurations */
export const PHYSICS_MODES = [
  { id: 0, name: 'Simple', description: 'Basic circular orbits', implemented: true },
  { id: 1, name: 'Keplerian', description: 'Elliptical orbits with mean anomaly', implemented: true },
  { id: 2, name: 'J2 Perturbed', description: 'Oblateness corrections', implemented: false },
] as const;
