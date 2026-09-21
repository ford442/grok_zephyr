/** Buffer pair for double-buffering */
export interface BufferPair {
  read: GPUBuffer;
  write: GPUBuffer;
  current: 'read' | 'write';
}

/** Satellite buffer configuration */
export interface SatelliteBufferConfig {
  /** Enable double-buffering for ping-pong rendering */
  doubleBuffer: boolean;
  /**
   * Allocate the 2-frame trail history buffer (32 MB at 1M). Cinematic only;
   * combined with doubleBuffer it does not fit a 1M fleet under 128 MB.
   */
  trailHistory: boolean;
  /** Enable CPU readback (for debug/visualization) */
  enableReadback: boolean;
  /** Buffer usage flags */
  usage: GPUBufferUsageFlags;
}

/** Maximum number of laser beams */
export const MAX_BEAMS = 65536;

/** Pascal GPU safe limit (conservative) */
export const MAX_SAFE_BUFFER_SIZE = 128 * 1024 * 1024;

/** Warning threshold — log if buffer size exceeds this (safety margin) */
export const WARNING_BUFFER_THRESHOLD = 120 * 1024 * 1024;

/**
 * GPU-driven trails track a fixed, budget-bounded subset of the fleet rather
 * than 1-2 history frames for every satellite — most satellites never render
 * a trail anyway (CPU MAX_TRAILS_RENDERED capped that at 12,000). A fixed
 * stride picks `TRAIL_MAX_TRACKED_SATS` satellites evenly across the fleet;
 * `orbital.wgsl` writes their positions into a ring each frame, and
 * `trailExpand.wgsl` turns the ring into ribbon geometry, both only when
 * `trailHistory` (cinematic quality) is on.
 */
export const TRAIL_MAX_TRACKED_SATS = 16384;
/** Ring depth per tracked satellite. */
export const TRAIL_HISTORY_FRAMES = 16;
/** Ribbon segments per trail = history frames - 1 (one gap fewer than samples). */
export const TRAIL_MAX_SEGMENTS = TRAIL_HISTORY_FRAMES - 1;
/** Compacted/culled draw cap — mirrors the CPU renderer's MAX_TRAILS_RENDERED. */
export const TRAIL_MAX_RENDERED = 8192;
/** x,y,z,intensity,age,shell — matches TrailRenderer's CPU vertex layout. */
export const TRAIL_VERTEX_STRIDE_FLOATS = 6;

/** GPU-side trail history + ribbon-expansion buffers (cinematic only). */
export interface TrailGpuBuffers {
  /** True when allocated at cinematic capacity; false means placeholder sizes. */
  enabled: boolean;
  /** Ring buffer of vec4f(position.xyz, shell|invalid) per tracked satellite × frame. */
  history: GPUBuffer;
  /** TrailUni params (stride, history_frames, write_index, tracked_count, ...). */
  params: GPUBuffer;
  /** Ribbon vertices, written by trailExpand.wgsl and bound as a vertex buffer. */
  vertices: GPUBuffer;
  /** Ribbon indices, written by trailExpand.wgsl and bound as an index buffer. */
  indices: GPUBuffer;
  /** DrawIndexedIndirect args, written by trailExpand.wgsl's finalize step. */
  indirect: GPUBuffer;
  /** Atomic vertex/index write cursors, reset to zero before each expand dispatch. */
  counters: GPUBuffer;
}

/** GPU buffer set for satellite data */
export interface SatelliteBufferSet {
  /** Orbital elements (read-only storage) */
  orbitalElements: GPUBuffer;
  /** Extended Keplerian elements for Keplerian / J2 / SGP4-anchor (32 bytes/sat) */
  extendedElements: GPUBuffer;
  /** Satellite positions (read-write storage) */
  positions: GPUBuffer | BufferPair;
  /** Uniform buffer for frame data */
  uniforms: GPUBuffer;
  /** Ground station position/zenith/threshold (32 bytes). */
  stationUniform: GPUBuffer;
  /** Bloom uniform buffers (H and V passes) */
  bloomUniforms: {
    horizontal: GPUBuffer;
    vertical: GPUBuffer;
  };
  /** Beam data storage (start + end vec4 per beam) */
  beams: GPUBuffer;
  /** Beam params uniform (time, patternMode, density, padding) */
  beamParams: GPUBuffer;
  /** Pattern params uniform for animation patterns (time, mode, seed, pad) */
  patternParams: GPUBuffer;
  /** Per-satellite RGBA color (packed rgba8unorm u32, 4 MB for 1M sats) */
  colors: GPUBuffer;
  /** Animation scratch — Smile V2 sat_output: packed rgba8unorm u32 per satellite (4 MB for 1M sats) */
  animScratch: GPUBuffer;
  /** Smile V2: Uniform buffer for animation state (96 bytes) */
  smileV2Uniforms: GPUBuffer;
  /** GPU trail history + ribbon buffers; `trail.enabled` mirrors config.trailHistory (cinematic) */
  trail: TrailGpuBuffers;
  /** Per-satellite constellation group id (u32, 4 MB for 1M sats) */
  groupIds: GPUBuffer;
  /** Per-group render parameters (colors, size, visibility) */
  groupParams: GPUBuffer;
  /** Optical ISL segments (start+end vec4, 128k × 32 B) */
  islLinks: GPUBuffer;
  /** ISL compute/render params (32 bytes) */
  islParams: GPUBuffer;
  /** Unix-day each sat becomes active (u32 × fleet) */
  activeFrom: GPUBuffer;
  /** Growth era uniform (16 bytes) */
  growthParams: GPUBuffer;
  /** Near-earth SGP4 mean elements for TLE slots (physics mode 3), see sgp4NearEarth.ts */
  sgp4Elements: GPUBuffer;
}

export function isBufferPair(buffer: GPUBuffer | BufferPair): buffer is BufferPair {
  return 'read' in buffer && 'write' in buffer;
}

/** Frame-loop surface: tick re-anchor + buffers + CPU position helpers. */
export interface SatelliteFrameBuffers {
  tickSgp4Reanchor(simTime: number): void;
  getBuffers(): SatelliteBufferSet;
  getOrbitalElementData(): Float32Array;
  calculateSatellitePosition(index: number, time: number): [number, number, number];
  calculateSatelliteVelocity(index: number, time: number): [number, number, number];
  /** Advances the GPU trail-history ring's write index; no-op unless trail.enabled. */
  tickTrailWriteIndex(): void;
}
