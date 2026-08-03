import { describe, expect, it } from 'vitest';
import { nextFocusIndex } from './FocusTrap.js';

describe('nextFocusIndex', () => {
  it('advances forward and wraps at the end', () => {
    expect(nextFocusIndex(3, 0, false)).toBe(1);
    expect(nextFocusIndex(3, 1, false)).toBe(2);
    // Wrapping is the whole point: Tab on the last control must not escape.
    expect(nextFocusIndex(3, 2, false)).toBe(0);
  });

  it('advances backward and wraps at the start', () => {
    expect(nextFocusIndex(3, 2, true)).toBe(1);
    expect(nextFocusIndex(3, 1, true)).toBe(0);
    expect(nextFocusIndex(3, 0, true)).toBe(2);
  });

  it('pulls focus back in when it is currently outside the trap', () => {
    expect(nextFocusIndex(3, -1, false)).toBe(0);
    expect(nextFocusIndex(3, -1, true)).toBe(2);
  });

  it('handles a single focusable element by staying put', () => {
    expect(nextFocusIndex(1, 0, false)).toBe(0);
    expect(nextFocusIndex(1, 0, true)).toBe(0);
  });

  it('reports no target when there is nothing focusable', () => {
    expect(nextFocusIndex(0, -1, false)).toBe(-1);
    expect(nextFocusIndex(0, 0, true)).toBe(-1);
  });

  it('always returns an in-range index', () => {
    for (let count = 1; count <= 6; count++) {
      for (let current = -1; current < count; current++) {
        for (const shift of [true, false]) {
          const next = nextFocusIndex(count, current, shift);
          expect(next).toBeGreaterThanOrEqual(0);
          expect(next).toBeLessThan(count);
        }
      }
    }
  });
});
