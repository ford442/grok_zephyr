/**
 * Typed CPU packers for render uniform buffers.
 * Field order and sizes mirror the WGSL structs in src/shaders/render/postProcess/
 * and related shader modules — define offsets here once.
 */

import { UniformBufferWriter } from './uniformSchema.js';
import {
  BLOOM_COMPOSITE_UNI_LAYOUT,
  BLOOM_COMPOSITE_UNI_SCHEMA,
  KAWASE_UNI_LAYOUT,
  KAWASE_UNI_SCHEMA,
  THRESHOLD_UNI_LAYOUT,
  THRESHOLD_UNI_SCHEMA,
} from './schemas/bloom.js';

/** WGSL: ThresholdUni — bloomThreshold.ts */
export const THRESHOLD_UNI_BYTE_SIZE = THRESHOLD_UNI_LAYOUT.byteSize;

export function packThresholdUni(
  threshold: number,
  knee: number,
  enforceFloors: boolean,
): ArrayBuffer {
  return new UniformBufferWriter(THRESHOLD_UNI_SCHEMA)
    .set('threshold', threshold)
    .set('knee', knee)
    .set('enforce_floors', enforceFloors ? 1.0 : 0.0)
    .set('pad0', 0.0)
    .bytes();
}

/** WGSL: BloomCompositeUni — composite.ts */
export const BLOOM_COMPOSITE_UNI_BYTE_SIZE = BLOOM_COMPOSITE_UNI_LAYOUT.byteSize;

export function packBloomCompositeUni(
  bloomIntensity: number,
  anamorphicEnabled: boolean,
  anamorphicRatio: number,
): ArrayBuffer {
  return new UniformBufferWriter(BLOOM_COMPOSITE_UNI_SCHEMA)
    .set('bloomIntensity', bloomIntensity)
    .setU32('anamorphicEnabled', anamorphicEnabled ? 1 : 0)
    .set('anamorphicRatio', anamorphicRatio)
    .set('pad', 0.0)
    .bytes();
}

/** WGSL: TonemapUni — composite.ts */
export const TONEMAP_UNI_BYTE_SIZE = 16;

export function packTonemapUni(
  autoEnabled: boolean,
  tonemapMode: number,
  manualExposure: number,
  extendedOutput = false,
): ArrayBuffer {
  const ab = new ArrayBuffer(TONEMAP_UNI_BYTE_SIZE);
  const f32 = new Float32Array(ab);
  const u32 = new Uint32Array(ab);
  u32[0] = autoEnabled ? 1 : 0;
  u32[1] = tonemapMode;
  f32[2] = manualExposure;
  u32[3] = extendedOutput ? 1 : 0;
  return ab;
}

/** WGSL: ExposureSettings — autoExposure.ts */
export const AUTO_EXPOSURE_SETTINGS_BYTE_SIZE = 32;

export function packAutoExposureSettings(
  deltaTime: number,
  adaptationSpeed: number,
  minExposure: number,
  maxExposure: number,
  autoEnabled: boolean,
): ArrayBuffer {
  const ab = new ArrayBuffer(AUTO_EXPOSURE_SETTINGS_BYTE_SIZE);
  const f32 = new Float32Array(ab);
  const u32 = new Uint32Array(ab);
  f32[0] = deltaTime;
  f32[1] = adaptationSpeed;
  f32[2] = minExposure;
  f32[3] = maxExposure;
  u32[4] = autoEnabled ? 1 : 0;
  u32[5] = 0;
  u32[6] = 0;
  u32[7] = 0;
  return ab;
}

/** WGSL: DofUni — dofDownsample.ts / dofBlur.ts / dofComposite.ts */
export const DOF_UNI_BYTE_SIZE = 32;

export function packDofUni(
  focusDistanceKm: number,
  surfaceDistanceKm: number,
  maxBlurPx: number,
  cocScale: number,
  focusMode: number,
  depthSigma: number,
  nearPlane = 10.0,
  farPlane = 500000.0,
): ArrayBuffer {
  const ab = new ArrayBuffer(DOF_UNI_BYTE_SIZE);
  const f32 = new Float32Array(ab);
  const u32 = new Uint32Array(ab);
  f32[0] = focusDistanceKm;
  f32[1] = surfaceDistanceKm;
  f32[2] = maxBlurPx;
  f32[3] = cocScale;
  u32[4] = focusMode;
  f32[5] = depthSigma;
  f32[6] = nearPlane;
  f32[7] = farPlane;
  return ab;
}

/** WGSL: AtmosphereSettings — earth.ts */
export const ATMOSPHERE_SETTINGS_BYTE_SIZE = 16;

export function packAtmosphereSettings(
  scatteringEnabled: boolean,
  hazeStrength: number,
): ArrayBuffer {
  const ab = new ArrayBuffer(ATMOSPHERE_SETTINGS_BYTE_SIZE);
  const f32 = new Float32Array(ab);
  const u32 = new Uint32Array(ab);
  u32[0] = scatteringEnabled ? 1 : 0;
  u32[1] = 0;
  f32[2] = hazeStrength;
  f32[3] = 0.0;
  return ab;
}

