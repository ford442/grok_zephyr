/**
 * Onboarding Manager
 * 
 * Handles first-run experience including intro overlay and dismissal persistence.
 */

export class OnboardingManager {
  private static readonly STORAGE_KEY = 'grok-zephyr-onboarding-dismissed';
  private overlayElement: HTMLElement | null = null;

  /**
   * Check if onboarding has been dismissed by the user
   */
  static isDismissed(): boolean {
    try {
      return localStorage.getItem(this.STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Mark onboarding as dismissed in localStorage
   */
  static markDismissed(): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, 'true');
    } catch {
      // Silently fail if localStorage is unavailable
    }
  }

  /**
   * Create and show the onboarding overlay
   */
  createOverlay(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.id = 'onboarding-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-labelledby', 'onboarding-title');
    overlay.setAttribute('aria-modal', 'true');
    overlay.className = 'onboarding-overlay';

    overlay.innerHTML = `
      <div class="onboarding-content">
        <button class="onboarding-close" aria-label="Close introduction" title="Close (press Esc)">
          <span aria-hidden="true">×</span>
        </button>
        
        <div class="onboarding-header">
          <h1 id="onboarding-title">Welcome to Grok Zephyr</h1>
          <p class="onboarding-subtitle">WebGPU Orbital Simulation</p>
        </div>

        <div class="onboarding-body">
          <div class="onboarding-section">
            <h2>What You're Seeing</h2>
            <p>1,048,576 simulated satellites orbiting Earth in real-time, rendered with WebGPU for stunning performance.</p>
          </div>

          <div class="onboarding-section">
            <h2>Core Controls</h2>
            <ul class="onboarding-controls-list">
              <li><strong>View Modes:</strong> Switch between different perspectives (Horizon, God View, Fleet POV, Ground View, Moon)</li>
              <li><strong>Beam Patterns:</strong> Visualize satellite constellations with different lighting patterns</li>
              <li><strong>Quality:</strong> Adjust rendering quality for your device (LOW to CINEMATIC)</li>
              <li><strong>Interact:</strong> Drag to rotate, scroll to zoom, double-click to reset</li>
            </ul>
          </div>

          <div class="onboarding-section">
            <h2>Pro Tips</h2>
            <ul class="onboarding-tips-list">
              <li>Use keyboard: <kbd>WASD</kbd> to drift in Fleet POV mode</li>
              <li>Click on the quality controls to find a balance for your GPU</li>
              <li>Try the animated patterns (Smile, Matrix, Heartbeat) for a visual spectacle</li>
              <li>Temporal Anti-Aliasing (TAA) smooths edges—toggle it if your GPU is under stress</li>
            </ul>
          </div>
        </div>

        <div class="onboarding-footer">
          <button class="onboarding-start" aria-label="Start exploring">
            Start Exploring
          </button>
          <p class="onboarding-note">This introduction won't show again.</p>
        </div>
      </div>
    `;

    // Attach event listeners
    const closeBtn = overlay.querySelector('.onboarding-close') as HTMLButtonElement;
    const startBtn = overlay.querySelector('.onboarding-start') as HTMLButtonElement;

    const dismissHandler = () => {
      this.dismiss();
    };

    closeBtn.addEventListener('click', dismissHandler);
    startBtn.addEventListener('click', dismissHandler);

    // Close on Escape key
    const escapeHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dismissHandler();
      }
    };
    overlay.addEventListener('keydown', escapeHandler);

    // Close on background click
    overlay.addEventListener('click', (e: MouseEvent) => {
      if (e.target === overlay) {
        dismissHandler();
      }
    });

    this.overlayElement = overlay;
    document.body.appendChild(overlay);

    // Focus the close button for accessibility
    closeBtn.focus();

    return overlay;
  }

  /**
   * Dismiss the onboarding overlay
   */
  private dismiss(): void {
    if (this.overlayElement) {
      this.overlayElement.classList.add('dismissing');
      setTimeout(() => {
        if (this.overlayElement && this.overlayElement.parentElement) {
          this.overlayElement.parentElement.removeChild(this.overlayElement);
        }
      }, 300);
    }
    OnboardingManager.markDismissed();
  }

  /**
   * Show the overlay if not dismissed
   */
  showIfNew(): void {
    if (!OnboardingManager.isDismissed()) {
      this.createOverlay();
    }
  }
}
