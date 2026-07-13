/**
 * Grok Zephyr - TLE Loader
 *
 * Loads Two-Line Element sets from files or API.
 */

import type { TLEData } from '@/types/index.js';

export interface ParsedTLELine2 {
  inclinationDeg: number;
  raanDeg: number;
  eccentricity: number;
  argPerigeeDeg: number;
  meanAnomalyDeg: number;
  meanMotionRevPerDay: number;
  altitudeKm: number;
}

/**
 * TLE Loader
 *
 * Fetches and parses TLE data from various sources.
 */
export class TLELoader {
  /**
   * Load TLE data from a file
   */
  static async fromFile(url: string): Promise<TLEData[]> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch TLE data (${response.status} ${response.statusText})`);
    }
    const text = await response.text();
    return TLELoader.parse(text);
  }

  /**
   * Parse TLE text into structured data
   */
  static parse(text: string): TLEData[] {
    const lines = text.trim().split('\n');
    const tles: TLEData[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip comments and empty lines
      if (!line || line.startsWith('#')) continue;

      // Look for satellite name
      if (!line.startsWith('1 ') && !line.startsWith('2 ')) {
        const name = line;
        const line1 = lines[++i]?.trim();
        const line2 = lines[++i]?.trim();

        if (line1?.startsWith('1 ') && line2?.startsWith('2 ')) {
          tles.push({ name, line1, line2 });
        }
      }
    }

    return tles;
  }

  /**
   * Parse a TLE line 2 record into orbital values and derived altitude.
   * Returns null when line 2 is malformed or missing numeric fields.
   */
  static parseLine2(line2: string): ParsedTLELine2 | null {
    if (!line2?.startsWith('2 ')) return null;

    const inclinationDeg = Number.parseFloat(line2.substring(8, 16).trim());
    const raanDeg = Number.parseFloat(line2.substring(17, 25).trim());
    const eccentricityRaw = line2.substring(26, 33).trim();
    const argPerigeeDeg = Number.parseFloat(line2.substring(34, 42).trim());
    const meanAnomalyDeg = Number.parseFloat(line2.substring(43, 51).trim());
    const meanMotionRevPerDay = Number.parseFloat(line2.substring(52, 63).trim());

    const eccentricity = Number.parseFloat(`0.${eccentricityRaw}`);
    const altitudeKm = TLELoader.deriveAltitudeKmFromMeanMotion(meanMotionRevPerDay);

    if (
      !Number.isFinite(inclinationDeg) ||
      !Number.isFinite(raanDeg) ||
      !Number.isFinite(eccentricity) ||
      !Number.isFinite(argPerigeeDeg) ||
      !Number.isFinite(meanAnomalyDeg) ||
      !Number.isFinite(meanMotionRevPerDay) ||
      !Number.isFinite(altitudeKm)
    ) {
      return null;
    }

    return {
      inclinationDeg,
      raanDeg,
      eccentricity,
      argPerigeeDeg,
      meanAnomalyDeg,
      meanMotionRevPerDay,
      altitudeKm,
    };
  }

  static deriveAltitudeKmFromMeanMotion(meanMotionRevPerDay: number): number {
    const nRadPerSec = (meanMotionRevPerDay * (2 * Math.PI)) / 86400;
    const MU = 398600.4418;
    const semiMajorKm = Math.pow(MU / (nRadPerSec * nRadPerSec), 1 / 3);
    return semiMajorKm - 6371.0;
  }

  /**
   * Fetch from CelesTrak API
   */
  static async fromCelesTrak(group: string): Promise<TLEData[]> {
    const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`;
    return TLELoader.fromFile(url);
  }
}
