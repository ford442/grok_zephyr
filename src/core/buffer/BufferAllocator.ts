import type { WebGPUContext } from '@/core/WebGPUContext.js';
import { BUFFER_SIZES } from '@/types/constants.js';
import { GROUP_PARAMS_UNIFORM_SIZE } from '@/data/ConstellationGroups.js';
import { ISL_PARAM_BYTES, MAX_ISL_LINKS } from '@/types/isl.js';
import {
  MAX_BEAMS,
  MAX_SAFE_BUFFER_SIZE,
  TRAIL_HISTORY_FRAMES,
  TRAIL_MAX_RENDERED,
  TRAIL_MAX_SEGMENTS,
  TRAIL_MAX_TRACKED_SATS,
  TRAIL_VERTEX_STRIDE_FLOATS,
  WARNING_BUFFER_THRESHOLD,
  isBufferPair,
  type SatelliteBufferConfig,
  type SatelliteBufferSet,
  type TrailGpuBuffers,
} from './bufferTypes.js';
import {
  SGP4_GPU_CAPACITY,
  SGP4_GPU_FLOATS_PER_SLOT,
  SGP4_GPU_HEADER_FLOATS,
} from '@/physics/sgp4NearEarth.js';

export interface SatelliteBufferSizes {
  numSatellites: number;
  position: number;
  elements: number;
  extended: number;
}

/** Options that change which satellite buffers are actually allocated. */
export type SatelliteBudgetOptions = Pick<SatelliteBufferConfig, 'doubleBuffer' | 'trailHistory'>;

/** Bytes per satellite in the packed rgba8 animation scratch (Smile V2 sat_output). */
export const ANIM_SCRATCH_BYTES_PER_SAT = 4;

/** Trail history ring: TRAIL_MAX_TRACKED_SATS × TRAIL_HISTORY_FRAMES × vec4f. */
function trailHistoryBytes(): number {
  return TRAIL_MAX_TRACKED_SATS * TRAIL_HISTORY_FRAMES * 16;
}

/** Ribbon vertex/index buffers sized for the compacted, culled draw. */
function trailVertexBytes(): number {
  return TRAIL_MAX_RENDERED * TRAIL_MAX_SEGMENTS * 2 * TRAIL_VERTEX_STRIDE_FLOATS * 4;
}
function trailIndexBytes(): number {
  return TRAIL_MAX_RENDERED * TRAIL_MAX_SEGMENTS * 6 * 4;
}

/** TrailUni params (48 B) + DrawIndexedIndirect (32 B) + atomics (16 B). */
const TRAIL_PARAMS_BYTES = 48;
const TRAIL_INDIRECT_BYTES = 32;
const TRAIL_COUNTERS_BYTES = 16;

/**
 * Total trail budget: fixed-size regardless of fleet size (a bounded, evenly
 * strided subset of satellites is tracked — see bufferTypes.ts). Off, this is
 * still the tiny placeholder allocation the orbital compute bind group needs.
 */
function trailBudgetBytes(enabled: boolean): number {
  return (
    (enabled ? trailHistoryBytes() : 16) +
    TRAIL_PARAMS_BYTES +
    (enabled ? trailVertexBytes() : TRAIL_VERTEX_STRIDE_FLOATS * 4) +
    (enabled ? trailIndexBytes() : 24) +
    TRAIL_INDIRECT_BYTES +
    TRAIL_COUNTERS_BYTES
  );
}

