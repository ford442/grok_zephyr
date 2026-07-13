/**
 * Atmosphere LUT — precomputed optical depth lookup texture
 */

import type { WebGPUContext } from '@/core/WebGPUContext.js';

export const ATMOSPHERE_LUT_WIDTH = 256;
export const ATMOSPHERE_LUT_HEIGHT = 64;
const EARTH_RADIUS_KM = 6371.0;
const ATMOSPHERE_TOP_KM = 6471.0;
const RAYLEIGH_SCALE_HEIGHT_KM = 8.0;
const MIE_SCALE_HEIGHT_KM = 1.2;

export interface AtmosphereLUTResources {
  texture: GPUTexture;
  view: GPUTextureView;
}

export function createAtmosphereLUT(context: WebGPUContext): AtmosphereLUTResources {
  const device = context.getDevice();
  const texture = device.createTexture({
    size: [ATMOSPHERE_LUT_WIDTH, ATMOSPHERE_LUT_HEIGHT],
    format: 'rg16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    label: 'Atmosphere LUT',
  });
  const view = texture.createView();

  const lut = buildAtmosphereLUT();
  const lutBytes = new Uint8Array(lut.buffer.slice(0) as ArrayBuffer);
  device.queue.writeTexture(
    { texture },
    lutBytes,
    { bytesPerRow: ATMOSPHERE_LUT_WIDTH * 4, rowsPerImage: ATMOSPHERE_LUT_HEIGHT },
    { width: ATMOSPHERE_LUT_WIDTH, height: ATMOSPHERE_LUT_HEIGHT, depthOrArrayLayers: 1 },
  );

  return { texture, view };
}

function buildAtmosphereLUT(): Uint16Array {
  const data = new Uint16Array(ATMOSPHERE_LUT_WIDTH * ATMOSPHERE_LUT_HEIGHT * 2);
  let i = 0;
  for (let y = 0; y < ATMOSPHERE_LUT_HEIGHT; y++) {
    const sunCos = ((y + 0.5) / ATMOSPHERE_LUT_HEIGHT) * 2.0 - 1.0;
    const sunAirMass = airMass(sunCos);
    for (let x = 0; x < ATMOSPHERE_LUT_WIDTH; x++) {
      const viewCos = ((x + 0.5) / ATMOSPHERE_LUT_WIDTH) * 2.0 - 1.0;
      const viewAirMass = airMass(viewCos);
      const sunWeight = 0.35 + 0.65 * Math.max(0.0, sunCos);
      const rayleighOD = Math.min(
        64.0,
        (viewAirMass * sunWeight * (ATMOSPHERE_TOP_KM - EARTH_RADIUS_KM)) /
          RAYLEIGH_SCALE_HEIGHT_KM,
      );
      const mieOD = Math.min(
        64.0,
        ((viewAirMass *
          (0.45 + 0.55 * Math.max(0.0, sunCos)) *
          (ATMOSPHERE_TOP_KM - EARTH_RADIUS_KM)) /
          MIE_SCALE_HEIGHT_KM) *
          0.075,
      );

      const rayleighWithSun = rayleighOD * (0.7 + (0.3 * Math.min(4.0, sunAirMass)) / 4.0);
      const mieWithSun = mieOD * (0.85 + (0.15 * Math.min(6.0, sunAirMass)) / 6.0);

      data[i++] = toHalfFloat(rayleighWithSun);
      data[i++] = toHalfFloat(mieWithSun);
    }
  }
  return data;
}

function airMass(cosZenith: number): number {
  const clamped = Math.max(-1.0, Math.min(1.0, cosZenith));
  if (clamped <= -0.15) return 64.0;
  const zenith = Math.acos(Math.max(clamped, -0.999));
  const zenithDeg = zenith * 57.29577951308232;
  const denom = clamped + 0.15 * Math.pow(Math.max(93.885 - zenithDeg, 1e-3), -1.253);
  return Math.min(64.0, Math.max(1.0, 1.0 / Math.max(denom, 1e-3)));
}

function toHalfFloat(value: number): number {
  if (!Number.isFinite(value)) return value < 0 ? 0xfc00 : 0x7c00;
  const sign = value < 0 ? 0x8000 : 0;
  const abs = Math.abs(value);
  if (abs === 0) return sign;
  if (abs >= 65504) return sign | 0x7bff;
  if (abs < 6.103515625e-5) {
    return sign | Math.max(0, Math.round(abs / 5.960464477539063e-8));
  }
  const exp = Math.floor(Math.log2(abs));
  const mant = abs / Math.pow(2, exp) - 1.0;
  let expBits = exp + 15;
  let mantBits = Math.round(mant * 1024);
  if (mantBits === 1024) {
    mantBits = 0;
    expBits += 1;
  }
  if (expBits >= 31) return sign | 0x7bff;
  return sign | (expBits << 10) | (mantBits & 0x3ff);
}
