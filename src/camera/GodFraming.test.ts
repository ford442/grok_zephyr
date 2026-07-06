import { describe, expect, it } from 'vitest';
import {
  applyGodZoomBloomTuning,
  GOD_FRAMING,
  godZoomBloomThresholdScale,
} from '@/camera/GodFraming.js';
import { SHIPPING_IMAGE_TUNING } from '@/core/ImageTuning.js';
import { CAMERA } from '@/types/constants.js';

describe('GodFraming', () => {
  it('raises bloom threshold scale when zoomed out', () => {
    const near = godZoomBloomThresholdScale(CAMERA.GOD_VIEW_MIN_DISTANCE);
    const far = godZoomBloomThresholdScale(CAMERA.GOD_VIEW_MAX_DISTANCE);
    expect(far).toBeGreaterThan(near);
    expect(near).toBeCloseTo(GOD_FRAMING.ZOOM_BLOOM_THRESHOLD_MIN, 5);
    expect(far).toBeCloseTo(GOD_FRAMING.ZOOM_BLOOM_THRESHOLD_MAX, 5);
  });

  it('applies zoom bloom to base tuning', () => {
    const base = { ...SHIPPING_IMAGE_TUNING, bloomThreshold: 1.55 };
    const zoomed = applyGodZoomBloomTuning(base, CAMERA.GOD_VIEW_MAX_DISTANCE);
    expect(zoomed.bloomThreshold).toBeGreaterThan(base.bloomThreshold);
  });
});