/**
 * Single source of truth for satellite GPU memory. Allocation, the boot-time
 * assert, getMemoryUsage and the conjunction budget all read this ledger, and
 * `total` includes uniforms — nothing is excluded.
 *
 * 1,048,576 satellites (MB = MiB):
 * - Position:   16 MB (vec4<f32>; ×2 = 32 MB with doubleBuffer ping-pong)
 * - Elements:   16 MB (vec4<f32>)
 * - Extended:   32 MB (8 floats × 4 bytes)
 * - Colors:      4 MB (rgba8unorm packed u32)
 * - AnimScratch: 4 MB (Smile V2 sat_output, rgba8unorm packed u32)
 * - Beams:       2 MB (64k × 32 bytes)
 * - Trails:    ~12 MB fixed (16,384 tracked sats × 16 history frames, plus
 *              ribbon vertex/index output for 8,192 rendered trails) —
 *              cinematic only (`trailHistory`); a bounded strided subset,
 *              not per-satellite, so it does not scale with fleet size.
 * - Group IDs:   4 MB
 * - ISL links:   4 MB (128k × 32 bytes)
 * - ActiveFrom:  2 MB (packed u16, ceil(n/2) × 4 bytes)
 * - SGP4 GPU:  <1 MB (near-earth mean elements, ≤16,384 TLE slots × 48 bytes)
 * - Uniforms:   <1 KB
 * Total: ~84 MB default, ~97 MB with trail history, ~113 MB with trail
 * history + doubleBuffer (both now fit the 1M-satellite Pascal cap).
 */
export function calculateSatelliteBufferBudget(
  numSats: number,
  options: SatelliteBudgetOptions = { doubleBuffer: false, trailHistory: false },
): {
  total: number;
  breakdown: Record<string, number>;
} {
  const breakdown = {
    position: numSats * 16 * (options.doubleBuffer ? 2 : 1),
    elements: numSats * 16,
    extended: numSats * 32,
    colors: numSats * 4,
    animScratch: numSats * ANIM_SCRATCH_BYTES_PER_SAT,
    beams: MAX_BEAMS * 32,
    trails: trailBudgetBytes(options.trailHistory),
    groupIds: numSats * 4,
    isl: MAX_ISL_LINKS * 32,
    activeFrom: Math.ceil(numSats / 2) * 4,
    sgp4: sgp4GpuBufferBytes(numSats),
    uniforms:
      BUFFER_SIZES.UNIFORM +
      32 +
      BUFFER_SIZES.BLOOM_UNIFORM * 2 +
      256 +
      16 +
      96 +
      16 +
      GROUP_PARAMS_UNIFORM_SIZE +
      ISL_PARAM_BYTES,
  };
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { total, breakdown };
}

/** Compact physics-mode-3 buffer: header + 12 floats per TLE slot, capped. */
export function sgp4GpuBufferBytes(numSats: number): number {
  const slots = Math.max(1, Math.min(SGP4_GPU_CAPACITY, numSats));
  return (SGP4_GPU_HEADER_FLOATS + slots * SGP4_GPU_FLOATS_PER_SLOT) * 4;
}

export function logBufferBudget(numSats: number, total: number, breakdown: Record<string, number>): void {
  const mb = (n: number) => (n / 1024 / 1024).toFixed(2);
  console.log(`[Buffer Size Debug] Breakdown for ${numSats.toLocaleString()} satellites:`);
  console.log(`  Position:   ${mb(breakdown.position)} MB (${numSats} × 16 bytes${breakdown.position > numSats * 16 ? ' × 2, ping-pong' : ''})`);
  console.log(`  Elements:   ${mb(breakdown.elements)} MB (${numSats} × 16 bytes)`);
  console.log(`  Extended:   ${mb(breakdown.extended)} MB (${numSats} × 32 bytes, COMPACT)`);
  console.log(`  Colors:     ${mb(breakdown.colors)} MB (${numSats} × 4 bytes)`);
  console.log(`  AnimScratch: ${mb(breakdown.animScratch)} MB (${numSats} × ${ANIM_SCRATCH_BYTES_PER_SAT} bytes, rgba8)`);
  console.log(`  Beams:      ${mb(breakdown.beams)} MB (${MAX_BEAMS} × 32 bytes)`);
  console.log(`  Trails:     ${mb(breakdown.trails)} MB ${breakdown.trails > 1024 ? `(${TRAIL_MAX_TRACKED_SATS} tracked × ${TRAIL_HISTORY_FRAMES} frames + ribbon output)` : '(off — cinematic only)'}`);
  console.log(`  Group IDs:  ${mb(breakdown.groupIds)} MB`);
  console.log(`  ISL links:  ${mb(breakdown.isl)} MB (${MAX_ISL_LINKS} × 32 bytes)`);
  console.log(`  ActiveFrom: ${mb(breakdown.activeFrom)} MB (${Math.ceil(numSats / 2)} × 4 bytes, packed u16)`);
  console.log(`  SGP4 GPU:   ${(breakdown.sgp4 / 1024).toFixed(2)} KB (near-earth TLE slots, mode 3)`);
  console.log(`  Uniforms:   ${(breakdown.uniforms / 1024).toFixed(2)} KB`);
  console.log(`  TOTAL:      ${mb(total)} MB`);
  console.log(`  LIMIT:      128.00 MB (Pascal safe limit)`);
  console.log(`  MARGIN:      ${((MAX_SAFE_BUFFER_SIZE - total) / 1024 / 1024).toFixed(2)} MB`);
}

