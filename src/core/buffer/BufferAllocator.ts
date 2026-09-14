import type { WebGPUContext } from '@/core/WebGPUContext.js';
import { BUFFER_SIZES } from '@/types/constants.js';
import { GROUP_PARAMS_UNIFORM_SIZE } from '@/data/ConstellationGroups.js';
import { ISL_PARAM_BYTES, MAX_ISL_LINKS } from '@/types/isl.js';
import {
  MAX_BEAMS,
  MAX_SAFE_BUFFER_SIZE,
  WARNING_BUFFER_THRESHOLD,
  isBufferPair,
  type SatelliteBufferConfig,
  type SatelliteBufferSet,
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
/** Trail history frames × vec4f, allocated only when `trailHistory` is on. */
export const TRAIL_HISTORY_FRAMES = 2;

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
 * - Trails:     32 MB (2 frames × vec4f) — cinematic only (`trailHistory`)
 * - Group IDs:   4 MB
 * - ISL links:   4 MB (128k × 32 bytes)
 * - ActiveFrom:  2 MB (packed u16, ceil(n/2) × 4 bytes)
 * - SGP4 GPU:  <1 MB (near-earth mean elements, ≤16,384 TLE slots × 48 bytes)
 * - Uniforms:   <1 KB
 * Total: ~84 MB default, ~116 MB with trail history.
 *
 * doubleBuffer + trailHistory at 1M is 132 MB and exceeds the cap; ping-pong
 * positions are incompatible with a full cinematic fleet.
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
    trails: options.trailHistory ? numSats * 16 * TRAIL_HISTORY_FRAMES : 0,
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
  console.log(`  Trails:     ${mb(breakdown.trails)} MB ${breakdown.trails ? `(${numSats} × 16 × ${TRAIL_HISTORY_FRAMES} frames)` : '(off — cinematic only)'}`);
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

  // 32 MB at 1M — only the cinematic tier pays for trail history.
  const trailBuffer = config.trailHistory
    ? context.createBuffer(
        numSats * 16 * TRAIL_HISTORY_FRAMES,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      )
    : null;

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
    trailBuffer
      ? `[SatelliteGPUBuffer] Trail buffer: ${(trailBuffer.size / 1024 / 1024).toFixed(2)} MB (${TRAIL_HISTORY_FRAMES} frames)`
      : '[SatelliteGPUBuffer] Trail buffer: not allocated (trail history is cinematic-only)',
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
    trailBuffer,
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
  buffers.trailBuffer?.destroy();
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
