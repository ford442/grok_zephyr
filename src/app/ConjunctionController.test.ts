import { describe, expect, it } from 'vitest';
import {
  CONJUNCTION_APPROXIMATE_LABEL,
  clampThreshold,
  conjunctionDisclaimer,
  conjunctionOptionalFeatures,
  formatConjunctionStatus,
  parseConjunctionParams,
} from './ConjunctionController.js';
import {
  MAX_CONJUNCTION_THRESHOLD_KM,
  MIN_CONJUNCTION_THRESHOLD_KM,
  formatConjunctionCoverage,
} from '@/types/conjunction.js';

describe('parseConjunctionParams', () => {
  it('defaults to off with no threshold override', () => {
    expect(parseConjunctionParams('')).toEqual({
      enabled: null,
      thresholdKm: null,
      density: null,
    });
    expect(parseConjunctionParams('?mode=1&preset=high')).toEqual({
      enabled: null,
      thresholdKm: null,
      density: null,
    });
  });

  it('reads ?ca=1&caKm=5', () => {
    expect(parseConjunctionParams('?ca=1&caKm=5')).toMatchObject({
      enabled: true,
      thresholdKm: 5,
    });
    expect(parseConjunctionParams('?ca=on&caKm=0.5')).toMatchObject({
      enabled: true,
      thresholdKm: 0.5,
    });
    expect(parseConjunctionParams('?ca=0')).toMatchObject({ enabled: false, thresholdKm: null });
  });

  it('reads the density overlay flag independently of the main toggle', () => {
    expect(parseConjunctionParams('?ca=1&caDensity=1').density).toBe(true);
    expect(parseConjunctionParams('?ca=1').density).toBeNull();
    expect(parseConjunctionParams('?caDensity=0').density).toBe(false);
  });

  it('clamps rather than ignores an out-of-range threshold', () => {
    // A deep link with a silly number should still show something explicable.
    expect(parseConjunctionParams('?caKm=99999').thresholdKm).toBe(MAX_CONJUNCTION_THRESHOLD_KM);
    expect(parseConjunctionParams('?caKm=-5').thresholdKm).toBe(MIN_CONJUNCTION_THRESHOLD_KM);
    expect(parseConjunctionParams('?caKm=abc').thresholdKm).toBeNull();
  });

  it('clampThreshold keeps values inside the slider range', () => {
    expect(clampThreshold(5)).toBe(5);
    expect(clampThreshold(0)).toBe(MIN_CONJUNCTION_THRESHOLD_KM);
    expect(clampThreshold(1e9)).toBe(MAX_CONJUNCTION_THRESHOLD_KM);
  });
});

describe('honest framing', () => {
  it('never claims operational collision avoidance', () => {
    const copy = [
      conjunctionDisclaimer(true),
      conjunctionDisclaimer(false),
      formatConjunctionStatus({
        enabled: true,
        pairCount: 12,
        truncated: false,
        fleetSize: 1048576,
        unavailableReason: null,
      }),
      formatConjunctionCoverage({ binned: 1048576, fleet: 1048576 }, 3.2),
    ]
      .join(' ')
      .toLowerCase();

    for (const forbidden of [
      'collision avoidance',
      'conjunction assessment',
      'operational',
      'warning issued',
      'maneuver',
      'will collide',
    ]) {
      expect(copy).not.toContain(forbidden);
    }
  });

  it('distinguishes procedural shells from SGP4-anchored orbits', () => {
    expect(conjunctionDisclaimer(false)).toMatch(/illustrative/i);
    expect(conjunctionDisclaimer(false)).toMatch(/procedural/i);

    const realism = conjunctionDisclaimer(true);
    expect(realism).toMatch(/sgp4/i);
    expect(realism).toMatch(/not conjunction-grade/i);
    // The frame caveat FRAMES.md already documents.
    expect(realism).toMatch(/teme/i);
    expect(realism).toMatch(/covariance|cdm/i);
  });
});

describe('formatConjunctionStatus', () => {
  const base = {
    enabled: true,
    pairCount: 0,
    truncated: false,
    fleetSize: 16384,
    unavailableReason: null as string | null,
  };

  it('reports the count and always marks it approximate', () => {
    const text = formatConjunctionStatus({ ...base, pairCount: 42 });
    expect(text).toContain('Close pairs: 42');
    expect(text).toContain(CONJUNCTION_APPROXIMATE_LABEL);
  });

  it('says off when disabled', () => {
    expect(formatConjunctionStatus({ ...base, enabled: false })).toBe('Close pairs: off');
  });

  it('explains why it is unavailable instead of showing a zero', () => {
    const text = formatConjunctionStatus({
      ...base,
      unavailableReason: 'needs 9.1 MB but only 0.0 MB of the 128 MB buffer budget is free',
    });
    expect(text).toContain('unavailable');
    expect(text).toContain('9.1 MB');
    expect(text).not.toContain('Close pairs: 0 ');
  });

  it('scans the whole fleet and says so, even at 1M', () => {
    const full = formatConjunctionStatus({ ...base, fleetSize: 1048576, pairCount: 7 });
    expect(full).toContain('scanned 1,048,576/1,048,576');
    expect(full).toContain(CONJUNCTION_APPROXIMATE_LABEL);
    expect(full).not.toContain('dropped');

    const small = formatConjunctionStatus({ ...base, fleetSize: 16384, pairCount: 7 });
    expect(small).toContain('scanned 16,384/16,384');
  });

  it('marks a truncated count as a floor', () => {
    const text = formatConjunctionStatus({ ...base, pairCount: 4096, truncated: true });
    expect(text).toContain('≥4,096');
  });
});

describe('formatConjunctionCoverage', () => {
  it('reports hashed satellites against the fleet and the pass time', () => {
    expect(formatConjunctionCoverage({ binned: 1048576, fleet: 1048576 }, 3.214)).toBe(
      'hashed 1,048,576/1,048,576 · 3.21 ms',
    );
    expect(formatConjunctionCoverage(null, 0)).toBe('off');
  });
});

describe('conjunctionOptionalFeatures', () => {
  it('requests subgroups only when ?ca=1 will run', () => {
    expect(conjunctionOptionalFeatures('?ca=1', 'high', false)).toEqual(['subgroups']);
    expect(conjunctionOptionalFeatures('?ca=1&caKm=5', 'cinematic', true)).toEqual(['subgroups']);
  });

  it('requests nothing when the pass is off or absent', () => {
    expect(conjunctionOptionalFeatures('', 'high', false)).toEqual([]);
    expect(conjunctionOptionalFeatures('?ca=0', 'high', false)).toEqual([]);
    expect(conjunctionOptionalFeatures('?caKm=5', 'cinematic', false)).toEqual([]);
  });

  it('requests nothing when quality forces the overlay off', () => {
    expect(conjunctionOptionalFeatures('?ca=1', 'low', false)).toEqual([]);
    expect(conjunctionOptionalFeatures('?ca=1', 'high', true)).toEqual([]);
  });
});