export function assertBufferBudget(totalBytes: number): void {
  if (totalBytes > MAX_SAFE_BUFFER_SIZE) {
    const exceeded = ((totalBytes - MAX_SAFE_BUFFER_SIZE) / 1024 / 1024).toFixed(2);
    throw new Error(
      `Buffer total (${(totalBytes / 1024 / 1024).toFixed(1)} MB) exceeds Pascal safe limit of 128 MB ` +
        `(exceeded by ${exceeded} MB). Reduce NUM_SATELLITES or buffer sizes.`,
    );
  }
  if (totalBytes > WARNING_BUFFER_THRESHOLD) {
    const margin = ((MAX_SAFE_BUFFER_SIZE - totalBytes) / 1024 / 1024).toFixed(2);
    console.warn(
      `[Buffer Safety] WARNING: Buffer size (${(totalBytes / 1024 / 1024).toFixed(2)} MB) is within ${margin} MB of the 128 MB limit`,
    );
  }
  console.log(`[Buffer Safety] Total allocated: ${(totalBytes / 1024 / 1024).toFixed(2)} MB — OK ✓`);
}

/** Byte offsets into the 48-byte TrailUni uniform (must match trailExpand.wgsl / orbital.wgsl). */
export const TRAIL_UNI_WRITE_INDEX_OFFSET = 12;

function allocateTrailBuffers(
  context: WebGPUContext,
  enabled: boolean,
  numSats: number,
): TrailGpuBuffers {
  const trackedCap = TRAIL_MAX_TRACKED_SATS;
  const stride = Math.max(1, Math.ceil(numSats / trackedCap));
  const trackedCount = enabled ? Math.min(trackedCap, Math.ceil(numSats / stride)) : 0;

  const history = context.createBuffer(
    enabled ? trailHistoryBytes() : 16,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );
  if (enabled) {
    // Every ring slot starts invalid (w = -1) so trailExpand skips segments
    // the orbital compute pass hasn't written yet, instead of drawing bogus
    // ribbons through the zero-initialized default buffer content.
    const floats = trackedCap * TRAIL_HISTORY_FRAMES * 4;
    const initData = new Float32Array(floats);
    for (let i = 3; i < floats; i += 4) initData[i] = -1;
    context.writeBuffer(history, initData);
  }

  const params = context.createUniformBuffer(48);
  const paramsData = new ArrayBuffer(48);
  const u32 = new Uint32Array(paramsData);
  const f32 = new Float32Array(paramsData);
  u32[0] = enabled ? 1 : 0; // enabled
  u32[1] = stride; // stride
  u32[2] = TRAIL_HISTORY_FRAMES; // history_frames
  u32[3] = 0; // write_index
  u32[4] = trackedCount; // tracked_count
  u32[5] = TRAIL_MAX_RENDERED * TRAIL_MAX_SEGMENTS * 2; // max_vertices
  u32[6] = TRAIL_MAX_RENDERED * TRAIL_MAX_SEGMENTS * 6; // max_indices
  f32[8] = 120000.0; // max_distance_km
  f32[9] = 8.0; // ribbon_width, matches TrailConfig's cinematic default
  context.writeBuffer(params, paramsData);

  const vertices = context.createBuffer(
    enabled ? trailVertexBytes() : TRAIL_VERTEX_STRIDE_FLOATS * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  );
  const indices = context.createBuffer(
    enabled ? trailIndexBytes() : 24,
    GPUBufferUsage.STORAGE | GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  );
  const indirect = context.createBuffer(
    TRAIL_INDIRECT_BYTES,
    GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
  );
  context.writeBuffer(indirect, new Uint32Array([0, 1, 0, 0, 0]));
  const counters = context.createBuffer(
    TRAIL_COUNTERS_BYTES,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );

  return { enabled, history, params, vertices, indices, indirect, counters };
}

