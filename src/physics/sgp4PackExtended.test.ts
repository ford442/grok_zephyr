import { describe, expect, it } from 'vitest';
import { packExtendedFromEciBatch } from './sgp4PackExtended.js';
import { sgp4ErrorFromFlag, sgp4ErrorLabel } from './extendedElements.js';

describe('packExtendedFromEciBatch', () => {
  it('flags decayed sats instead of converting a zero state to Keplerian', () => {
    const eci = new Float32Array(12);
    eci.set([7000, 0, 0, 0, 7.5, 0], 0);
    const errors = new Int32Array([0, 6]);
    const dest = new Float32Array(16);
    packExtendedFromEciBatch(eci, errors, dest, 0);
    expect(dest[7]).toBe(1);
    expect(dest[8]).toBe(0);
    expect(sgp4ErrorFromFlag(dest[15])).toBe(6);
    expect(sgp4ErrorLabel(6)).toMatch(/decay/i);
  });
});
