import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RENDERER_UNAVAILABLE_BANNER_ID,
  RENDERER_UNAVAILABLE_CLASS,
  isRendererUnavailable,
  lockControlsForNoRenderer,
} from '@/ui/rendererUnavailable.js';

function fakeEl() {
  const attrs = new Map<string, string>();
  return {
    id: '',
    disabled: false,
    textContent: '',
    attrs,
    setAttribute: (k: string, v: string) => attrs.set(k, v),
    querySelectorAll: () => children,
  };
}

const children = [fakeEl(), fakeEl()];

function stubDocument() {
  const classes = new Set<string>();
  const byId = new Map<string, ReturnType<typeof fakeEl>>();
  const controls = fakeEl();
  byId.set('controls', controls);
  const body = {
    classList: {
      add: (...names: string[]) => names.forEach((c) => classes.add(c)),
      toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)),
      contains: (c: string) => classes.has(c),
    },
    appendChild: (el: ReturnType<typeof fakeEl>) => byId.set(el.id, el),
  };
  vi.stubGlobal('document', {
    body,
    getElementById: (id: string) => byId.get(id) ?? null,
    createElement: () => fakeEl(),
  });
  return { controls, byId };
}

describe('rendererUnavailable', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is off until locked', () => {
    stubDocument();
    expect(isRendererUnavailable()).toBe(false);
  });

  it('makes controls inert and disabled and shows a banner', () => {
    const { controls, byId } = stubDocument();
    lockControlsForNoRenderer('Reload.');
    expect(isRendererUnavailable()).toBe(true);
    expect(controls.attrs.get('inert')).toBe('');
    expect(children.every((c) => c.disabled)).toBe(true);
    expect(byId.get(RENDERER_UNAVAILABLE_BANNER_ID)?.textContent).toContain('NO RENDERER');
    expect(RENDERER_UNAVAILABLE_CLASS).toBe('renderer-unavailable');
  });

  it('reserves room for the banner and tucks the panel away without saving that choice', () => {
    stubDocument();
    lockControlsForNoRenderer('Reload.');
    const classes = (document.body.classList as unknown as { contains: (c: string) => boolean });
    expect(classes.contains('has-status-banner')).toBe(true);
    expect(classes.contains('controls-collapsed')).toBe(true);
  });

  it('is idempotent (one banner)', () => {
    const { byId } = stubDocument();
    lockControlsForNoRenderer('a');
    const first = byId.get(RENDERER_UNAVAILABLE_BANNER_ID);
    lockControlsForNoRenderer('b');
    expect(byId.get(RENDERER_UNAVAILABLE_BANNER_ID)).toBe(first);
    expect(first?.textContent).toContain('b');
  });
});
