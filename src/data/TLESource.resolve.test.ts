import { describe, expect, it } from 'vitest';
import {
  catalogIdFromCelesTrakShorthand,
  resolveActiveCatalogId,
  resolveCustomTLEUrl,
} from './TLESource.js';

describe('TLESource URL resolution', () => {
  it('resolves catalog shorthand from ?tle=', () => {
    expect(resolveActiveCatalogId('?tle=starlink')).toBe('starlink');
    expect(resolveActiveCatalogId('?tle=oneweb')).toBe('oneweb');
  });

  it('maps legacy CelesTrak shorthands to catalog ids when supported', () => {
    expect(catalogIdFromCelesTrakShorthand('gps')).toBeNull();
    expect(catalogIdFromCelesTrakShorthand('gnss')).toBe('gnss');
  });

  it('detects custom absolute TLE URLs', () => {
    expect(resolveCustomTLEUrl('?tle=https://example.com/tle.txt')).toBe(
      'https://example.com/tle.txt',
    );
    expect(resolveCustomTLEUrl('?tle=starlink')).toBeNull();
  });
});
