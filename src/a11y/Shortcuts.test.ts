import { describe, expect, it } from 'vitest';
import { VIEW_SHORTCUTS, isTextEntryTarget, resolveShortcut } from './Shortcuts.js';

describe('resolveShortcut', () => {
  it('maps every number key to its view mode', () => {
    for (const entry of VIEW_SHORTCUTS) {
      expect(resolveShortcut({ key: entry.key })).toEqual({ kind: 'view', mode: entry.mode });
    }
    // All six view modes are covered, each key used once.
    expect(new Set(VIEW_SHORTCUTS.map((e) => e.key)).size).toBe(VIEW_SHORTCUTS.length);
    expect(new Set(VIEW_SHORTCUTS.map((e) => e.mode)).size).toBe(VIEW_SHORTCUTS.length);
  });

  it('toggles the help overlay on ?', () => {
    expect(resolveShortcut({ key: '?' })).toEqual({ kind: 'help-toggle' });
  });

  it('closes help on Escape only while it is open', () => {
    expect(resolveShortcut({ key: 'Escape' }, { helpOpen: true })).toEqual({ kind: 'help-close' });
    // Escape is used elsewhere (releasing focus), so don't claim it when closed.
    expect(resolveShortcut({ key: 'Escape' }, { helpOpen: false })).toBeNull();
  });

  it('never fires while the user is typing', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(resolveShortcut({ key: '1', target: { tagName } as EventTarget })).toBeNull();
    }
    expect(
      resolveShortcut({ key: '1', target: { isContentEditable: true } as EventTarget }),
    ).toBeNull();
    // A plain element is fine.
    expect(resolveShortcut({ key: '1', target: { tagName: 'DIV' } as EventTarget })).not.toBeNull();
  });

  it('leaves modifier chords and key repeat to the browser', () => {
    expect(resolveShortcut({ key: '1', ctrlKey: true })).toBeNull();
    expect(resolveShortcut({ key: '1', metaKey: true })).toBeNull();
    expect(resolveShortcut({ key: '1', altKey: true })).toBeNull();
    expect(resolveShortcut({ key: '1', repeat: true })).toBeNull();
  });

  it('ignores keys it does not own', () => {
    for (const key of ['7', '0', 'a', 'Enter', 'ArrowUp', ' ']) {
      expect(resolveShortcut({ key })).toBeNull();
    }
  });
});

describe('isTextEntryTarget', () => {
  it('handles null and non-element targets', () => {
    expect(isTextEntryTarget(null)).toBe(false);
    expect(isTextEntryTarget(undefined)).toBe(false);
    expect(isTextEntryTarget({} as EventTarget)).toBe(false);
  });
});
