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
  /** Sky Strips: Per-satellite pattern data (16 bytes per sat: brightness, patternId, phase, speed) */
  patterns: GPUBuffer;
  /** Sky Strips: Uniform buffer for pattern compute shader */
  skyStripUniforms: GPUBuffer;
  /** Smile V2: Uniform buffer for animation state (96 bytes) */
  smileV2Uniforms: GPUBuffer;
  /** Smile V2: Trail buffer for phase 6 trails (2 frames × 16 bytes) */
  trailBuffer: GPUBuffer;
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
}
