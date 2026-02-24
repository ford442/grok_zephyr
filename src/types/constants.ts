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
] as const;

/** Camera settings */
export const CAMERA = {
  DEFAULT_FOV: 60 * MATH.DEG_TO_RAD,
  NEAR_PLANE: 10,
  FAR_PLANE: 50000,
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
  /** Max distance for satellite rendering (km) */
  MAX_DISTANCE: 14000.0,
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
} as const;