/** WGSL: EarthMapSettings — render/earth.ts @group(1) @binding(4) */
export const EARTH_MAP_SETTINGS_BYTE_SIZE = 16;

export function packEarthMapSettings(
  flags: number,
  cloudSpeed: number,
  nightGain: number,
  cloudGain: number,
): ArrayBuffer {
  const ab = new ArrayBuffer(EARTH_MAP_SETTINGS_BYTE_SIZE);
  const f32 = new Float32Array(ab);
  const u32 = new Uint32Array(ab);
  u32[0] = flags >>> 0;
  f32[1] = cloudSpeed;
  f32[2] = nightGain;
  f32[3] = cloudGain;
  return ab;
}

/** WGSL: ConjunctionParams — compute/conjunction.wgsl, render/conjunction.wgsl */
export const CONJUNCTION_PARAMS_BYTE_SIZE = 32;

export function packConjunctionParams(
  enabled: boolean,
  thresholdKm: number,
  scanCount: number,
  bucketMask: number,
  bucketCapacity: number,
  maxPairs: number,
  time: number,
): ArrayBuffer {
  const ab = new ArrayBuffer(CONJUNCTION_PARAMS_BYTE_SIZE);
  const f32 = new Float32Array(ab);
  const u32 = new Uint32Array(ab);
  u32[0] = enabled ? 1 : 0;
  f32[1] = thresholdKm;
  u32[2] = scanCount >>> 0;
  u32[3] = bucketMask >>> 0;
  u32[4] = bucketCapacity >>> 0;
  u32[5] = maxPairs >>> 0;
  f32[6] = time;
  u32[7] = 0;
  return ab;
}

/** WGSL: KawaseUni — bloomDownsample.ts / bloomUpsample.ts */
export const KAWASE_UNI_BYTE_SIZE = KAWASE_UNI_LAYOUT.byteSize;

export function packKawaseUni(invWidth: number, invHeight: number): ArrayBuffer {
  return new UniformBufferWriter(KAWASE_UNI_SCHEMA)
    .set('srcTexelSize', [invWidth, invHeight])
    .set('pad', [0.0, 0.0])
    .bytes();
}

/** WGSL: MotionBlurUni — motionBlur.ts / satellites.ts */
export const MOTION_BLUR_UNI_BYTE_SIZE = 160;

export function packMotionBlurUni(
  prevViewProjection: Float32Array,
  inverseViewProjection: Float32Array,
  cameraStrength: number,
  satelliteStretch: number,
  deltaTime: number,
  tapCount: number,
  hostVelocity?: readonly [number, number, number],
): ArrayBuffer {
  const ab = new ArrayBuffer(MOTION_BLUR_UNI_BYTE_SIZE);
  const f32 = new Float32Array(ab);
  const u32 = new Uint32Array(ab);
  f32.set(prevViewProjection, 0);
  f32.set(inverseViewProjection, 16);
  f32[32] = cameraStrength;
  f32[33] = satelliteStretch;
  f32[34] = deltaTime;
  u32[35] = tapCount;
  if (hostVelocity) {
    f32[36] = hostVelocity[0];
    f32[37] = hostVelocity[1];
    f32[38] = hostVelocity[2];
  }
  return ab;
}

/** WGSL: BrushParams — compute/brush.wgsl (8 × u32 header + BRUSH_MAX_STAMPS × 32-byte stamps) */
export const BRUSH_PARAMS_BYTE_SIZE = 32 + 8 * 32;

export function packBrushParams(params: {
  mode: number;
  decaySteps: number;
  rgb: number;
  seed: number;
  stamps: readonly {
    center: readonly [number, number, number];
    radiusKm: number;
    axis: readonly [number, number, number];
    strength: number;
  }[];
}): ArrayBuffer {
  const ab = new ArrayBuffer(BRUSH_PARAMS_BYTE_SIZE);
  const f32 = new Float32Array(ab);
  const u32 = new Uint32Array(ab);
  const count = Math.min(params.stamps.length, 8);
  u32[0] = count;
  u32[1] = params.mode >>> 0;
  u32[2] = Math.min(255, Math.max(0, Math.floor(params.decaySteps)));
  u32[3] = params.rgb & 0xffffff;
  u32[4] = params.seed >>> 0;
  for (let s = 0; s < count; s++) {
    const stamp = params.stamps[s];
    const o = 8 + s * 8;
    f32[o] = stamp.center[0];
    f32[o + 1] = stamp.center[1];
    f32[o + 2] = stamp.center[2];
    f32[o + 3] = stamp.radiusKm;
    f32[o + 4] = stamp.axis[0];
    f32[o + 5] = stamp.axis[1];
    f32[o + 6] = stamp.axis[2];
    f32[o + 7] = stamp.strength;
  }
  return ab;
}
