/**
 * Earth photometric maps — KTX2 (ETC1S) fetch, Basis transcode, GPU upload.
 *
 * The maps are loaded once, before the scene bind groups are built, so the
 * cached render bundle never has to be invalidated for a late texture swap.
 * When a tier is 'off' — or anything fails — every binding gets a 1x1
 * placeholder and `flags` stays 0, which drives the shader down its original
 * procedural path.
 */

import type { WebGPUContext } from '@/core/WebGPUContext.js';
import { earthMapPlan, type EarthMapTier } from './EarthMaps.js';

/** Basis `transcoder_texture_format` values (see basis_universal webgl sample). */
const TRANSCODER_FORMAT = {
  ETC2_RGBA: 1,
  BC7_M5: 7,
  ASTC_4x4: 10,
  RGBA32: 13,
} as const;

interface TargetFormat {
  transcoderFormat: number;
  gpuFormat: GPUTextureFormat;
  /** Bytes per 4x4 block, or bytes per texel when `blockSize` is 1. */
  bytesPerBlock: number;
  blockSize: number;
}

export const EARTH_MAP_FLAG_ALBEDO = 1;
export const EARTH_MAP_FLAG_NIGHT = 2;
export const EARTH_MAP_FLAG_CLOUDS = 4;

export interface EarthTextureResources {
  albedo: GPUTexture;
  night: GPUTexture;
  clouds: GPUTexture;
  albedoView: GPUTextureView;
  nightView: GPUTextureView;
  cloudsView: GPUTextureView;
  sampler: GPUSampler;
  /** EARTH_MAP_FLAG_* bitfield of the maps that actually loaded. */
  flags: number;
  /** GPU format the maps were transcoded into ('none' when all placeholders). */
  gpuFormat: GPUTextureFormat | 'none';
  /** Total texture memory including mips, for docs/GPU_CAPABILITIES.md. */
  bytes: number;
  destroy(): void;
}

interface BasisKtx2File {
  isValid(): boolean;
  isETC1S(): boolean;
  isUASTC(): boolean;
  getWidth(): number;
  getHeight(): number;
  getLevels(): number;
  getHasAlpha(): boolean;
  startTranscoding(): boolean;
  getImageLevelInfo(
    mip: number,
    layer: number,
    face: number,
  ): { origWidth: number; origHeight: number; width: number; height: number };
  getImageTranscodedSizeInBytes(mip: number, layer: number, face: number, format: number): number;
  transcodeImage(
    dst: Uint8Array,
    mip: number,
    layer: number,
    face: number,
    format: number,
    getAlphaForOpaque: number,
    channel0: number,
    channel1: number,
  ): number;
  close(): void;
  delete(): void;
}

interface BasisModule {
  initializeBasis(): void;
  KTX2File: new (data: Uint8Array) => BasisKtx2File;
}

type BasisFactory = (opts: Record<string, unknown>) => Promise<BasisModule>;

let basisModulePromise: Promise<BasisModule> | null = null;

function assetUrl(path: string): string {
  return new URL(path, window.location.href).href;
}

/**
 * Load the Basis transcoder (public/basis/). It is a UMD emscripten bundle, not
 * an ES module, so it goes in through a script tag and lands on `window.BASIS`.
 */
async function loadBasisModule(): Promise<BasisModule> {
  basisModulePromise ??= (async () => {
    const scope = window as unknown as { BASIS?: BasisFactory };
    if (!scope.BASIS) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = assetUrl('basis/basis_transcoder.js');
        script.onload = () => {
          resolve();
        };
        script.onerror = () => {
          reject(new Error('failed to load basis/basis_transcoder.js'));
        };
        document.head.appendChild(script);
      });
    }
    const factory = scope.BASIS;
    if (!factory) throw new Error('basis_transcoder.js did not define BASIS');

    const module = await factory({
      locateFile: (file: string) => assetUrl(`basis/${file}`),
    });
    module.initializeBasis();
    return module;
  })();
  return basisModulePromise;
}

