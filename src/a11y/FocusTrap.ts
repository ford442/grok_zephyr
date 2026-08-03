/**
 * Focus containment for modal overlays.
 *
 * `OnboardingManager` focused its close button but never contained Tab, so a
 * keyboard user could tab straight out of an open modal into the controls
 * behind it. The cycling rule is a pure function so it can be tested without a
 * browser; `createFocusTrap` is the thin DOM binding over it.
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Index of the element that should receive focus next.
 *
 * Wraps in both directions, and treats "focus is currently outside the trap"
 * as a cue to jump to the appropriate end.
 */
export function nextFocusIndex(count: number, currentIndex: number, shiftKey: boolean): number {
  if (count <= 0) return -1;
  if (currentIndex < 0) return shiftKey ? count - 1 : 0;
  const step = shiftKey ? -1 : 1;
  return (currentIndex + step + count) % count;
}

/** Focusable descendants of `root`, in document order, skipping hidden ones. */
export function focusableElementsIn(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.hasAttribute('disabled') || element.getAttribute('aria-hidden') === 'true') {
      return false;
    }
    // offsetParent is null for display:none subtrees; position:fixed needs the
    // rect check as a fallback.
    return element.offsetParent !== null || element.getClientRects().length > 0;
  });
}

export interface FocusTrap {
  release: () => void;
}

/**
 * Contain Tab within `root` until released.
 *
 * Focus is restored to whatever was focused beforehand, so dismissing a modal
 * returns the user to where they were rather than to the top of the document.
 */
export function createFocusTrap(root: HTMLElement): FocusTrap {
  const previouslyFocused = document.activeElement as HTMLElement | null;

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;
    const focusable = focusableElementsIn(root);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
    const nextIndex = nextFocusIndex(focusable.length, currentIndex, event.shiftKey);
    event.preventDefault();
    focusable[nextIndex]?.focus();
  };

  document.addEventListener('keydown', onKeyDown, true);

  return {
    release: () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previouslyFocused?.focus?.();
    },
  };
}