export function allocateSatelliteBuffers(
  context: WebGPUContext,
  config: SatelliteBufferConfig,
  sizes: SatelliteBufferSizes,
): SatelliteBufferSet {
  const { numSatellites: numSats, position, elements, extended } = sizes;

  const orbitalElements = context.createBuffer(
    elements,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );
  const extendedElements = context.createBuffer(
    extended,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );

  const positions = config.doubleBuffer
    ? {
        read: context.createStorageBuffer(position),
        write: context.createStorageBuffer(position),
        current: 'read' as const,
      }
    : context.createStorageBuffer(position);

  const uniforms = context.createUniformBuffer(BUFFER_SIZES.UNIFORM);
  const stationUniform = context.createUniformBuffer(32);
  context.writeBuffer(stationUniform, new Float32Array(8));

  const bloomUniforms = {
    horizontal: context.createUniformBuffer(BUFFER_SIZES.BLOOM_UNIFORM),
    vertical: context.createUniformBuffer(BUFFER_SIZES.BLOOM_UNIFORM),
  };

  const beams = context.createBuffer(
    MAX_BEAMS * 32,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );
  const beamParams = context.createUniformBuffer(256);
  context.writeBuffer(beamParams, new Float32Array(64));

  const patternParams = context.createUniformBuffer(16);
  const patternParamsData = new ArrayBuffer(16);
  const ppU32 = new Uint32Array(patternParamsData);
  const ppF32 = new Float32Array(patternParamsData);
  ppU32[0] = 0;
  ppF32[1] = 0;
  ppF32[2] = 0;
  ppU32[3] = 0;
  context.writeBuffer(patternParams, patternParamsData);

  const colors = context.createBuffer(numSats * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
  const colorData = new Uint32Array(numSats);
  colorData.fill(0xffffffff);
  context.writeBuffer(colors, colorData);

  // Smile V2 sat_output: one packed rgba8unorm u32 per satellite (written by
  // pack4x8unorm in the compute shader). Starts zeroed.
  const animScratch = context.createBuffer(
    numSats * ANIM_SCRATCH_BYTES_PER_SAT,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );

  const smileV2Uniforms = context.createUniformBuffer(96);
  context.writeBuffer(smileV2Uniforms, new Float32Array(24));

  const trail = allocateTrailBuffers(context, config.trailHistory, numSats);

  const groupIds = context.createBuffer(
    numSats * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );
  const groupParams = context.createUniformBuffer(GROUP_PARAMS_UNIFORM_SIZE);
  const islLinks = context.createBuffer(
    MAX_ISL_LINKS * 32,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );
  const islParams = context.createUniformBuffer(ISL_PARAM_BYTES);
  context.writeBuffer(islParams, new Float32Array(ISL_PARAM_BYTES / 4));
  const activeFrom = context.createBuffer(
    Math.ceil(numSats / 2) * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );
  context.writeBuffer(activeFrom, new Uint32Array(Math.ceil(numSats / 2)));
  const sgp4Elements = context.createBuffer(
    sgp4GpuBufferBytes(numSats),
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );
  context.writeBuffer(sgp4Elements, new Float32Array(SGP4_GPU_HEADER_FLOATS));
  const growthParams = context.createUniformBuffer(16);
  context.writeBuffer(growthParams, new Uint32Array(4));

  console.log(
    `[SatelliteGPUBuffer] Color buffer: ${((numSats * 4) / 1024 / 1024).toFixed(2)} MB (rgba8unorm)`,
  );
  console.log(
    `[SatelliteGPUBuffer] Anim scratch: ${((numSats * ANIM_SCRATCH_BYTES_PER_SAT) / 1024 / 1024).toFixed(2)} MB (Smile V2 output, rgba8)`,
  );
  console.log(
    trail.enabled
      ? `[SatelliteGPUBuffer] Trail buffers: ${((trail.history.size + trail.vertices.size + trail.indices.size) / 1024 / 1024).toFixed(2)} MB (${TRAIL_MAX_TRACKED_SATS} tracked × ${TRAIL_HISTORY_FRAMES} frames)`
      : '[SatelliteGPUBuffer] Trail buffers: placeholder (trail history is cinematic-only)',
  );
  console.log(
    `[SatelliteGPUBuffer] Group IDs buffer: ${((numSats * 4) / 1024 / 1024).toFixed(2)} MB`,
  );
  console.log(
    `[SatelliteGPUBuffer] ISL links: ${((MAX_ISL_LINKS * 32) / 1024 / 1024).toFixed(2)} MB (≤128k fibers)`,
  );
  console.log(
    `[SatelliteGPUBuffer] Extended elements buffer: ${(extended / 1024 / 1024).toFixed(2)} MB (Keplerian / shell)`,
  );

  return {
    orbitalElements,
    extendedElements,
    positions,
    uniforms,
    stationUniform,
    bloomUniforms,
    beams,
    beamParams,
    patternParams,
    colors,
    animScratch,
    smileV2Uniforms,
    trail,
    groupIds,
    groupParams,
    islLinks,
    islParams,
    activeFrom,
    growthParams,
    sgp4Elements,
  };
}

export function destroySatelliteBuffers(buffers: SatelliteBufferSet): void {
  buffers.orbitalElements.destroy();
  buffers.extendedElements.destroy();
  buffers.uniforms.destroy();
  buffers.stationUniform.destroy();
  buffers.bloomUniforms.horizontal.destroy();
  buffers.bloomUniforms.vertical.destroy();
  buffers.beams.destroy();
  buffers.beamParams.destroy();
  buffers.patternParams.destroy();
  buffers.colors.destroy();
  buffers.animScratch.destroy();
  buffers.smileV2Uniforms.destroy();
  buffers.trail.history.destroy();
  buffers.trail.params.destroy();
  buffers.trail.vertices.destroy();
  buffers.trail.indices.destroy();
  buffers.trail.indirect.destroy();
  buffers.trail.counters.destroy();
  buffers.groupIds.destroy();
  buffers.groupParams.destroy();
  buffers.islLinks.destroy();
  buffers.islParams.destroy();
  buffers.activeFrom.destroy();
  buffers.growthParams.destroy();
  buffers.sgp4Elements.destroy();
  if (isBufferPair(buffers.positions)) {
    buffers.positions.read.destroy();
    buffers.positions.write.destroy();
  } else {
    buffers.positions.destroy();
  }
}

export function memoryUsageBytes(
  sizes: SatelliteBufferSizes,
  config: SatelliteBufferConfig,
  initialized: boolean,
): number {
  return initialized ? calculateSatelliteBufferBudget(sizes.numSatellites, config).total : 0;
}
