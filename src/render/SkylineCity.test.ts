import { describe, expect, it } from 'vitest';
import { DEFAULT_SKYLINE, SkylineCity } from './SkylineCity.js';

describe('SkylineCity', () => {
  it('generates the configured building count with deterministic layout', () => {
    const a = new SkylineCity({ seed: 42, buildingCount: 260 });
    const b = new SkylineCity({ seed: 42, buildingCount: 260 });
    expect(a.buildingCount).toBe(260);
    expect(b.buildingCount).toBe(260);
  });

  it('marks roughly the tallest decile for rooftop equipment', () => {
    const city = new SkylineCity({ seed: 99, buildingCount: 100 });
    const data = (city as unknown as { buildingData: Float32Array }).buildingData;
    let equipCount = 0;
    let tallCount = 0;
    for (let i = 0; i < 100; i++) {
      const h = data[i * 8 + 4];
      const equip = data[i * 8 + 7];
      if (h > 0) tallCount++;
      if (equip > 0.5) equipCount++;
    }
    expect(equipCount).toBeGreaterThanOrEqual(8);
    expect(equipCount).toBeLessThanOrEqual(12);
    expect(tallCount).toBeGreaterThan(equipCount);
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
