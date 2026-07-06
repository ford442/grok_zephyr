/**
 * Fleet POV cockpit telemetry and near-field helpers.
 */

import type { Vec3 } from '@/types/index.js';
import { CONSTANTS } from '@/types/constants.js';
import type { OrbitalElements } from '@/core/OrbitalElements.js';
import { SHELL_MEAN_MOTIONS, SHELL_RADII_KM } from '@/core/OrbitalElements.js';

/** Fleet POV near-field and HUD constants. */
export const FLEET_COCKPIT = {
  NEAR_LOD_KM: 50,
  NEAR_BRIGHT_BOOST: 1.4,
  NEAR_RADIUS_KM: 100,
  HOST_SATELLITE_INDEX: 0,
} as const;

export interface FleetCockpitTelemetry {
  speedKms: number;
  altitudeKm: number;
  headingDeg: number;
  nearbyCount: number;
}

/** Prograde heading in degrees (0° = +Y ECI, clockwise from above). */
export function fleetHeadingDeg(velocity: Vec3): number {
  const deg = Math.atan2(velocity[0], velocity[1]) * (180 / Math.PI);
  return ((deg % 360) + 360) % 360;
}

/** Circular-orbit speed from shell mean motion and radius (km/s). */
export function fleetOrbitalSpeedKms(orbital: OrbitalElements, hostIndex: number): number {
  const shellData = orbital.data[hostIndex * 4 + 3]!;
  const shellIndex = (shellData >> 8) & 0xff;
  const n = SHELL_MEAN_MOTIONS[shellIndex] ?? SHELL_MEAN_MOTIONS[1]!;
  const r = SHELL_RADII_KM[shellIndex] ?? SHELL_RADII_KM[1]!;
  return n * r;
}

/** Geodetic altitude above Earth surface (km). */
export function fleetAltitudeKm(hostPos: Vec3): number {
  return Math.hypot(hostPos[0], hostPos[1], hostPos[2]) - CONSTANTS.EARTH_RADIUS_KM;
}

/**
 * Count Walker neighbors within `radiusKm` of the host satellite.
 * Samples same-plane ±12 slots and ±3 adjacent planes (cheap, stable).
 */
export function countNearbySatellites(
  orbital: OrbitalElements,
  hostIndex: number,
  hostPos: Vec3,
  radiusKm: number,
  time: number,
): number {
  const { NUM_PLANES, SATELLITES_PER_PLANE } = CONSTANTS;
  const plane = Math.floor(hostIndex / SATELLITES_PER_PLANE);
  const satInPlane = hostIndex % SATELLITES_PER_PLANE;
  let count = 0;

  for (let dp = -3; dp <= 3; dp++) {
    const p = (plane + dp + NUM_PLANES) % NUM_PLANES;
    for (let ds = -12; ds <= 12; ds++) {
      if (dp === 0 && ds === 0) continue;
      const idx =
        p * SATELLITES_PER_PLANE +
        ((satInPlane + ds + SATELLITES_PER_PLANE) % SATELLITES_PER_PLANE);
      const pos = orbital.calculatePosition(idx, time);
      const d = Math.hypot(pos[0] - hostPos[0], pos[1] - hostPos[1], pos[2] - hostPos[2]);
      if (d <= radiusKm) count++;
    }
  }
  return count;
}

export function computeFleetCockpitTelemetry(
  orbital: OrbitalElements,
  hostIndex: number,
  hostPos: Vec3,
  velocityDir: Vec3,
  time: number,
): FleetCockpitTelemetry {
  return {
    speedKms: fleetOrbitalSpeedKms(orbital, hostIndex),
    altitudeKm: fleetAltitudeKm(hostPos),
    headingDeg: fleetHeadingDeg(velocityDir),
    nearbyCount: countNearbySatellites(
      orbital,
      hostIndex,
      hostPos,
      FLEET_COCKPIT.NEAR_RADIUS_KM,
      time,
    ),
  };
}
