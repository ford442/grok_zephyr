import type { Vec3 } from '@/types/index.js';

export type GroundStationSource = 'preset' | 'manual' | 'geolocation' | 'saved';

export interface GroundStation {
  name: string;
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeM: number;
  minimumElevationDeg: number;
  source: GroundStationSource;
}

export interface GroundStationGpuState {
  positionEciKm: Vec3;
  zenithEci: Vec3;
  minimumElevationSin: number;
  active: boolean;
}

export const GROUND_STATION_STORAGE_KEY = 'grok-zephyr.ground-stations.v1';
export const EARTH_EQUATORIAL_RADIUS_KM = 6378.137;
const EARTH_FLATTENING = 1 / 298.257223563;

export const GROUND_STATION_PRESETS: readonly GroundStation[] = [
  ['Seattle', 47.6062, -122.3321],
  ['New York', 40.7128, -74.006],
  ['London', 51.5074, -0.1278],
  ['Berlin', 52.52, 13.405],
  ['Tokyo', 35.6762, 139.6503],
  ['Sydney', -33.8688, 151.2093],
].map(([name, latitudeDeg, longitudeDeg]) => ({
  name: String(name),
  latitudeDeg: Number(latitudeDeg),
  longitudeDeg: Number(longitudeDeg),
  altitudeM: 0,
  minimumElevationDeg: 0,
  source: 'preset' as const,
}));

export function normalizeLongitude(longitudeDeg: number): number {
  return ((longitudeDeg + 180) % 360 + 360) % 360 - 180;
}

export function validateGroundStation(station: GroundStation): GroundStation {
  if (!Number.isFinite(station.latitudeDeg) || station.latitudeDeg < -90 || station.latitudeDeg > 90) {
    throw new RangeError('Latitude must be between -90 and 90 degrees.');
  }
  if (!Number.isFinite(station.longitudeDeg)) throw new RangeError('Longitude must be finite.');
  if (!Number.isFinite(station.altitudeM) || station.altitudeM < -500 || station.altitudeM > 100000) {
    throw new RangeError('Altitude must be between -500 and 100000 metres.');
  }
  if (!Number.isFinite(station.minimumElevationDeg) || station.minimumElevationDeg < 0 || station.minimumElevationDeg > 90) {
    throw new RangeError('Minimum elevation must be between 0 and 90 degrees.');
  }
  const name = station.name.trim();
  if (!name) throw new RangeError('Station name is required.');
  return { ...station, name, longitudeDeg: normalizeLongitude(station.longitudeDeg) };
}

/** WGS-84 geodetic coordinates to Earth-fixed Cartesian kilometres. */
export function geodeticToEcf(station: Pick<GroundStation, 'latitudeDeg' | 'longitudeDeg' | 'altitudeM'>): Vec3 {
  const lat = station.latitudeDeg * Math.PI / 180;
  const lon = station.longitudeDeg * Math.PI / 180;
  const h = station.altitudeM / 1000;
  const e2 = EARTH_FLATTENING * (2 - EARTH_FLATTENING);
  const n = EARTH_EQUATORIAL_RADIUS_KM / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return [
    (n + h) * Math.cos(lat) * Math.cos(lon),
    (n + h) * Math.cos(lat) * Math.sin(lon),
    (n * (1 - e2) + h) * Math.sin(lat),
  ];
}

/** Greenwich mean sidereal angle, IAU-compatible approximation. */
export function gmstRadians(utcMs: number): number {
  const jd = utcMs / 86400000 + 2440587.5;
  const t = (jd - 2451545.0) / 36525;
  const deg = 280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * t * t - t * t * t / 38710000;
  return normalizeLongitude(deg) * Math.PI / 180;
}

export function rotateEcfToEci(ecf: Vec3, utcMs: number): Vec3 {
  const a = gmstRadians(utcMs);
  const c = Math.cos(a), s = Math.sin(a);
  return [c * ecf[0] - s * ecf[1], s * ecf[0] + c * ecf[1], ecf[2]];
}

export function stationGpuState(station: GroundStation | null, utcMs: number): GroundStationGpuState {
  if (!station) return { positionEciKm: [0, 0, 0], zenithEci: [0, 0, 1], minimumElevationSin: 0, active: false };
  const positionEciKm = rotateEcfToEci(geodeticToEcf(station), utcMs);
  const lat = station.latitudeDeg * Math.PI / 180;
  const lon = station.longitudeDeg * Math.PI / 180;
  const zenithEcf: Vec3 = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  return {
    positionEciKm,
    zenithEci: rotateEcfToEci(zenithEcf, utcMs),
    minimumElevationSin: Math.sin(station.minimumElevationDeg * Math.PI / 180),
    active: true,
  };
}

export function elevationDeg(station: GroundStation, satelliteEciKm: Vec3, utcMs: number): number {
  const state = stationGpuState(station, utcMs);
  const d: Vec3 = [satelliteEciKm[0] - state.positionEciKm[0], satelliteEciKm[1] - state.positionEciKm[1], satelliteEciKm[2] - state.positionEciKm[2]];
  const len = Math.hypot(...d);
  if (len === 0) return -90;
  return Math.asin(Math.max(-1, Math.min(1, (d[0] * state.zenithEci[0] + d[1] * state.zenithEci[1] + d[2] * state.zenithEci[2]) / len))) * 180 / Math.PI;
}

export function isSatelliteVisible(station: GroundStation, satelliteEciKm: Vec3, utcMs: number): boolean {
  return elevationDeg(station, satelliteEciKm, utcMs) >= station.minimumElevationDeg;
}

export function footprintAngularRadius(earthRadiusKm: number, satelliteRadiusKm: number, minimumElevationDeg: number): number {
  if (!(earthRadiusKm > 0) || satelliteRadiusKm <= earthRadiusKm) return 0;
  const e = Math.max(0, Math.min(90, minimumElevationDeg)) * Math.PI / 180;
  const arg = Math.max(-1, Math.min(1, earthRadiusKm / satelliteRadiusKm * Math.cos(e)));
  return Math.max(0, Math.acos(arg) - e);
}
