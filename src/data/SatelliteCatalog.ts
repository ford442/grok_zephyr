/**
 * Per-satellite identity and search over the loaded catalog.
 */

import { TLELoader } from '@/data/TLELoader.js';
import { CONSTANTS } from '@/types/constants.js';
import { SHELL_MEAN_MOTIONS } from '@/core/OrbitalElements.js';
import type { TLEData } from '@/types/index.js';
import type { Vec3 } from '@/types/index.js';
import {
  eciPositionToLatLon,
  formatLatLon,
  orbitalPeriodSec,
  proceduralPlaneSlot,
} from '@/utils/orbitalMath.js';

export interface SatelliteIdentity {
  index: number;
  kind: 'tle' | 'procedural';
  name: string;
  noradId: number | null;
  shellIndex: number;
  plane: number | null;
  slot: number | null;
}

export interface SatelliteLiveMetadata {
  altitudeKm: number;
  inclinationDeg: number;
  periodMin: number;
  lat: number;
  lon: number;
  latLonLabel: string;
  speedKmS: number;
}

export class SatelliteCatalog {
  private identities: SatelliteIdentity[] = [];
  private tleRealCount = 0;

  rebuild(tles: readonly TLEData[], tleRealCount: number, orbitalData: Float32Array): void {
    this.tleRealCount = Math.min(tleRealCount, CONSTANTS.NUM_SATELLITES);
    this.identities = new Array(CONSTANTS.NUM_SATELLITES);

    for (let i = 0; i < CONSTANTS.NUM_SATELLITES; i++) {
      const shellIndex = (orbitalData[i * 4 + 3] >> 8) & 0xff;
      if (i < this.tleRealCount && tles[i]) {
        const tle = tles[i];
        this.identities[i] = {
          index: i,
          kind: 'tle',
          name: tle.name.trim(),
          noradId: TLELoader.parseNoradId(tle.line1),
          shellIndex,
          plane: null,
          slot: null,
        };
      } else {
        const { plane, slot } = proceduralPlaneSlot(i);
        this.identities[i] = {
          index: i,
          kind: 'procedural',
          name: `Walker ${plane}:${slot}`,
          noradId: null,
          shellIndex,
          plane,
          slot,
        };
      }
    }
  }

  getIdentity(index: number): SatelliteIdentity | null {
    if (index < 0 || index >= this.identities.length) return null;
    return this.identities[index] ?? null;
  }

  getTleRealCount(): number {
    return this.tleRealCount;
  }

  buildLiveMetadata(
    index: number,
    position: Vec3,
    simTimeSec: number,
    orbitalData: Float32Array,
    speedKmS: number,
  ): SatelliteLiveMetadata | null {
    const identity = this.getIdentity(index);
    if (!identity) return null;

    const i = index * 4;
    const inclinationRad = orbitalData[i + 1];
    const shellIndex = identity.shellIndex;
    const meanMotion = SHELL_MEAN_MOTIONS[shellIndex] ?? SHELL_MEAN_MOTIONS[1];
    const altitudeKm = Math.max(0, Math.hypot(position[0], position[1], position[2]) - 6371);
    const periodSec = orbitalPeriodSec(meanMotion);
    const { lat, lon } = eciPositionToLatLon(position, simTimeSec);

    return {
      altitudeKm,
      inclinationDeg: (inclinationRad * 180) / Math.PI,
      periodMin: periodSec / 60,
      lat,
      lon,
      latLonLabel: formatLatLon(lat, lon),
      speedKmS,
    };
  }

  /** Fuzzy search by satellite name or NORAD catalog number. */
  search(query: string, limit = 12): number[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const noradQuery = /^\d+$/.test(q) ? Number.parseInt(q, 10) : null;
    const results: Array<{ index: number; score: number }> = [];

    const searchEnd = Math.max(this.tleRealCount, 0);
    for (let i = 0; i < searchEnd; i++) {
      const id = this.identities[i];
      if (!id) continue;

      if (noradQuery !== null && id.noradId === noradQuery) {
        results.push({ index: i, score: 0 });
        continue;
      }

      const name = id.name.toLowerCase();
      if (name.includes(q)) {
        const score = name.startsWith(q) ? 1 : name.indexOf(q) + 2;
        results.push({ index: i, score });
      } else if (id.noradId !== null && String(id.noradId).includes(q)) {
        results.push({ index: i, score: 3 });
      }
    }

    results.sort((a, b) => a.score - b.score || a.index - b.index);
    return results.slice(0, limit).map((r) => r.index);
  }
}
