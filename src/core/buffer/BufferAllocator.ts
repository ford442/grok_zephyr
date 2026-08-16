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

export interface SatelliteBufferSizes {
  numSatellites: number;
  position: number;
  elements: number;
  extended: number;
}

/**
 * Budget for 1M satellites (must stay under Pascal 128 MB):
 * - Position: 16 MB (vec4<f32>)
 * - Elements: 16 MB (vec4<f32>)
 * - Extended: 32 MB (8 floats × 4 bytes)
 * - Colors: 4 MB (rgba8unorm packed)
 * - Patterns: 16 MB (Sky Strips)
 * - Beams: 2 MB (64k × 32 bytes)
 * - Trails: 32 MB (2 frames × vec4f)
 * - Group IDs: 4 MB
 * - Uniforms: ~1 KB
 * Total: ~118 MB
 */
export function calculateSatelliteBufferBudget(numSats: number): {
  total: number;
  breakdown: Record<string, number>;
} {
  const breakdown = {
    position: numSats * 16,
    elements: numSats * 16,
    extended: numSats * 32,
    colors: numSats * 4,
    patterns: numSats * 16,
    beams: MAX_BEAMS * 32,
    trails: numSats * 16 * 2,
    groupIds: numSats * 4,
    isl: MAX_ISL_LINKS * 32,
    activeFrom: Math.ceil(numSats / 2) * 4,
    uniforms:
      256 + 32 + 16 + 16 + 64 + 32 + 48 + 96 + GROUP_PARAMS_UNIFORM_SIZE + ISL_PARAM_BYTES,
  };
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { total, breakdown };
}

export function logBufferBudget(numSats: number, total: number, breakdown: Record<string, number>): void {
  const mb = (n: number) => (n / 1024 / 1024).toFixed(2);
  console.log(`[Buffer Size Debug] Breakdown for ${numSats.toLocaleString()} satellites:`);
  console.log(`  Position:   ${mb(breakdown.position)} MB (${numSats} × 16 bytes)`);
  console.log(`  Elements:   ${mb(breakdown.elements)} MB (${numSats} × 16 bytes)`);
  console.log(`  Extended:   ${mb(breakdown.extended)} MB (${numSats} × 32 bytes, COMPACT)`);
  console.log(`  Colors:     ${mb(breakdown.colors)} MB (${numSats} × 4 bytes)`);
  console.log(`  Patterns:   ${mb(breakdown.patterns)} MB (${numSats} × 16 bytes)`);
  console.log(`  Beams:      ${mb(breakdown.beams)} MB (${MAX_BEAMS} × 32 bytes)`);
  console.log(`  Trails:     ${mb(breakdown.trails)} MB (${numSats} × 16 × 2 frames, REDUCED)`);
  console.log(`  Group IDs:  ${mb(breakdown.groupIds)} MB`);
  console.log(`  ISL links:  ${mb(breakdown.isl)} MB (${MAX_ISL_LINKS} × 32 bytes)`);
  console.log(`  ActiveFrom: ${mb(breakdown.activeFrom)} MB (${numSats} × 4 bytes)`);
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

  const patterns = context.createBuffer(
    numSats * 16,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );
  const patternData = new Float32Array(numSats * 4);
  for (let i = 0; i < numSats; i++) {
    const idx = i * 4;
    patternData[idx + 0] = 0.7 + Math.random() * 0.3;
    patternData[idx + 1] = 0;
    patternData[idx + 2] = (i % 1000) * 0.01;
    patternData[idx + 3] = 0.8 + Math.random() * 0.4;
  }
  context.writeBuffer(patterns, patternData);

  const skyStripUniforms = context.createUniformBuffer(48);
  const skyStripUniformsData = new Float32Array(12);
  skyStripUniformsData[3] = 120;
  skyStripUniformsData[4] = 0.8;
  skyStripUniformsData[5] = 1.0;
  skyStripUniformsData[6] = 15;
  skyStripUniformsData[7] = 0.1;
  context.writeBuffer(skyStripUniforms, skyStripUniformsData);

  const smileV2Uniforms = context.createUniformBuffer(96);
  context.writeBuffer(smileV2Uniforms, new Float32Array(24));

  const trailBuffer = context.createBuffer(
    numSats * 16 * 2,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );
  context.writeBuffer(trailBuffer, new Float32Array(numSats * 4 * 2));

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
  const growthParams = context.createUniformBuffer(16);
  context.writeBuffer(growthParams, new Uint32Array(4));

  console.log(
    `[SatelliteGPUBuffer] Color buffer: ${((numSats * 4) / 1024 / 1024).toFixed(2)} MB (rgba8unorm)`,
  );
  console.log(
    `[SatelliteGPUBuffer] Pattern buffer: ${((numSats * 16) / 1024 / 1024).toFixed(2)} MB (Sky Strips)`,
  );
  console.log(
    `[SatelliteGPUBuffer] Trail buffer: ${((numSats * 16 * 2) / 1024 / 1024).toFixed(2)} MB (2 frames)`,
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
    patterns,
    skyStripUniforms,
    smileV2Uniforms,
    trailBuffer,
    groupIds,
    groupParams,
    islLinks,
    islParams,
    activeFrom,
    growthParams,
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
  buffers.patterns.destroy();
  buffers.skyStripUniforms.destroy();
  buffers.smileV2Uniforms.destroy();
  buffers.trailBuffer.destroy();
  buffers.groupIds.destroy();
  buffers.groupParams.destroy();
  buffers.islLinks.destroy();
  buffers.islParams.destroy();
  buffers.activeFrom.destroy();
  buffers.growthParams.destroy();
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
  const { numSatellites: numSats, position, elements, extended } = sizes;
  let total =
    elements +
    extended +
    BUFFER_SIZES.UNIFORM +
    32 +
    BUFFER_SIZES.BLOOM_UNIFORM * 2 +
    (config.doubleBuffer ? position * 2 : position);
  if (initialized) {
    total +=
      MAX_BEAMS * 32 +
      16 +
      16 +
      numSats * 4 +
      numSats * 16 +
      48 +
      96 +
      numSats * 16 * 2 +
      numSats * 4 +
      GROUP_PARAMS_UNIFORM_SIZE +
      MAX_ISL_LINKS * 32 +
      ISL_PARAM_BYTES +
      Math.ceil(numSats / 2) * 4;
  }
  return total;
}
