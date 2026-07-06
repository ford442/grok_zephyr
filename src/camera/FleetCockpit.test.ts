import { describe, expect, it } from 'vitest';
import { OrbitalElements } from '@/core/OrbitalElements.js';
import {
  FLEET_COCKPIT,
  computeFleetCockpitTelemetry,
  countNearbySatellites,
  fleetAltitudeKm,
  fleetHeadingDeg,
  fleetOrbitalSpeedKms,
} from '@/camera/FleetCockpit.js';
import { CONSTANTS } from '@/types/constants.js';

describe('FleetCockpit', () => {
  const orbital = new OrbitalElements(4096);
  orbital.generate(42);

  it('reports plausible orbital speed and altitude for host sat', () => {
    const pos = orbital.calculatePosition(0, 100);
    const vel = orbital.calculateVelocity(0, 100);
    const speed = fleetOrbitalSpeedKms(orbital, 0);
    const alt = fleetAltitudeKm(pos);
    expect(speed).toBeGreaterThan(6);
    expect(speed).toBeLessThan(9);
    expect(alt).toBeGreaterThan(300);
    expect(alt).toBeLessThan(900);
    expect(fleetHeadingDeg(vel)).toBeGreaterThanOrEqual(0);
    expect(fleetHeadingDeg(vel)).toBeLessThan(360);
  });

  it('finds Walker neighbors within near radius', () => {
    const pos = orbital.calculatePosition(0, 0);
    const count = countNearbySatellites(orbital, 0, pos, FLEET_COCKPIT.NEAR_RADIUS_KM, 0);
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(200);
  });

  it('assembles full telemetry struct', () => {
    const t = 50;
    const pos = orbital.calculatePosition(0, t);
    const vel = orbital.calculateVelocity(0, t);
    const telem = computeFleetCockpitTelemetry(orbital, 0, pos, vel, t);
    expect(telem.nearbyCount).toBeGreaterThan(0);
    expect(telem.altitudeKm).toBeCloseTo(
      Math.hypot(pos[0], pos[1], pos[2]) - CONSTANTS.EARTH_RADIUS_KM,
      0,
    );
  });
});
