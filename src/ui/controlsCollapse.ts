/**
 * Collapsible control panel (desktop / tablet).
 *
 * The panel is a dozen groups tall; on a short viewport it can cover most of
 * the scene. `#controls-toggle` hides and shows it, and the choice is
 * remembered. Phones (≤ 767px) keep their hamburger (`setupMobileMenu`), so the
 * collapsed class only has an effect from 768px up — see base.css.
 */

export const CONTROLS_COLLAPSED_CLASS = 'controls-collapsed';
export const CONTROLS_TOGGLE_ID = 'controls-toggle';

const STORAGE_KEY = 'zephyr.controlsCollapsed';

/** Below this viewport height the panel starts collapsed unless the user chose. */
export const SHORT_VIEWPORT_PX = 640;

/** Saved choice wins; otherwise start collapsed only on a short viewport. */
export function resolveInitialCollapsed(stored: string | null, viewportHeight: number): boolean {
  if (stored === '1') return true;
  if (stored === '0') return false;
  return viewportHeight < SHORT_VIEWPORT_PX;
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(collapsed: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    // Private mode / blocked storage: the toggle still works for this page load.
  }
}

function applyCollapsed(toggle: HTMLElement | null, collapsed: boolean): void {
  document.body.classList.toggle(CONTROLS_COLLAPSED_CLASS, collapsed);
  if (!toggle) return;
  toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  toggle.setAttribute('aria-label', collapsed ? 'Show controls panel' : 'Hide controls panel');
  const label = toggle.querySelector('.controls-toggle-label');
  if (label) label.textContent = collapsed ? 'SHOW CONTROLS' : 'HIDE CONTROLS';
}

/** Collapse without touching the saved preference (used while no renderer runs). */
export function collapseControlsTemporarily(): void {
  applyCollapsed(document.getElementById(CONTROLS_TOGGLE_ID), true);
}

/** Wire `#controls-toggle`; a page without the button keeps the panel as-is. */
export function setupControlsCollapse(): void {
  const toggle = document.getElementById(CONTROLS_TOGGLE_ID);
  if (!toggle) return;

  applyCollapsed(toggle, resolveInitialCollapsed(readStored(), window.innerHeight));

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const collapsed = !document.body.classList.contains(CONTROLS_COLLAPSED_CLASS);
    applyCollapsed(toggle, collapsed);
    writeStored(collapsed);
  });
}
