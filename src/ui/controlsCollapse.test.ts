import { describe, expect, it } from 'vitest';
import { SHORT_VIEWPORT_PX, resolveInitialCollapsed } from '@/ui/controlsCollapse.js';

describe('resolveInitialCollapsed', () => {
  it('keeps a saved choice over the viewport size', () => {
    expect(resolveInitialCollapsed('1', 1200)).toBe(true);
    expect(resolveInitialCollapsed('0', 400)).toBe(false);
  });

  it('starts collapsed only on a short viewport when nothing was saved', () => {
    expect(resolveInitialCollapsed(null, SHORT_VIEWPORT_PX - 1)).toBe(true);
    expect(resolveInitialCollapsed(null, SHORT_VIEWPORT_PX)).toBe(false);
    expect(resolveInitialCollapsed(null, 594)).toBe(true);
    expect(resolveInitialCollapsed(null, 1080)).toBe(false);
  });

  it('ignores a corrupt saved value', () => {
    expect(resolveInitialCollapsed('maybe', 1080)).toBe(false);
    expect(resolveInitialCollapsed('', 594)).toBe(true);
  });
});
