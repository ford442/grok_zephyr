/**
 * DOM wiring for the accessibility layer.
 *
 * Keeps the announcer, canvas description, shortcut overlay and reduced-motion
 * flag in one place. The decision logic lives in the sibling pure modules; this
 * is only the binding to the page.
 */

import { MotionPreferenceController, type MotionSetting } from './MotionPreference.js';
import { VIEW_SHORTCUTS, resolveShortcut } from './Shortcuts.js';
import { createFocusTrap, type FocusTrap } from './FocusTrap.js';

const CANVAS_DESCRIPTION =
  'Real-time 3D simulation of a satellite constellation orbiting Earth.';

export interface A11yControllerOptions {
  canvas: HTMLCanvasElement;
  /** Switch the app to a view mode by its index in VIEW_SHORTCUTS order. */
  onSelectViewMode: (index: number) => void;
  motion?: MotionPreferenceController;
}

export class A11yController {
  readonly motion: MotionPreferenceController;
  private readonly canvas: HTMLCanvasElement;
  private readonly onSelectViewMode: (index: number) => void;
  private announcer: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private overlayTrap: FocusTrap | null = null;
  private keyHandler: ((event: KeyboardEvent) => void) | null = null;

  constructor(options: A11yControllerOptions) {
    this.canvas = options.canvas;
    this.onSelectViewMode = options.onSelectViewMode;
    this.motion = options.motion ?? new MotionPreferenceController();
  }

  install(): void {
    this.describeCanvas('720km Horizon');
    this.createAnnouncer();
    this.createShortcutOverlay();
    this.bindShortcuts();

    this.applyMotionFlag(this.motion.prefersReducedMotion);
    this.motion.subscribe((reduced) => this.applyMotionFlag(reduced));
  }

  dispose(): void {
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    this.overlayTrap?.release();
    this.overlayTrap = null;
    this.motion.dispose();
  }

  get prefersReducedMotion(): boolean {
    return this.motion.prefersReducedMotion;
  }

  setMotionSetting(setting: MotionSetting): void {
    this.motion.set(setting);
  }

  /** Reflect the active view in the canvas description and announce it. */
  setViewMode(name: string): void {
    this.describeCanvas(name);
    this.announce(`${name} selected`);
  }

  private applyMotionFlag(reduced: boolean): void {
    document.documentElement.dataset.reducedMotion = reduced ? 'true' : 'false';
  }

  private describeCanvas(viewName: string): void {
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', `${viewName}. ${CANVAS_DESCRIPTION}`);
  }

  private announce(message: string): void {
    if (!this.announcer) return;
    this.announcer.textContent = message;
  }

  private createAnnouncer(): void {
    let node = document.getElementById('view-announcer');
    if (!node) {
      node = document.createElement('div');
      node.id = 'view-announcer';
      node.className = 'sr-only';
      document.body.appendChild(node);
    }
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    this.announcer = node;
  }

  private createShortcutOverlay(): void {
    if (document.getElementById('shortcut-overlay')) {
      this.overlay = document.getElementById('shortcut-overlay');
      return;
    }
    const overlay = document.createElement('div');
    overlay.id = 'shortcut-overlay';
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'shortcut-overlay-title');

    const rows = VIEW_SHORTCUTS.map(
      (entry) => `<tr><th scope="row"><kbd>${entry.key}</kbd></th><td>${entry.label}</td></tr>`,
    ).join('');

    overlay.innerHTML = `
      <div class="shortcut-overlay-content">
        <h2 id="shortcut-overlay-title">Keyboard Shortcuts</h2>
        <table>
          <caption class="sr-only">Available keyboard shortcuts</caption>
          <tbody>
            ${rows}
            <tr><th scope="row"><kbd>P</kbd></th><td>Capture PNG</td></tr>
            <tr><th scope="row"><kbd>O</kbd></th><td>Toggle orbit lock</td></tr>
            <tr><th scope="row"><kbd>?</kbd></th><td>Show or hide this list</td></tr>
            <tr><th scope="row"><kbd>Esc</kbd></th><td>Close this list</td></tr>
          </tbody>
        </table>
        <button type="button" id="shortcut-overlay-close">Close</button>
      </div>`;

    document.body.appendChild(overlay);
    overlay
      .querySelector('#shortcut-overlay-close')
      ?.addEventListener('click', () => this.closeShortcutOverlay());
    this.overlay = overlay;
  }

  private isOverlayOpen(): boolean {
    return this.overlay !== null && !this.overlay.hidden;
  }

  private openShortcutOverlay(): void {
    if (!this.overlay || this.isOverlayOpen()) return;
    this.overlay.hidden = false;
    this.overlayTrap = createFocusTrap(this.overlay);
    this.overlay.querySelector<HTMLElement>('#shortcut-overlay-close')?.focus();
  }

  private closeShortcutOverlay(): void {
    if (!this.overlay || !this.isOverlayOpen()) return;
    this.overlay.hidden = true;
    // Releasing restores focus to whatever opened it.
    this.overlayTrap?.release();
    this.overlayTrap = null;
  }

  private bindShortcuts(): void {
    this.keyHandler = (event: KeyboardEvent): void => {
      const action = resolveShortcut(event, { helpOpen: this.isOverlayOpen() });
      if (!action) return;
      event.preventDefault();

      switch (action.kind) {
        case 'view': {
          const index = VIEW_SHORTCUTS.findIndex((entry) => entry.mode === action.mode);
          if (index >= 0) this.onSelectViewMode(index);
          break;
        }
        case 'help-toggle':
          if (this.isOverlayOpen()) this.closeShortcutOverlay();
          else this.openShortcutOverlay();
          break;
        case 'help-close':
          this.closeShortcutOverlay();
          break;
      }
    };
    window.addEventListener('keydown', this.keyHandler);
  }
}
