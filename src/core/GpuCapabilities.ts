/**
 * WebGPU capability profile — probe adapter, pick formats/features/fleet, rank adapters.
 */

import type { QualityLevel } from '@/core/QualityPresets.js';
import {
  resolveFleetScale,
  type AdapterLimitSnapshot,
  type FleetScale,
} from '@/core/FleetScale.js';

export const OPTIONAL_FEATURE_CATALOG = [
  {
    name: 'timestamp-query' as const,
    effect: 'Per-pass GPU timestamps in the performance dashboard',
    fallback: 'CPU / rAF frame timing',
  },
  {
    name: 'shader-f16' as const,
    effect: 'Half-precision bloom downsample (cheaper post-process ALU)',
    fallback: 'f32 Kawase downsample',
  },
  {
    name: 'texture-compression-bc' as const,
    effect: 'BC7 Earth plates (albedo / night lights / clouds)',
    fallback: 'ASTC, ETC2, then uncompressed rgba8',
  },
  {
    name: 'texture-compression-etc2' as const,
    effect: 'ETC2 Earth plates on unorm-only adapters',
    fallback: 'Uncompressed rgba8 Earth plates',
  },
  {
    name: 'texture-compression-astc' as const,
    effect: 'ASTC 4x4 Earth plates (mobile / Apple GPUs)',
    fallback: 'ETC2, then uncompressed rgba8',
  },
] as const;

export type OptionalGpuFeature = (typeof OPTIONAL_FEATURE_CATALOG)[number]['name'];

/**
 * Optional features a runtime system actually binds. Required features stay empty
 * at boot; missing required names fail initialization instead of being dropped.
 *
 * The `texture-compression-*` names are deliberately absent: they are requested
 * only when `?earthmap=` selects a textured Earth, and are appended to this list
 * by bootWebGPU before the device is created. Requesting them unconditionally
 * would cost nothing on desktop but would still be a request for a feature no
 * system binds — the same rule DEFERRED_OPTIONAL_FEATURES documents.
 */
export const REQUESTED_OPTIONAL_FEATURES: readonly OptionalGpuFeature[] = [
  'timestamp-query',
  'shader-f16',
];

/**
 * Known optional features that must not be requested until a matching system
 * binds them. Adding one to {@link REQUESTED_OPTIONAL_FEATURES} requires a new
 * `requestDevice` (see `recoverContext`) — features are frozen for the device
 * lifetime.
 */
export const DEFERRED_OPTIONAL_FEATURES = [
  'float32-filterable',
  'bgra8unorm-storage',
  'subgroups',
  'timestamp-query-inside-passes',
] as const;

export type DeferredGpuFeature = (typeof DEFERRED_OPTIONAL_FEATURES)[number];

export type DepthAttachmentFormat = 'depth32float' | 'depth24plus';
export type BloomColorFormat = 'rgba16float';

export interface AdapterSnapshot {
  features: ReadonlySet<string>;
  limits: AdapterLimitSnapshot;
  vendor?: string;
  architecture?: string;
  device?: string;
  isFallbackAdapter?: boolean;
}

export interface GpuCapabilityProfile {
  vendor: string;
  architecture: string;
  powerPreference: GPUPowerPreference;
  isFallbackAdapter: boolean;
  fleet: FleetScale;
  depthFormat: DepthAttachmentFormat;
  bloomFormat: BloomColorFormat;
  hdrTargets: 'rgba16float';
  requestedOptional: readonly OptionalGpuFeature[];
  enabledOptional: OptionalGpuFeature[];
  missingOptional: OptionalGpuFeature[];
  shaderF16Bloom: boolean;
  timestampQuery: boolean;
}

export function snapshotAdapter(
  adapter: GPUAdapter,
  info?: GPUAdapterInfo | undefined,
): AdapterSnapshot {
  const features = new Set<string>();
  adapter.features.forEach((f) => features.add(f));
  const { limits } = adapter;
  return {
    features,
    limits: snapshotAdapterLimits(limits),
    vendor: info?.vendor,
    architecture: info?.architecture,
    device: info?.device,
    isFallbackAdapter: info?.isFallbackAdapter,
  };
}

export function snapshotAdapterLimits(limits: GPUSupportedLimits): AdapterLimitSnapshot {
  return {
    maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
    maxBufferSize: limits.maxBufferSize,
    maxComputeWorkgroupsPerDimension: limits.maxComputeWorkgroupsPerDimension,
    maxTextureDimension2D: limits.maxTextureDimension2D,
    maxComputeInvocationsPerWorkgroup: limits.maxComputeInvocationsPerWorkgroup,
    minStorageBufferOffsetAlignment: limits.minStorageBufferOffsetAlignment,
  };
}

/** Adapter options that request a core-defaulting adapter (not compatibility mode). */
export function gpuRequestAdapterOptions(
  powerPreference: GPUPowerPreference,
): GPURequestAdapterOptions {
  return { powerPreference, featureLevel: 'core' };
}

/** Names in `required` that the adapter does not support. Required means required. */
export function missingRequiredFeatures(
  available: ReadonlySet<string>,
  required: readonly string[],
): string[] {
  return required.filter((feature) => !available.has(feature));
}

export function selectDepthFormat(
  snapshot: AdapterSnapshot,
  quality: QualityLevel,
): DepthAttachmentFormat {
  if (snapshot.isFallbackAdapter || quality === 'low') {
    return 'depth24plus';
  }
  const maxDim = snapshot.limits.maxTextureDimension2D;
  if (typeof maxDim === 'number' && maxDim > 0 && maxDim < 8192) {
    return 'depth24plus';
  }
  return 'depth32float';
}

