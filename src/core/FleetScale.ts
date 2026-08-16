/**
 * Resolve constellation size once at boot.
 * Priority: ?sats= → quality preset mapping → largest power-of-two the adapter can bind.
 */

import { CONSTANTS, RENDER } from '@/types/constants.js';
import type { QualityLevel } from '@/core/QualityPresets.js';
import { MAX_BEAMS } from '@/core/buffer/bufferTypes.js';

export const FLEET_SIZE_MAX = CONSTANTS.NUM_SATELLITES;
export const FLEET_SIZE_STEPS = [16_384, 65_536, 262_144, 1_048_576] as const;

export const QUALITY_FLEET_SIZE: Record<QualityLevel, number> = {
  low: 65_536,
  balanced: 262_144,
  high: 1_048_576,
  cinematic: 1_048_576,
};

const STORAGE_KEY = 'zephyr.fleetSize';
const TRAIL_HISTORY_FRAMES = 2;

export interface AdapterLimitSnapshot {
  maxStorageBufferBindingSize?: number;
  maxBufferSize?: number;
  maxComputeWorkgroupsPerDimension?: number;
}

export interface FleetScale {
  count: number;
  requested: number;
  adapterMax: number;
  autoReduced: boolean;
  source: 'url' | 'quality' | 'adapter';
}

export interface FleetLimitRequest {
  maxStorageBufferBindingSize: number;
  maxBufferSize: number;
  maxComputeWorkgroupsPerDimension: number;
}

let active: FleetScale = {
  count: FLEET_SIZE_MAX,
  requested: FLEET_SIZE_MAX,
  adapterMax: FLEET_SIZE_MAX,
  autoReduced: false,
  source: 'quality',
};

export function getActiveFleetSize(): number {
  return active.count;
}

export function getFleetScale(): FleetScale {
  return active;
}

export function installActiveFleetScale(scale: FleetScale): FleetScale {
  active = scale;
  return active;
}

/** Reset to full constellation — tests only. */
export function resetFleetScaleForTests(): void {
  active = {
    count: FLEET_SIZE_MAX,
    requested: FLEET_SIZE_MAX,
    adapterMax: FLEET_SIZE_MAX,
    autoReduced: false,
    source: 'quality',
  };
}

export function parseSatsParam(search: string): number | null {
  const raw = new URLSearchParams(search).get('sats');
  if (!raw) return null;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < 1) return null;
  return Math.min(n, FLEET_SIZE_MAX);
}

export function fleetLimitsForCount(count: number): FleetLimitRequest {
  const storage = Math.max(count * 16, count * 32, count * 16 * TRAIL_HISTORY_FRAMES, MAX_BEAMS * 32);
  return {
    maxStorageBufferBindingSize: storage,
    maxBufferSize: storage,
    maxComputeWorkgroupsPerDimension: Math.ceil(count / RENDER.WORKGROUP_SIZE),
  };
}

export function adapterFitsFleet(limits: AdapterLimitSnapshot, count: number): boolean {
  const req = fleetLimitsForCount(count);
  const storage = limits.maxStorageBufferBindingSize;
  const buffer = limits.maxBufferSize;
  const groups = limits.maxComputeWorkgroupsPerDimension;
  if (storage === undefined || storage < req.maxStorageBufferBindingSize) return false;
  if (buffer === undefined || buffer < req.maxBufferSize) return false;
  if (groups === undefined || groups < req.maxComputeWorkgroupsPerDimension) return false;
  return true;
}

/** Largest step (or 0) that fits adapter limits. */
export function maxFleetForAdapter(limits: AdapterLimitSnapshot): number {
  for (let i = FLEET_SIZE_STEPS.length - 1; i >= 0; i--) {
    const n = FLEET_SIZE_STEPS[i];
    if (adapterFitsFleet(limits, n)) return n;
  }
  return 0;
}

export function resolveFleetScale(options: {
  search?: string;
  quality?: QualityLevel;
  adapterLimits?: AdapterLimitSnapshot | null;
}): FleetScale {
  const search = options.search ?? '';
  const quality = options.quality ?? 'high';
  const urlSats = parseSatsParam(search);
  const qualityCount = QUALITY_FLEET_SIZE[quality] ?? FLEET_SIZE_MAX;
  const requested = urlSats ?? qualityCount;
  const source: FleetScale['source'] = urlSats !== null ? 'url' : 'quality';

  const adapterMax = options.adapterLimits
    ? maxFleetForAdapter(options.adapterLimits)
    : FLEET_SIZE_MAX;

  if (adapterMax <= 0) {
    return {
      count: 0,
      requested,
      adapterMax: 0,
      autoReduced: true,
      source: 'adapter',
    };
  }

  const count = Math.min(requested, adapterMax);
  return {
    count,
    requested,
    adapterMax,
    autoReduced: count < requested,
    source: count < requested ? 'adapter' : source,
  };
}

export function persistSuccessfulFleetSize(count: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(count));
  } catch {
    // ignore
  }
}

export function readPersistedFleetSize(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const n = parseInt(raw, 10);
    if (isNaN(n) || n < 1) return null;
    return Math.min(n, FLEET_SIZE_MAX);
  } catch {
    return null;
  }
}

export function injectFleetCount(wgsl: string, count: number = getActiveFleetSize()): string {
  return wgsl.replaceAll('1048576u', `${count}u`);
}

export function adapterLimitsFromGpuAdapter(adapter: GPUAdapter): AdapterLimitSnapshot {
  const limits = adapter.limits as unknown as Record<string, number>;
  return {
    maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
    maxBufferSize: limits.maxBufferSize,
    maxComputeWorkgroupsPerDimension: limits.maxComputeWorkgroupsPerDimension,
  };
}
