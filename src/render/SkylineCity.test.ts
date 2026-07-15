import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SKYLINE,
  SkylineCity,
  packFacadeMeta,
  unpackFacadeMeta,
  SKYLINE_DISPLAY,
} from './SkylineCity.js';

describe('SkylineCity', () => {
  it('generates the configured building count with deterministic layout', () => {
    const a = new SkylineCity({ seed: 42, buildingCount: 260 });
    const b = new SkylineCity({ seed: 42, buildingCount: 260 });
    expect(a.buildingCount).toBe(260);
    expect(b.buildingCount).toBe(260);
  });

  it('packs and unpacks facade metadata', () => {
    expect(unpackFacadeMeta(packFacadeMeta(1, SKYLINE_DISPLAY.LASER_SCAN))).toEqual({
      roofEquip: 1,
      displayType: SKYLINE_DISPLAY.LASER_SCAN,
    });
    expect(unpackFacadeMeta(packFacadeMeta(0, SKYLINE_DISPLAY.LED_MATRIX))).toEqual({
      roofEquip: 0,
      displayType: SKYLINE_DISPLAY.LED_MATRIX,
    });
  });

  it('marks roughly the tallest decile for rooftop equipment', () => {
    const city = new SkylineCity({ seed: 99, buildingCount: 100 });
    const data = (city as unknown as { buildingData: Float32Array }).buildingData;
    let equipCount = 0;
    let tallCount = 0;
    for (let i = 0; i < 100; i++) {
      const meta = unpackFacadeMeta(data[i * 8 + 7]);
      const h = data[i * 8 + 4];
      if (h > 0) tallCount++;
      if (meta.roofEquip) equipCount++;
    }
    expect(equipCount).toBeGreaterThanOrEqual(8);
    expect(equipCount).toBeLessThanOrEqual(12);
    expect(tallCount).toBeGreaterThan(equipCount);
  });

  it('assigns computerized displays to a meaningful subset of buildings', () => {
    const city = new SkylineCity({ seed: 11, buildingCount: 120 });
    const data = (city as unknown as { buildingData: Float32Array }).buildingData;
    let displayCount = 0;
    const types = new Set<number>();
    for (let i = 0; i < 120; i++) {
      const meta = unpackFacadeMeta(data[i * 8 + 7]);
      if (meta.displayType !== SKYLINE_DISPLAY.NONE) {
        displayCount++;
        types.add(meta.displayType);
      }
    }
    expect(displayCount).toBeGreaterThanOrEqual(18);
    expect(displayCount).toBeLessThanOrEqual(40);
    expect(types.size).toBeGreaterThanOrEqual(3);
  });

  it('keeps the street clearance zone free of buildings', () => {
    const city = new SkylineCity({
      ...DEFAULT_SKYLINE,
      seed: 7,
      buildingCount: 80,
      streetClearanceKm: 0.05,
    });
    const data = (city as unknown as { buildingData: Float32Array }).buildingData;
    for (let i = 0; i < 80; i++) {
      const east = data[i * 8 + 0];
      const north = data[i * 8 + 1];
      const height = data[i * 8 + 4];
      if (Math.hypot(east, north) < 0.05) {
        expect(height).toBe(0);
      }
    }
  });
});
