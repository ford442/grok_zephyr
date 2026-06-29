import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  IMAGE_TUNING_STORAGE_KEY,
  SHIPPING_IMAGE_TUNING,
  resolveImageTuning,
  saveImageTuning,
  packSatelliteVisualUniform,
} from './ImageTuning.js';

const storage = new Map<string, string>();

afterEach(() => {
  storage.clear();
  vi.unstubAllGlobals();
});

function stubLocalStorage(): void {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  });
}

describe('resolveImageTuning', () => {
  it('returns shipping defaults with no URL or storage', () => {
    stubLocalStorage();
    const tuning = resolveImageTuning('');
    expect(tuning.bloomThreshold).toBe(SHIPPING_IMAGE_TUNING.bloomThreshold);
    expect(tuning.bloomKnee).toBe(SHIPPING_IMAGE_TUNING.bloomKnee);
    expect(tuning.enforceFloors).toBe(true);
  });

  it('reads query params over stored values', () => {
    stubLocalStorage();
    saveImageTuning({ ...SHIPPING_IMAGE_TUNING, bloomThreshold: 2.0 });
    const tuning = resolveImageTuning('?bloomThreshold=1.8&satCore=0.35&dev=1');
    expect(tuning.bloomThreshold).toBe(1.8);
    expect(tuning.satCoreOuter).toBe(0.35);
    expect(tuning.enforceFloors).toBe(false);
  });

  it('persists slider values to localStorage', () => {
    stubLocalStorage();
    saveImageTuning({ ...SHIPPING_IMAGE_TUNING, bloomIntensity: 1.2 });
    expect(storage.get(IMAGE_TUNING_STORAGE_KEY)).toContain('"bloomIntensity":1.2');
  });
});

describe('packSatelliteVisualUniform', () => {
  it('derives halo edges from core settings', () => {
    const packed = packSatelliteVisualUniform(SHIPPING_IMAGE_TUNING);
    expect(packed[0]).toBeCloseTo(0.4);
    expect(packed[1]).toBeCloseTo(0.1);
    expect(packed[2]).toBeCloseTo(0.5);
    expect(packed[4]).toBeCloseTo(0.2);
    expect(packed[5]).toBeCloseTo(2.5);
    expect(packed[6]).toBeCloseTo(150_000);
  });
});