/**
 * Pick the transcode target. ETC1S reaches every one of these; the rgba8
 * fallback is the "never 8K rgba8" escape hatch, which is why the high tier's
 * 4K albedo is the largest map we ship (64 MB uncompressed, 16 MB compressed).
 */
export function selectEarthMapFormat(features: ReadonlySet<string>): TargetFormat {
  if (features.has('texture-compression-bc')) {
    return {
      transcoderFormat: TRANSCODER_FORMAT.BC7_M5,
      gpuFormat: 'bc7-rgba-unorm-srgb',
      bytesPerBlock: 16,
      blockSize: 4,
    };
  }
  if (features.has('texture-compression-astc')) {
    return {
      transcoderFormat: TRANSCODER_FORMAT.ASTC_4x4,
      gpuFormat: 'astc-4x4-unorm-srgb',
      bytesPerBlock: 16,
      blockSize: 4,
    };
  }
  if (features.has('texture-compression-etc2')) {
    return {
      transcoderFormat: TRANSCODER_FORMAT.ETC2_RGBA,
      gpuFormat: 'etc2-rgba8unorm-srgb',
      bytesPerBlock: 16,
      blockSize: 4,
    };
  }
  return {
    transcoderFormat: TRANSCODER_FORMAT.RGBA32,
    gpuFormat: 'rgba8unorm-srgb',
    bytesPerBlock: 4,
    blockSize: 1,
  };
}

/**
 * Mip levels to keep. Block formats need both dimensions >= 4, and a 2:1
 * equirect hits height 2 before width 4, so the chain stops one level early.
 */
export function usableMipLevels(
  width: number,
  height: number,
  levels: number,
  blockSize: number,
): number {
  let usable = 0;
  for (let level = 0; level < levels; level++) {
    const w = Math.max(1, width >> level);
    const h = Math.max(1, height >> level);
    if (w < blockSize || h < blockSize) break;
    usable++;
  }
  return Math.max(1, usable);
}

