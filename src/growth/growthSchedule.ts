/**
 * Launch-era schedules: when each satellite slot becomes visible.
 * Days are Unix days (utcMs / 86400000), packed as u32 for the GPU.
 */

import type { TLEData } from '@/types/index.js';
import { TLELoader } from '@/data/TLELoader.js';

/** First Starlink launch wave (approximate). */
export const GROWTH_START_MS = Date.UTC(2019, 4, 24);
/** Projected mega-constellation horizon. */
export const GROWTH_END_MS = Date.UTC(2028, 0, 1);

export const SATS_PER_LAUNCH_WAVE = 32 * 1024;
export const WAVE_SPACING_MS = 180 * 86400000;

/** Packed as u16 days since this origin (fits 2019–2070). */
export const GROWTH_DAY0_MS = Date.UTC(2018, 0, 1);

export function utcMsToUnixDay(utcMs: number): number {
  return Math.floor(utcMs / 86400000);
}

export function utcMsToGrowthDay(utcMs: number): number {
  return Math.max(0, Math.min(0xffff, utcMsToUnixDay(utcMs) - utcMsToUnixDay(GROWTH_DAY0_MS)));
}

export function unixDayToUtcMs(day: number): number {
  return day * 86400000;
}

export function parseEraParam(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12 || year < 1957 || year > 2100) return null;
  return Date.UTC(year, month - 1, 1);
}

export function formatEraLabel(utcMs: number): string {
  const d = new Date(utcMs);
  return d.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function clampEraMs(utcMs: number): number {
  return Math.min(GROWTH_END_MS, Math.max(GROWTH_START_MS, utcMs));
}

/** Procedural Walker: planes arrive in 32-plane (32,768-sat) waves every 6 months. */
export function proceduralActiveFromDay(index: number): number {
  const wave = Math.floor(index / SATS_PER_LAUNCH_WAVE);
  const ms = GROWTH_START_MS + wave * WAVE_SPACING_MS;
  return utcMsToGrowthDay(Math.min(ms, GROWTH_END_MS));
}

export function buildProceduralSchedule(count: number): Uint32Array {
  const days = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    days[i] = proceduralActiveFromDay(i);
  }
  return days;
}

/**
 * TLE sats activate at their element epoch (proxy for "on orbit").
 * Remaining Walker padding uses waves after the latest TLE epoch.
 */
export function buildTleSchedule(tles: readonly TLEData[], count: number): Uint32Array {
  const days = new Uint32Array(count);
  let latestMs = GROWTH_START_MS;
  const tleCount = Math.min(tles.length, count);

  for (let i = 0; i < tleCount; i++) {
    const epochMs = TLELoader.parseEpochMs(tles[i].line1) ?? GROWTH_START_MS;
    days[i] = utcMsToGrowthDay(epochMs);
    if (epochMs > latestMs) latestMs = epochMs;
  }

  for (let i = tleCount; i < count; i++) {
    const wave = Math.floor((i - tleCount) / SATS_PER_LAUNCH_WAVE);
    const ms = latestMs + (wave + 1) * WAVE_SPACING_MS;
    days[i] = utcMsToGrowthDay(Math.min(ms, GROWTH_END_MS));
  }
  return days;
}

export function countActiveOnOrBefore(days: Uint32Array, eraDay: number): number {
  let n = 0;
  for (let i = 0; i < days.length; i++) {
    if (days[i] <= eraDay) n++;
  }
  return n;
}
