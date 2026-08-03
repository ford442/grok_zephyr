/**
 * Keyboard shortcut model.
 *
 * Resolution is a pure function of the event so the whole map can be tested
 * without a DOM, and so the "don't steal keys from text entry" rule lives in
 * exactly one place rather than being re-derived at each call site.
 */

import type { ViewMode } from '@/types/index.js';

export type ShortcutAction =
  | { kind: 'view'; mode: ViewMode }
  | { kind: 'help-toggle' }
  | { kind: 'help-close' };

/** The number-key order shown in the shortcut overlay. */
export const VIEW_SHORTCUTS: readonly { key: string; mode: ViewMode; label: string }[] = [
  { key: '1', mode: 'horizon-720', label: '720km Horizon' },
  { key: '2', mode: 'god', label: 'God View' },
  { key: '3', mode: 'sat-pov', label: 'Fleet POV' },
  { key: '4', mode: 'ground', label: 'Ground View' },
  { key: '5', mode: 'moon', label: 'Moon View' },
  { key: '6', mode: 'skyline', label: 'Skyline View' },
];

/** Shape of the parts of a KeyboardEvent that matter here. */
export interface ShortcutEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
  target?: EventTarget | null;
}

/**
 * True when the event came from somewhere the user is entering text, in which
 * case shortcuts must not fire.
 */
export function isTextEntryTarget(target: EventTarget | null | undefined): boolean {
  if (!target || typeof target !== 'object') return false;
  const element = target as Partial<HTMLElement> & { tagName?: string };
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Map an event to an action, or null when nothing should happen.
 *
 * Modifier chords are always left to the browser/OS, and key repeat is ignored
 * so holding a key does not fire an action repeatedly.
 */
export function resolveShortcut(
  event: ShortcutEventLike,
  options: { helpOpen?: boolean } = {},
): ShortcutAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return null;
  if (isTextEntryTarget(event.target)) return null;

  if (event.key === 'Escape') {
    return options.helpOpen ? { kind: 'help-close' } : null;
  }
  if (event.key === '?') {
    return { kind: 'help-toggle' };
  }

  const view = VIEW_SHORTCUTS.find((entry) => entry.key === event.key);
  return view ? { kind: 'view', mode: view.mode } : null;
}
