import { describe, expect, it } from 'vitest';
import { isSatActiveOnDay, packActiveFromDays } from './growthMask.js';

describe('growthMask', () => {
  it('packs two u16 launch days per u32 word', () => {
    const days = new Uint32Array([10, 20, 30]);
    const packed = packActiveFromDays(days, 3);
    expect(packed.length).toBe(2);
    expect(packed[0] & 0xffff).toBe(10);
    expect(packed[0] >>> 16).toBe(20);
    expect(packed[1] & 0xffff).toBe(30);
  });

  it('treats missing days as active when growth is on', () => {
    expect(isSatActiveOnDay(false, new Uint32Array([100]), 0, 50)).toBe(true);
    expect(isSatActiveOnDay(true, new Uint32Array([100]), 0, 50)).toBe(false);
    expect(isSatActiveOnDay(true, new Uint32Array([10]), 0, 50)).toBe(true);
    expect(isSatActiveOnDay(true, new Uint32Array([10]), 5, 50)).toBe(true);
  });
});
