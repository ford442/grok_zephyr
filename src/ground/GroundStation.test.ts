import { describe, expect, it } from 'vitest';
import { elevationDeg, footprintAngularRadius, geodeticToEcf, normalizeLongitude, stationGpuState, validateGroundStation, type GroundStation } from './GroundStation.js';

const berlin: GroundStation = { name: 'Berlin', latitudeDeg: 52.52, longitudeDeg: 13.405, altitudeM: 35, minimumElevationDeg: 0, source: 'preset' };

describe('GroundStation', () => {
  it('validates and normalizes coordinates', () => {
    expect(validateGroundStation({ ...berlin, longitudeDeg: 373.405 }).longitudeDeg).toBeCloseTo(13.405);
    expect(normalizeLongitude(-181)).toBe(179);
    expect(() => validateGroundStation({ ...berlin, latitudeDeg: 91 })).toThrow(/Latitude/);
    expect(() => validateGroundStation({ ...berlin, minimumElevationDeg: -1 })).toThrow(/elevation/);
  });

  it('produces a WGS-84 Earth-fixed position and a rotating ECI zenith', () => {
    const ecf = geodeticToEcf({ ...berlin, latitudeDeg: 0, longitudeDeg: 0, altitudeM: 0 });
    expect(ecf[0]).toBeCloseTo(6378.137, 3);
    expect(ecf[1]).toBeCloseTo(0, 6);
    const state = stationGpuState(berlin, Date.parse('2025-01-01T00:00:00Z'));
    expect(Math.hypot(...state.zenithEci)).toBeCloseTo(1, 8);
  });

  it('handles zenith and opposite-side visibility including a zero-degree horizon', () => {
    const utc = Date.parse('2025-01-01T00:00:00Z');
    const state = stationGpuState(berlin, utc);
    const overhead: [number, number, number] = state.positionEciKm.map((v, i) => v + state.zenithEci[i] * 550) as [number, number, number];
    expect(elevationDeg(berlin, overhead, utc)).toBeCloseTo(90, 5);
    expect(elevationDeg(berlin, overhead.map((v) => -v) as [number, number, number], utc)).toBeLessThan(0);
  });

  it('computes and clamps footprint angular radius', () => {
    expect(footprintAngularRadius(6371, 6921, 0)).toBeCloseTo(Math.acos(6371 / 6921));
    expect(footprintAngularRadius(6371, 6300, 0)).toBe(0);
    expect(footprintAngularRadius(6371, 6921, 90)).toBe(0);
  });
});
