import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FALLBACK_BADGE_ID,
  FALLBACK_LIMITS,
  STATUS_BANNER_CLASS,
  fallbackBadgeHeadline,
  removeRendererFallbackBadge,
  showRendererFallbackBadge,
} from '@/ui/rendererFallbackBadge.js';

function fakeEl() {
  const el = {
    id: '',
    href: '',
    textContent: '',
    offsetHeight: 44,
    children: [] as unknown[],
    removed: false,
    setAttribute: () => undefined,
    replaceChildren(...nodes: unknown[]) {
      el.children = nodes;
    },
    remove() {
      el.removed = true;
    },
  };
  return el;
}

function stubDocument() {
  const byId = new Map<string, ReturnType<typeof fakeEl>>();
  const classes = new Set<string>();
  const cssVars = new Map<string, string>();
  vi.stubGlobal('window', { location: { href: 'https://x.test/?webgl2=1' } });
  vi.stubGlobal('document', {
    body: {
      classList: { add: (c: string) => classes.add(c) },
      appendChild: (el: ReturnType<typeof fakeEl>) => byId.set(el.id, el),
    },
    documentElement: { style: { setProperty: (k: string, v: string) => cssVars.set(k, v) } },
    getElementById: (id: string) => {
      const el = byId.get(id);
      return el && !el.removed ? el : null;
    },
    createElement: () => fakeEl(),
  });
  return { byId, classes, cssVars };
}

describe('rendererFallbackBadge', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('says how the fallback was selected, so it is never silent', () => {
    expect(fallbackBadgeHeadline('url-webgl2')).toContain('?webgl2=1');
    expect(fallbackBadgeHeadline('url-renderer')).toContain('?renderer=webgl');
    expect(fallbackBadgeHeadline('stored')).toContain('saved preference');
    for (const source of ['url-webgl2', 'url-renderer', 'stored'] as const) {
      expect(fallbackBadgeHeadline(source)).toContain('WEBGL2 FALLBACK');
    }
  });

  it('names what the fallback cannot do', () => {
    expect(FALLBACK_LIMITS).toMatch(/volumetric/i);
    expect(FALLBACK_LIMITS).toMatch(/J2/);
  });

  it('shows one badge, reserves HUD space for it, and can be removed', () => {
    const { byId, classes, cssVars } = stubDocument();
    const badge = showRendererFallbackBadge('url-webgl2');
    expect(byId.get(FALLBACK_BADGE_ID)).toBe(badge);
    expect(classes.has(STATUS_BANNER_CLASS)).toBe(true);
    expect(cssVars.get('--status-banner-h')).toBe('44px');

    expect(showRendererFallbackBadge('stored')).toBe(badge);

    removeRendererFallbackBadge();
    expect(badge.removed).toBe(true);
  });
});
