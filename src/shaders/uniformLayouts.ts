/**
 * Typed CPU packers for render uniform buffers.
 * Field order and sizes mirror the WGSL structs in src/shaders/render/postProcess/
 * and related shader modules — define offsets here once.
 */

/** WGSL: ThresholdUni — bloomThreshold.ts */
export const THRESHOLD_UNI_BYTE_SIZE = 16;

export function packThresholdUni(
  threshold: number,
  knee: number,
  enforceFloors: boolean,
): ArrayBuffer {
  const ab = new ArrayBuffer(THRESHOLD_UNI_BYTE_SIZE);
  const data = new Float32Array(ab);
  data[0] = threshold;
  data[1] = knee;
  data[2] = enforceFloors ? 1.0 : 0.0;
  data[3] = 0.0;
  return ab;
}

/** WGSL: BloomCompositeUni — composite.ts */
export const BLOOM_COMPOSITE_UNI_BYTE_SIZE = 16;

export function packBloomCompositeUni(
  bloomIntensity: number,
  anamorphicEnabled: boolean,
  anamorphicRatio: number,
): ArrayBuffer {
  const ab = new ArrayBuffer(BLOOM_COMPOSITE_UNI_BYTE_SIZE);
  const f32 = new Float32Array(ab);
  const u32 = new Uint32Array(ab);
  f32[0] = bloomIntensity;
  u32[1] = anamorphicEnabled ? 1 : 0;
  f32[2] = anamorphicRatio;
  f32[3] = 0.0;
  return ab;
}

/** WGSL: TonemapUni — composite.ts */
export const TONEMAP_UNI_BYTE_SIZE = 16;

export function packTonemapUni(
  autoEnabled: boolean,
  tonemapMode: number,
  manualExposure: number,
): ArrayBuffer {
  const ab = new ArrayBuffer(TONEMAP_UNI_BYTE_SIZE);
  const f32 = new Float32Array(ab);
  const u32 = new Uint32Array(ab);
  u32[0] = autoEnabled ? 1 : 0;
  u32[1] = tonemapMode;
  f32[2] = manualExposure;
  f32[3] = 0.0;
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

/** WGSL: KawaseUni — bloomDownsample.ts / bloomUpsample.ts */
export const KAWASE_UNI_BYTE_SIZE = 16;

export function packKawaseUni(invWidth: number, invHeight: number): ArrayBuffer {
  const ab = new ArrayBuffer(KAWASE_UNI_BYTE_SIZE);
  const data = new Float32Array(ab);
  data[0] = invWidth;
  data[1] = invHeight;
  data[2] = 0.0;
  data[3] = 0.0;
  return ab;
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
