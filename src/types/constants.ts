/**
 * Grok Zephyr - Simulation Constants
 */

import type { SimulationConstants, ViewModeConfig } from './index.js';

/** Satellite and orbital constants */
export const CONSTANTS: SimulationConstants = {
  NUM_SATELLITES: 1048576, // 2^20 satellites
  EARTH_RADIUS_KM: 6371.0, // km - Earth radius
  ORBIT_RADIUS_KM: 6921.0, // km - 550km altitude orbit
  CAMERA_RADIUS_KM: 7091.0, // km - 720km altitude camera
  MOON_DISTANCE_KM: 384400.0, // km - average Earth-Moon distance
  MEAN_MOTION: 0.001097, // rad/s - orbital angular velocity
  NUM_PLANES: 1024, // orbital planes
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
  53 * MATH.DEG_TO_RAD, // 53° - main Starlink shell
  70 * MATH.DEG_TO_RAD, // 70° - polar coverage
  97.6 * MATH.DEG_TO_RAD, // 97.6° - sun-synchronous
  30 * MATH.DEG_TO_RAD, // 30° - equatorial
] as const;

/** View mode configurations */
export const VIEW_MODES: ViewModeConfig[] = [
  { id: 0, name: '720km Horizon', altitude: '720', default: true },
  { id: 1, name: 'God View', altitude: '---', default: false },
  { id: 2, name: 'Fleet POV', altitude: '550', default: false },
  { id: 3, name: 'Ground View', altitude: '0', default: false },
  { id: 4, name: 'Moon View', altitude: '384400', default: false },
  { id: 5, name: 'Skyline', altitude: '0', default: false },
] as const;

/** Per-view bloom/satellite tuning profiles — see `src/core/ViewTuningProfile.ts`. */

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
  DEPTH_FORMAT: 'depth32float' as GPUTextureFormat,
  SWAPCHAIN_FORMAT: 'bgra8unorm' as GPUTextureFormat,
  BLOOM_THRESHOLD: 1.5,
  /** Composite bloom multiplier (retuned for threshold-1.5 extraction pass) */
  BLOOM_INTENSITY: 2.25,
  WORKGROUP_SIZE: 64,
} as const;

/** Culling distances */
export const CULLING = {
  /** Max distance for satellite rendering (km) - increased for ground/Moon views */
  MAX_DISTANCE: 150000.0,
  /** Frustum culling margin (km) */
  FRUSTUM_MARGIN: 200.0,
} as const;

/** UI update intervals (seconds) */
export const UI = {
  FPS_UPDATE_INTERVAL: 0.5,
  STATS_UPDATE_INTERVAL: 1.0,
  DEMO_IDLE_TIMEOUT_SECONDS: 180,
} as const;

/** Buffer sizes */
export const BUFFER_SIZES = {
  UNIFORM: 256, // 256 bytes aligned
  BLOOM_UNIFORM: 32, // 32 bytes for bloom params
  SATELLITE_DATA: 16, // vec4f per satellite
  ORBITAL_ELEMENT: 16, // vec4f per satellite
  /** Per-satellite RGBA color: packed rgba8unorm as u32 (4 bytes/sat) */
  SATELLITE_COLOR: 4, // u32 per satellite (rgba8unorm packed)
} as const;
