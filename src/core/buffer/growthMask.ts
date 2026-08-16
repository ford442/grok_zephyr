/**
 * Packed launch-day mask (two u16 days per u32) and growth-era uniform writes.
 */

import type { WebGPUContext } from '@/core/WebGPUContext.js';

export function packActiveFromDays(days: Uint32Array, satCount: number): Uint32Array {
  const packed = new Uint32Array(Math.ceil(satCount / 2));
  const n = Math.min(days.length, satCount);
  for (let i = 0; i < n; i++) {
    packed[i >> 1] |= (days[i] & 0xffff) << ((i & 1) * 16);
  }
  return packed;
}

export function writeGrowthEraUniform(
  context: WebGPUContext,
  growthParams: GPUBuffer,
  enabled: boolean,
  eraDay: number,
): void {
  const ab = new ArrayBuffer(16);
  const u32 = new Uint32Array(ab);
  u32[0] = eraDay >>> 0;
  u32[1] = enabled ? 1 : 0;
  context.writeBuffer(growthParams, ab);
}

export function isSatActiveOnDay(
  growthEnabled: boolean,
  activeFromDays: Uint32Array,
  index: number,
  eraDay: number,
): boolean {
  if (!growthEnabled) return true;
  const day = activeFromDays[index];
  if (day === undefined) return true;
  return day <= eraDay;
}
