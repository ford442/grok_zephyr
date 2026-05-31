/**
 * WebGPU Compatibility Manager
 * 
 * Handles comprehensive WebGPU support detection and user-friendly error messaging.
 */

export interface CompatibilityCheckResult {
  isSupported: boolean;
  browserName: string;
  message: string;
  suggestions: string[];
  severity: 'critical' | 'warning' | 'info';
}

export class WebGPUCompatibilityManager {
  /**
   * Detect browser and provide detailed compatibility information
   */
  static detectBrowser(): string {
    const ua = navigator.userAgent;
    // Check Edge before Chrome since Edge contains 'Chrome'
    if (ua.includes('Edg/')) return 'Edge';
    if (ua.includes('Chrome')) return 'Chrome';
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Safari')) return 'Safari';
    return 'Unknown';
  }

  /**
   * Comprehensive WebGPU support check with detailed messaging
   */
  static checkSupport(): CompatibilityCheckResult {
    const browser = this.detectBrowser();
    const isSupported = typeof navigator !== 'undefined' && 'gpu' in navigator;

    if (!isSupported) {
      return {
        isSupported: false,
        browserName: browser,
        message: 'WebGPU is not available in your browser.',
        suggestions: this.getSuggestionsForBrowser(browser),
        severity: 'critical',
      };
    }

    return {
      isSupported: true,
      browserName: browser,
      message: 'WebGPU is available.',
      suggestions: [],
      severity: 'info',
    };
  }

  /**
   * Get browser-specific suggestions
   */
  private static getSuggestionsForBrowser(browser: string): string[] {
    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/.test(ua);
    const isAndroid = /Android/.test(ua);

    if (isIOS) {
      return [
        'WebGPU requires iOS / iPadOS 17.4 or newer.',
        'Update your device in Settings → General → Software Update.',
        'In Safari, enable WebGPU under Settings → Apps → Safari → Advanced → Experimental Features.',
        'For best results on mobile, use the latest version of Safari or Chrome for iOS.',
      ];
    }

    if (isAndroid) {
      return [
        'WebGPU is supported in Chrome for Android 113 or newer.',
        'Update Chrome via the Play Store and make sure it is version 113+.',
        'Samsung Internet 21+ also supports WebGPU.',
      ];
    }

    const suggestions: Record<string, string[]> = {
      Chrome: [
        'You already have Chrome! Just make sure it\'s version 113 or newer.',
        'Check chrome://version to see your Chrome version.',
        'WebGPU is enabled by default in recent Chrome versions.',
      ],
      Edge: [
        'You already have Edge! Just make sure it\'s version 113 or newer.',
        'Edge Chromium includes WebGPU support.',
      ],
      Firefox: [
        'Firefox Nightly includes experimental WebGPU support.',
        'Download Firefox Nightly: https://www.mozilla.org/en-US/firefox/nightly/all/',
        'Enable WebGPU in about:config by setting "dom.webgpu.enabled" to true.',
      ],
      Safari: [
        'Safari on macOS 14+ and iOS 17+ has experimental WebGPU support.',
        'Make sure to enable WebGPU in Settings → Safari → Experimental Features.',
        'Try the latest beta version of Safari for better support.',
      ],
      Unknown: [
        'Try one of these modern browsers: Chrome 113+, Edge 113+, Firefox Nightly, or Safari 17+.',
      ],
    };

    return suggestions[browser] ?? suggestions.Unknown;
  }

  /**
   * Check if a compatibility overlay is already displayed
   */
  static hasActiveOverlay(): boolean {
    return document.querySelector('#webgpu-compatibility-overlay') !== null;
  }

  /**
   * Create a detailed error overlay for WebGPU failures
   */
  static createCompatibilityOverlay(result: CompatibilityCheckResult): HTMLElement {
    const overlay = document.createElement('div');
    overlay.id = 'webgpu-compatibility-overlay';
    overlay.setAttribute('role', 'alert');
    overlay.className = `compatibility-overlay severity-${result.severity}`;

    const suggestionsHTML = result.suggestions
      .map((s) => `<li>${this.escapeHtml(s)}</li>`)
      .join('');

    overlay.innerHTML = `
      <div class="compatibility-content">
        <div class="compatibility-icon" aria-hidden="true">
          ${result.severity === 'critical' ? '⚠️' : 'ℹ️'}
        </div>

        <h1 class="compatibility-title">
          ${result.severity === 'critical' ? 'WebGPU Not Available' : 'WebGPU Status'}
        </h1>

        <p class="compatibility-message">
          ${this.escapeHtml(result.message)}
        </p>

        ${
          result.suggestions.length > 0
            ? `
          <div class="compatibility-suggestions">
            <h2>What to do:</h2>
            <ul class="suggestions-list">
              ${suggestionsHTML}
            </ul>
          </div>
        `
            : ''
        }

        <div class="compatibility-options">
          <h2>Options:</h2>
          <div class="option-buttons">
            ${
              result.severity === 'critical'
                ? `
              <button class="option-btn option-download" id="compat-download-btn">
                📥 Get Chrome 113+
              </button>
              <button class="option-btn option-continue" id="compat-retry-btn">
                ↻ Retry
              </button>
            `
                : `
              <button class="option-btn option-continue" id="compat-continue-btn">
                ✓ Continue Anyway
              </button>
            `
            }
          </div>
        </div>

        <p class="compatibility-note">
          Running on: <strong>${this.escapeHtml(result.browserName)}</strong>
        </p>
      </div>
    `;

    // Attach event listeners
    const downloadBtn = overlay.querySelector('#compat-download-btn') as HTMLButtonElement | null;
    const retryBtn = overlay.querySelector('#compat-retry-btn') as HTMLButtonElement | null;
    const continueBtn = overlay.querySelector('#compat-continue-btn') as HTMLButtonElement | null;

    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => {
        window.open('https://www.google.com/chrome/', '_blank');
      });
    }

    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        location.reload();
      });
    }

    if (continueBtn) {
      continueBtn.addEventListener('click', () => {
        // Remove the overlay from the DOM instead of just hiding
        if (overlay.parentElement) {
          overlay.parentElement.removeChild(overlay);
        }
      });
    }

    // Allow closing by clicking the overlay background
    overlay.addEventListener('click', (e: MouseEvent) => {
      if (e.target === overlay) {
        if (overlay.parentElement) {
          overlay.parentElement.removeChild(overlay);
        }
      }
    });

    return overlay;
  }

  /**
   * Escape HTML entities to prevent XSS attacks.
   * Uses a map-based approach for efficient HTML entity escaping.
   */
  private static escapeHtml(text: string): string {
    const htmlEntityMap: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return text.replace(/[&<>"']/g, (char) => htmlEntityMap[char]);
  }
}
