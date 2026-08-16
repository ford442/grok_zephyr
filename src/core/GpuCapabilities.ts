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
    name: 'float32-filterable' as const,
    effect: 'Linear filtering of rgba32float (future HDR internals)',
    fallback: 'Stay on rgba16float bloom/HDR targets',
  },
  {
    name: 'bgra8unorm-storage' as const,
    effect: 'Storage binding on BGRA8 textures (capture / compute present)',
    fallback: 'No storage writes to bgra8unorm',
  },
] as const;

export type OptionalGpuFeature = (typeof OPTIONAL_FEATURE_CATALOG)[number]['name'];

/** Optional features we actually request. Required features stay empty. */
export const REQUESTED_OPTIONAL_FEATURES: readonly OptionalGpuFeature[] = [
  'timestamp-query',
  'shader-f16',
  'float32-filterable',
  'bgra8unorm-storage',
];

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
  float32Filterable: boolean;
}

export function snapshotAdapter(
  adapter: GPUAdapter,
  info?: GPUAdapterInfo | undefined,
): AdapterSnapshot {
  const features = new Set<string>();
  adapter.features.forEach((f) => features.add(f));
  const limits = adapter.limits as unknown as Record<string, number>;
  return {
    features,
    limits: {
      maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
      maxBufferSize: limits.maxBufferSize,
      maxComputeWorkgroupsPerDimension: limits.maxComputeWorkgroupsPerDimension,
    },
    vendor: info?.vendor,
    architecture: info?.architecture,
    device: info?.device,
    isFallbackAdapter: info?.isFallbackAdapter,
  };
}

export function selectDepthFormat(
  snapshot: AdapterSnapshot,
  quality: QualityLevel,
): DepthAttachmentFormat {
  if (snapshot.isFallbackAdapter || quality === 'low') {
    return 'depth24plus';
  }
  const maxDim = (snapshot.limits as AdapterLimitSnapshot & { maxTextureDimension2D?: number })
    .maxTextureDimension2D;
  if (typeof maxDim === 'number' && maxDim > 0 && maxDim < 8192) {
    return 'depth24plus';
  }
  return 'depth32float';
}

export function selectOptionalFeatures(snapshot: AdapterSnapshot): {
  enabled: OptionalGpuFeature[];
  missing: OptionalGpuFeature[];
} {
  const enabled: OptionalGpuFeature[] = [];
  const missing: OptionalGpuFeature[] = [];
  for (const name of REQUESTED_OPTIONAL_FEATURES) {
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
  } = {},
): GpuCapabilityProfile {
  const quality = options.quality ?? 'high';
  const fleet = resolveFleetScale({
    search: options.search ?? '',
    quality,
    adapterLimits: snapshot.limits,
  });
  const { enabled, missing } = selectOptionalFeatures(snapshot);
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
    requestedOptional: REQUESTED_OPTIONAL_FEATURES,
    enabledOptional: enabled,
    missingOptional: missing,
    shaderF16Bloom,
    timestampQuery: enabled.includes('timestamp-query'),
    float32Filterable: enabled.includes('float32-filterable'),
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
  options: { search?: string; quality?: QualityLevel } = {},
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
    case 'float32-filterable':
      return 'f32f';
    case 'bgra8unorm-storage':
      return 'bgra-store';
    default:
      return name;
  }
}

export function formatFeatureMatrixMarkdown(): string {
  const rows = OPTIONAL_FEATURE_CATALOG.map(
    (row) => `| \`${row.name}\` | ${row.effect} | ${row.fallback} |`,
  );
  return [
    '| Feature | Effect when present | Fallback |',
    '| --- | --- | --- |',
    ...rows,
    '| Depth `depth32float` | Higher precision scene depth | `depth24plus` on fallback/low/small-maxDim adapters |',
    '| HDR `rgba16float` canvas | Extended-range presentation | SDR preferred canvas format |',
  ].join('\n');
}
