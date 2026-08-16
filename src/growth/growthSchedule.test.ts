import { describe, expect, it } from 'vitest';
import { TLELoader } from '@/data/TLELoader.js';
import {
  buildProceduralSchedule,
  buildTleSchedule,
  countActiveOnOrBefore,
  GROWTH_END_MS,
  GROWTH_START_MS,
  parseEraParam,
  SATS_PER_LAUNCH_WAVE,
  utcMsToGrowthDay,
} from './growthSchedule.js';

describe('growthSchedule', () => {
  it('parses ?era=YYYY-MM', () => {
    expect(parseEraParam('2022-06')).toBe(Date.UTC(2022, 5, 1));
    expect(parseEraParam('2022-13')).toBeNull();
    expect(parseEraParam('june')).toBeNull();
  });

  it('procedural waves increase the active count over time without reallocating', () => {
    const days = buildProceduralSchedule(SATS_PER_LAUNCH_WAVE * 3);
    const early = countActiveOnOrBefore(days, utcMsToGrowthDay(GROWTH_START_MS));
    const mid = countActiveOnOrBefore(days, utcMsToGrowthDay(Date.UTC(2022, 0, 1)));
    const late = countActiveOnOrBefore(days, utcMsToGrowthDay(GROWTH_END_MS));
    expect(early).toBe(SATS_PER_LAUNCH_WAVE);
    expect(mid).toBeGreaterThan(early);
    expect(late).toBe(days.length);
    expect(days.length).toBe(SATS_PER_LAUNCH_WAVE * 3);
  });

  it('TLE schedule uses element epochs then pads with later waves', () => {
    const line1 = '1 44713U 19074A   24356.50000000  .00001256  00000-0  11371-3 0  9991';
    const tles = TLELoader.parse(`SAT\n${line1}\n2 44713  53.0000  85.0000 0001000  50.0000 310.0000 15.06397611123456\n`);
    const days = buildTleSchedule(tles, 8);
    expect(days[0]).toBe(utcMsToGrowthDay(TLELoader.parseEpochMs(line1)!));
    expect(days[1]).toBeGreaterThan(days[0]);
  });
});

describe('TLELoader.parseEpochMs', () => {
  it('reads year and day-of-year from line 1', () => {
    const ms = TLELoader.parseEpochMs(
      '1 44713U 19074A   24356.50000000  .00001256  00000-0  11371-3 0  9991',
    );
    expect(ms).not.toBeNull();
    const d = new Date(ms!);
    expect(d.getUTCFullYear()).toBe(2024);
    expect(d.getUTCMonth()).toBe(11);
  });
});