export function selectOptionalFeatures(
  snapshot: AdapterSnapshot,
  requested: readonly OptionalGpuFeature[] = REQUESTED_OPTIONAL_FEATURES,
): {
  enabled: OptionalGpuFeature[];
  missing: OptionalGpuFeature[];
} {
  const enabled: OptionalGpuFeature[] = [];
  const missing: OptionalGpuFeature[] = [];
  for (const name of requested) {
    if (snapshot.features.has(name)) enabled.push(name);
    else missing.push(name);
  }
  return { enabled, missing };
}

export function buildCapabilityProfile(
  snapshot: AdapterSnapshot,
  options: {
    search?: string;
    quality?: QualityLevel;
    powerPreference?: GPUPowerPreference;
    requestedOptional?: readonly OptionalGpuFeature[];
  } = {},
): GpuCapabilityProfile {
  const quality = options.quality ?? 'high';
  const fleet = resolveFleetScale({
    search: options.search ?? '',
    quality,
    adapterLimits: snapshot.limits,
  });
  const requestedOptional = options.requestedOptional ?? REQUESTED_OPTIONAL_FEATURES;
  const { enabled, missing } = selectOptionalFeatures(snapshot, requestedOptional);
  const shaderF16Bloom = enabled.includes('shader-f16');
  return {
    vendor: snapshot.vendor?.trim() || 'unknown',
    architecture: snapshot.architecture?.trim() || '',
    powerPreference: options.powerPreference ?? 'high-performance',
    isFallbackAdapter: Boolean(snapshot.isFallbackAdapter),
    fleet,
    depthFormat: selectDepthFormat(snapshot, quality),
    bloomFormat: 'rgba16float',
    hdrTargets: 'rgba16float',
    requestedOptional,
    enabledOptional: enabled,
    missingOptional: missing,
    shaderF16Bloom,
    timestampQuery: enabled.includes('timestamp-query'),
  };
}

export function scoreCapabilityProfile(profile: GpuCapabilityProfile): number {
  let score = profile.fleet.count;
  if (profile.powerPreference === 'high-performance') score += 1;
  score += profile.enabledOptional.length * 100;
  if (profile.isFallbackAdapter) score -= 50;
  return score;
}

export function chooseAdapterCandidate(
  candidates: readonly {
    preference: GPUPowerPreference;
    snapshot: AdapterSnapshot;
  }[],
  options: {
    search?: string;
    quality?: QualityLevel;
    requestedOptional?: readonly OptionalGpuFeature[];
  } = {},
): { preference: GPUPowerPreference; snapshot: AdapterSnapshot; profile: GpuCapabilityProfile } | null {
  let best: {
    preference: GPUPowerPreference;
    snapshot: AdapterSnapshot;
    profile: GpuCapabilityProfile;
    score: number;
  } | null = null;

  for (const candidate of candidates) {
    const profile = buildCapabilityProfile(candidate.snapshot, {
      ...options,
      powerPreference: candidate.preference,
    });
    if (profile.fleet.count <= 0) continue;
    const score = scoreCapabilityProfile(profile);
    if (!best || score > best.score) {
      best = { ...candidate, profile, score };
    }
  }
  return best;
}

export function adapterPowerFallbackOrder(
  preferred: GPUPowerPreference = 'high-performance',
): GPUPowerPreference[] {
  return preferred === 'low-power' ? ['low-power', 'high-performance'] : ['high-performance', 'low-power'];
}

export function formatGpuCapabilityLine(profile: GpuCapabilityProfile): string {
  const feats = profile.enabledOptional.length
    ? profile.enabledOptional.map(shortFeatureName).join('+')
    : 'none';
  const fleet = profile.fleet.count.toLocaleString();
  const reduced = profile.fleet.autoReduced ? '*' : '';
  const vendor = [profile.vendor, profile.architecture].filter(Boolean).join(' ');
  return `GPU: ${vendor} / ${feats} / ${fleet}${reduced} sats`;
}

function shortFeatureName(name: OptionalGpuFeature): string {
  switch (name) {
    case 'timestamp-query':
      return 'ts';
    case 'shader-f16':
      return 'f16';
    case 'texture-compression-bc':
      return 'bc';
    case 'texture-compression-etc2':
      return 'etc2';
    case 'texture-compression-astc':
      return 'astc';
    default:
      return name;
  }
}

export function formatFeatureMatrixMarkdown(): string {
  const requested = OPTIONAL_FEATURE_CATALOG.map(
    (row) => `| \`${row.name}\` | ${row.effect} | ${row.fallback} |`,
  );
  const deferred = DEFERRED_OPTIONAL_FEATURES.map(
    (name) => `| \`${name}\` | Deferred — not requested until a runtime system binds it | — |`,
  );
  return [
    '| Feature | Effect when present | Fallback |',
    '| --- | --- | --- |',
    ...requested,
    '| Depth `depth32float` | Higher precision scene depth | `depth24plus` on fallback/low/small-maxDim adapters |',
    '| HDR `rgba16float` canvas | Extended-range presentation | SDR preferred canvas format |',
    '',
    '| Deferred (not requested) | Why it is deferred | |',
    '| --- | --- | --- |',
    ...deferred,
  ].join('\n');
}
