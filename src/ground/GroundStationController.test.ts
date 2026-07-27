import { describe, expect, it } from 'vitest';
import { GroundStationController } from './GroundStationController.js';
import { GROUND_STATION_STORAGE_KEY } from './GroundStation.js';

class MemoryStorage { value: string | null = null; getItem(): string | null { return this.value; } setItem(_key: string, value: string): void { this.value = value; } }
describe('GroundStationController', () => {
  it('restores persisted preset/manual state', () => {
    const storage = new MemoryStorage(); const first = new GroundStationController(storage);
    first.usePreset('Berlin');
    expect(storage.value).toContain('Berlin');
    expect(new GroundStationController(storage).active?.name).toBe('Berlin');
  });
  it('keeps geolocation session-only until explicitly saved', () => {
    const storage = new MemoryStorage(); const controller = new GroundStationController(storage);
    controller.setActive({ name: 'My Location', latitudeDeg: 1, longitudeDeg: 2, altitudeM: 0, minimumElevationDeg: 0, source: 'geolocation' }, false);
    expect(storage.value).toBeNull();
    controller.saveActive('Home');
    expect(JSON.parse(storage.value!)["active"].name).toBe('Home');
    expect(GROUND_STATION_STORAGE_KEY).toContain('.v1');
  });
});
