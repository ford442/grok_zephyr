/**
 * "No renderer" UI state.
 *
 * When neither WebGPU nor an opted-in fallback produced a renderer, nothing
 * draws, so every control would only mutate state the user cannot see (view
 * switches, altitude 0 km, trails/audio flipping ON, the cinematic demo
 * starting). Lock the control surface and say so instead.
 *
 * The lock is permanent for the page life: recovery is a reload (the
 * compatibility overlay's Retry button).
 */

export const RENDERER_UNAVAILABLE_CLASS = 'renderer-unavailable';
export const RENDERER_UNAVAILABLE_BANNER_ID = 'renderer-unavailable-banner';

/** Containers whose descendants must not respond while there is no renderer. */
const LOCKED_CONTAINER_IDS = [
  'controls',
  'ground-preset-selector',
  'camera-controls',
  'capture-gallery',
] as const;

const FORM_CONTROL_SELECTOR = 'button, input, select, textarea';

export function isRendererUnavailable(): boolean {
  return (
    typeof document !== 'undefined' && document.body.classList.contains(RENDERER_UNAVAILABLE_CLASS)
  );
}

/**
 * Disable every control and add an always-visible banner. Idempotent.
 * `inert` blocks pointer, focus and AT access to the subtree; `disabled` /
 * `aria-disabled` keep the state explicit where `inert` is unsupported.
 */
export function lockControlsForNoRenderer(reason: string): void {
  if (typeof document === 'undefined') return;
  document.body.classList.add(RENDERER_UNAVAILABLE_CLASS);

  for (const id of LOCKED_CONTAINER_IDS) {
    const container = document.getElementById(id);
    if (!container) continue;
    container.setAttribute('inert', '');
    container.setAttribute('aria-disabled', 'true');
    container.querySelectorAll<HTMLElement>(FORM_CONTROL_SELECTOR).forEach((el) => {
      (el as HTMLButtonElement).disabled = true;
      el.setAttribute('aria-disabled', 'true');
    });
  }

  let banner = document.getElementById(RENDERER_UNAVAILABLE_BANNER_ID);
  if (!banner) {
    banner = document.createElement('div');
    banner.id = RENDERER_UNAVAILABLE_BANNER_ID;
    banner.setAttribute('role', 'alert');
    document.body.appendChild(banner);
  }
  banner.textContent = `NO RENDERER — controls inactive. ${reason}`;
}
