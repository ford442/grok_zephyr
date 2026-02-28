/**
 * Grok Zephyr - Shared TypeScript Interfaces
 * 
 * Core type definitions for the orbital simulation system.
 */

/** 3D Vector as tuple */
export type Vec3 = [number, number, number];

/** 4D Vector as tuple */
export type Vec4 = [number, number, number, number];

/** 4x4 Matrix in column-major order (Float32Array of 16 elements) */
export type Mat4 = Float32Array;

/** Geographic coordinates */
export interface LatLng {
  lat: number;
  lng: number;
}

/** Keplerian orbital elements */
export interface KeplerianElements {
  /** Semi-major axis (km) */
  a: number;
  /** Eccentricity */
  e: number;
  /** Inclination (radians) */
  i: number;
  /** Right Ascension of Ascending Node (radians) */
  Ω: number;
  /** Argument of Perigee (radians) */
  ω: number;
  /** Mean Anomaly at epoch (radians) */
  M: number;
}

/** Satellite state structure */
export interface SatelliteState {
  /** Current position in ECI frame (km) */
  position: Float32Array;
  /** Current velocity in ECI frame (km/s) */
  velocity: Float32Array;
  /** Orbital elements */
  keplerian: KeplerianElements;
  /** RGB color values (0-255) */
  rgb: Uint8Array;
  /** Target ground location for projections */
  targetGround: LatLng;
}

/** Camera view modes */
export type ViewMode = 'horizon-720' | 'god' | 'sat-pov' | 'ground';

/** Camera pose configuration */
export interface CameraPose {
  mode: ViewMode;
  position: Vec3;
  lookAt: Vec3;
  up: Vec3;
  fov: number;
  near: number;
  far: number;
}

/** Uniform buffer structure (matches WGSL) */
export interface UniformData {
  /** View-projection matrix (offset 0, 64 bytes) */
  viewProj: Mat4;
  /** Camera position (offset 64, 16 bytes) */
  cameraPos: Vec4;
  /** Camera right vector (offset 80, 16 bytes) */
  cameraRight: Vec4;
  /** Camera up vector (offset 96, 16 bytes) */
  cameraUp: Vec4;
  /** Simulation time (offset 112, 4 bytes) */
  time: number;
  /** Delta time (offset 116, 4 bytes) */
  deltaTime: number;
  /** View mode index (offset 120, 4 bytes) */
  viewMode: number;
  /** Is ground view flag (offset 124, 4 bytes) */
  isGroundView: number;
  /** Frustum planes (offset 128, 96 bytes) - 6 planes, each vec4f */
  frustum: Float32Array;
  /** Screen size in pixels (offset 224, 8 bytes) */
  screenSize: [number, number];
  /** Padding (offset 232, 8 bytes) */
  pad1: [number, number];
}

/** Bloom uniform data for blur passes */
export interface BloomUniform {
  /** Texel size (1/width, 1/height) */
  texel: [number, number];
  /** 1 for horizontal, 0 for vertical */
  horizontal: number;
  /** Padding */
  pad: number;
}

/** Performance statistics */
export interface PerformanceStats {
  /** Current FPS */
  fps: number;
  /** Frame time in milliseconds */
  frameTime: number;
  /** GPU memory usage in MB (if available) */
  gpuMemoryMB: number;
  /** Number of visible satellites */
  visibleSatellites: number;
  /** Compute dispatch time in ms */
  computeTime: number;
  /** Render pass time in ms */
  renderTime: number;
}

/** TLE (Two-Line Element) data */
export interface TLEData {
  name: string;
  line1: string;
  line2: string;
}

/** Shader module descriptor */
export interface ShaderDescriptor {
  name: string;
  code: string;
  entryPoint: string;
}

/** Render target configuration */
export interface RenderTargetConfig {
  width: number;
  height: number;
  format: GPUTextureFormat;
  usage: GPUTextureUsageFlags;
}

/** Pipeline bind group layout descriptor */
export interface BindGroupLayoutDescriptor {
  entries: GPUBindGroupLayoutEntry[];
}

/** Buffer usage flags helper */
export type BufferUsage = GPUBufferUsageFlags;

/** WebGPU context configuration */
export interface WebGPUContextConfig {
  powerPreference: GPUPowerPreference;
  requiredFeatures: GPUFeatureName[];
  canvas: HTMLCanvasElement;
}

/** Simulation constants */
export interface SimulationConstants {
  /** Number of satellites (1,048,576 = 2^20) */
  NUM_SATELLITES: number;
  /** Earth radius in km */
  EARTH_RADIUS_KM: number;
  /** Orbit radius in km (550km altitude) */
  ORBIT_RADIUS_KM: number;
  /** Camera radius in km (720km altitude) */
  CAMERA_RADIUS_KM: number;
  /** Mean motion in rad/s */
  MEAN_MOTION: number;
  /** Number of orbital planes */
  NUM_PLANES: number;
  /** Satellites per plane */
  SATELLITES_PER_PLANE: number;
}

/** View mode configuration */
export interface ViewModeConfig {
  id: number;
  name: string;
  altitude: string;
  default: boolean;
}