function createPlaceholder(device: GPUDevice, label: string): GPUTexture {
  const texture = device.createTexture({
    label,
    size: [1, 1],
    format: 'rgba8unorm-srgb',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture(
    { texture },
    new Uint8Array([0, 0, 0, 255]),
    { bytesPerRow: 4 },
    { width: 1, height: 1 },
  );
  return texture;
}

interface LoadedMap {
  texture: GPUTexture;
  bytes: number;
}

async function loadMap(
  device: GPUDevice,
  basis: BasisModule,
  target: TargetFormat,
  name: string,
): Promise<LoadedMap> {
  const response = await fetch(assetUrl(`earth/${name}.ktx2`));
  if (!response.ok) throw new Error(`earth/${name}.ktx2: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());

  const file = new basis.KTX2File(bytes);
  try {
    if (!file.isValid()) throw new Error(`earth/${name}.ktx2 is not a valid KTX2 file`);
    if (!file.startTranscoding()) throw new Error(`earth/${name}.ktx2 failed to start transcoding`);

    const width = file.getWidth();
    const height = file.getHeight();
    const mipLevelCount = usableMipLevels(width, height, file.getLevels(), target.blockSize);

    const texture = device.createTexture({
      label: `earth-${name}`,
      size: [width, height],
      format: target.gpuFormat,
      mipLevelCount,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    let total = 0;
    for (let level = 0; level < mipLevelCount; level++) {
      const w = Math.max(1, width >> level);
      const h = Math.max(1, height >> level);
      const size = file.getImageTranscodedSizeInBytes(level, 0, 0, target.transcoderFormat);
      const dst = new Uint8Array(size);
      if (!file.transcodeImage(dst, level, 0, 0, target.transcoderFormat, 0, -1, -1)) {
        throw new Error(`earth/${name}.ktx2 failed to transcode mip ${level}`);
      }
      const blocksPerRow = target.blockSize === 1 ? w : Math.ceil(w / target.blockSize);
      const rows = target.blockSize === 1 ? h : Math.ceil(h / target.blockSize);
      device.queue.writeTexture(
        { texture, mipLevel: level },
        dst,
        { bytesPerRow: blocksPerRow * target.bytesPerBlock, rowsPerImage: rows },
        { width: w, height: h },
      );
      total += size;
    }
    return { texture, bytes: total };
  } finally {
    file.close();
    file.delete();
  }
}

/**
 * Load the maps for `tier`. Never throws: any failure degrades to placeholders
 * and a zero flag set, which is the procedural Earth.
 */
export async function loadEarthTextures(
  context: WebGPUContext,
  tier: EarthMapTier,
): Promise<EarthTextureResources> {
  const device = context.getDevice();
  const sampler = device.createSampler({
    label: 'earth-maps',
    // Longitude wraps, latitude does not.
    addressModeU: 'repeat',
    addressModeV: 'clamp-to-edge',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
    maxAnisotropy: 4,
  });

  const placeholders = {
    albedo: createPlaceholder(device, 'earth-albedo-placeholder'),
    night: createPlaceholder(device, 'earth-night-placeholder'),
    clouds: createPlaceholder(device, 'earth-clouds-placeholder'),
  };

  const loaded: Partial<Record<'albedo' | 'night' | 'clouds', GPUTexture>> = {};
  let flags = 0;
  let bytes = 0;
  let gpuFormat: GPUTextureFormat | 'none' = 'none';

  const plan = earthMapPlan(tier);
  if (plan.albedo) {
    try {
      const basis = await loadBasisModule();
      const target = selectEarthMapFormat(device.features);
      gpuFormat = target.gpuFormat;

      // No block format means every plate costs 4x. Clamp to the 1K albedo and
      // 1K lights and drop the cloud sheet rather than spending ~65 MB of VRAM
      // on an uncompressed 4K plate.
      const resolved =
        target.blockSize === 1
          ? {
              ...plan,
              albedo: 'albedo_1k',
              night: plan.night ? 'night_1k' : null,
              clouds: null,
            }
          : plan;

      const slots: [keyof typeof placeholders, string, number][] = [
        ['albedo', resolved.albedo ?? 'albedo_1k', EARTH_MAP_FLAG_ALBEDO],
        ...(resolved.night
          ? ([['night', resolved.night, EARTH_MAP_FLAG_NIGHT]] as [
              keyof typeof placeholders,
              string,
              number,
            ][])
          : []),
        ...(resolved.clouds
          ? ([['clouds', resolved.clouds, EARTH_MAP_FLAG_CLOUDS]] as [
              keyof typeof placeholders,
              string,
              number,
            ][])
          : []),
      ];

      for (const [slot, name, flag] of slots) {
        try {
          const map = await loadMap(device, basis, target, name);
          loaded[slot] = map.texture;
          bytes += map.bytes;
          flags |= flag;
        } catch (error) {
          // One missing layer must not take the others down: a failed night
          // map just means the FBM city lights stay on.
          console.warn(`[EarthTextures] ${name} unavailable:`, error);
        }
      }
      console.log(
        `[EarthTextures] tier=${tier} format=${gpuFormat} ` +
          `flags=0b${flags.toString(2).padStart(3, '0')} ${(bytes / (1024 * 1024)).toFixed(1)} MB`,
      );
    } catch (error) {
      console.warn('[EarthTextures] transcoder unavailable, using procedural Earth:', error);
    }
  }

  if (flags === 0) gpuFormat = 'none';

  const albedo = loaded.albedo ?? placeholders.albedo;
  const night = loaded.night ?? placeholders.night;
  const clouds = loaded.clouds ?? placeholders.clouds;

  return {
    albedo,
    night,
    clouds,
    albedoView: albedo.createView(),
    nightView: night.createView(),
    cloudsView: clouds.createView(),
    sampler,
    flags,
    gpuFormat,
    bytes,
    destroy(): void {
      for (const texture of [
        placeholders.albedo,
        placeholders.night,
        placeholders.clouds,
        ...Object.values(loaded),
      ]) {
        texture.destroy();
      }
    },
  };
}
