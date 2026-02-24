/**
 * Shader Type Definitions for Grok Zephyr
 * Uniform buffer layouts and shader module interfaces
 */

/** Uniform buffer layout (256 bytes) - shared across all shaders */
export interface UniformBufferLayout {
  /** View-projection matrix (offset 0, 64 bytes) */
  viewProj: Float32Array; // 16 floats
  /** Camera position (offset 64, 16 bytes) */
  cameraPos: Float32Array; // 4 floats
  /** Camera right vector for billboards (offset 80, 16 bytes) */
  cameraRight: Float32Array; // 4 floats
  /** Camera up vector for billboards (offset 96, 16 bytes) */
  cameraUp: Float32Array; // 4 floats
  /** Simulation time in seconds (offset 112, 4 bytes) */
  time: number;
  /** Delta time since last frame (offset 116, 4 bytes) */
  deltaTime: number;
  /** Current view mode: 0=Horizon, 1=God, 2=Fleet (offset 120, 4 bytes) */
  viewMode: number;
  /** Padding (offset 124, 4 bytes) */
  _pad0: number;
  /** Frustum planes for culling (offset 128, 96 bytes) */
  frustum: Float32Array; // 24 floats (6 planes × 4)
  /** Screen size in pixels (offset 224, 8 bytes) */
  screenSize: Float32Array; // 2 floats
  /** Padding (offset 232, 8 bytes) */
  _pad1: Float32Array; // 2 floats
}

/** Bloom blur uniform buffer (32 bytes) */
export interface BloomUniformLayout {
  /** Texel size (1/width, 1/height) */
  texel: Float32Array;
  /** 1 for horizontal blur, 0 for vertical */
  horizontal: number;
  /** Padding */
  _pad: number;
}

/** Satellite orbital elements stored in GPU buffer */
export interface OrbitalElement {
  /** Right Ascension of Ascending Node (RAAN) in radians */
  raan: number;
  /** Inclination in radians */
  inclination: number;
  /** Mean anomaly at epoch in radians */
  meanAnomaly0: number;
  /** Color data (packed color index and phase) */
  colorData: number;
}

/** Compiled shader module with metadata */
export interface CompiledShaderModule {
  /** WebGPU shader module */
  module: GPUShaderModule;
  /** Source code (for debugging/hot-reload) */
  source: string;
  /** Last modified timestamp */
  lastModified: number;
  /** Compilation info */
  compilationInfo?: GPUCompilationInfo;
}

/** Shader pipeline configuration */
export interface ShaderPipelineConfig {
  /** Shader name/identifier */
  name: string;
  /** Vertex shader entry point */
  vertexEntry?: string;
  /** Fragment shader entry point */
  fragmentEntry?: string;
  /** Compute shader entry point */
  computeEntry?: string;
  /** Bind group layouts */
  bindGroupLayouts: GPUBindGroupLayout[];
  /** Vertex buffer layouts (for render pipelines) */
  vertexBuffers?: GPUVertexBufferLayout[];
  /** Color target formats */
  colorTargets?: GPUColorTargetState[];
  /** Depth stencil state */
  depthStencil?: GPUDepthStencilState;
  /** Primitive state */
  primitive?: GPUPrimitiveState;
  /** Multisample state */
  multisample?: GPUMultisampleState;
}

/** Shader cache entry */
export interface ShaderCacheEntry {
  /** Pipeline layout */
  pipelineLayout: GPUPipelineLayout;
  /** Render or compute pipeline */
  pipeline: GPURenderPipeline | GPUComputePipeline;
  /** Shader module reference */
  module: CompiledShaderModule;
  /** Configuration used to create this pipeline */
  config: ShaderPipelineConfig;
}

/** Hot-reload callback function */
export type ShaderReloadCallback = (shaderName: string, module: CompiledShaderModule) => void;

/** View modes for the simulation */
export enum ViewMode {
  /** 720km Horizon view - camera at 720km altitude looking along constellation */
  Horizon720 = 0,
  /** God view - orbiting free camera with mouse controls */
  GodView = 1,
  /** Fleet POV - camera follows satellite #0 in first-person */
  FleetPOV = 2,
}

/** Simulation constants */
export const SIMULATION_CONSTANTS = {
  /** Total number of satellites (2^20) */
  NUM_SATELLITES: 1_048_576,
  /** Earth radius in km */
  EARTH_RADIUS_KM: 6371.0,
  /** Orbit radius in km (550km altitude) */
  ORBIT_RADIUS_KM: 6921.0,
  /** Camera radius in km (720km altitude) */
  CAMERA_RADIUS_KM: 7091.0,
  /** Orbital angular velocity in rad/s */
  MEAN_MOTION: 0.001097,
  /** Number of orbital planes */
  NUM_PLANES: 1024,
  /** Satellites per plane */
  SATELLITES_PER_PLANE: 1024,
  /** Workgroup size for compute shaders */
  COMPUTE_WORKGROUP_SIZE: 64,
  /** Maximum distance for rendering satellites (km) */
  MAX_RENDER_DISTANCE_KM: 14000.0,
  /** Atmosphere scale factor (100km atmosphere) */
  ATMOSPHERE_SCALE: 6471.0 / 6371.0,
  /** Uniform buffer size in bytes */
  UNIFORM_BUFFER_SIZE: 256,
  /** Bloom uniform buffer size in bytes */
  BLOOM_UNIFORM_SIZE: 32,
} as const;

/** Shader names registry */
export const SHADER_NAMES = {
  ORBITAL_COMPUTE: 'orbital_compute',
  SATELLITE_RENDER: 'satellite_render',
  EARTH_ATMOSPHERE: 'earth_atmosphere',
  STARS_RENDER: 'stars_render',
  POST_PROCESS: 'post_process',
  BLOOM_THRESHOLD: 'bloom_threshold',
  BLOOM_BLUR: 'bloom_blur',
  COMPOSITE: 'composite',
} as const;

export type ShaderName = typeof SHADER_NAMES[keyof typeof SHADER_NAMES];
