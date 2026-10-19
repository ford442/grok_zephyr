/**
 * WebGPU Compatibility Manager
 *
 * Handles comprehensive WebGPU support detection and user-friendly error messaging.
 */

import { webgl2OptInHref } from '@/webgl/rendererSelection.js';
import { FALLBACK_LIMITS } from '@/ui/rendererFallbackBadge.js';

export interface CompatibilityCheckResult {
  isSupported: boolean;
  browserName: string;
  message: string;
  suggestions: string[];
  severity: 'critical' | 'warning' | 'info';
  featureLines?: string[];
  /** Overlay heading; defaults to the WebGPU wording for the severity. */
  title?: string;
  /**
   * Offer the opt-in WebGL2 renderer (`?webgl2=1`). It is a button the user
   * presses, never something the app switches to on its own.
   */
  offerWebgl2?: boolean;
}

/** Inline so it renders on machines with no emoji font (the old glyph showed as a box). */
const WARNING_ICON_SVG =
  '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">' +
  '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>' +
  '<line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
const RECOVERY_ICON_SVG =
  '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">' +
  '<path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg>';
const INFO_ICON_SVG =
  '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">' +
  '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/>' +
  '<line x1="12" y1="8" x2="12.01" y2="8"/></svg>';

export class WebGPUCompatibilityManager {
  /**
   * Detect browser and provide detailed compatibility information
   */
  /** Enabled vs missing optional features for support overlays / logs. */
  static describeOptionalFeatures(enabled: readonly string[], missing: readonly string[]): string[] {
    const lines: string[] = [];
    for (const name of enabled) lines.push(`${name}: enabled`);
    for (const name of missing) lines.push(`${name}: missing (fallback)`);
    return lines;
  }

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
        offerWebgl2: true,
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
        "You already have Chrome! Just make sure it's version 113 or newer.",
        'Check chrome://version to see your Chrome version.',
        'WebGPU is enabled by default in recent Chrome versions.',
      ],
      Edge: [
        "You already have Edge! Just make sure it's version 113 or newer.",
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
   * Non-fatal overlay shown while the app recreates GPU resources after device loss.
   */
  static createRecoveryOverlay(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.id = 'webgpu-recovery-overlay';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.className = 'compatibility-overlay severity-info';

    overlay.innerHTML = `
      <div class="compatibility-content">
        <div class="compatibility-icon" aria-hidden="true">${RECOVERY_ICON_SVG}</div>
        <h1 class="compatibility-title">GPU Device Lost — Recovering…</h1>
        <p class="compatibility-message">
          The graphics device was reset. Grok Zephyr is rebuilding GPU resources.
          This usually takes a few seconds.
        </p>
      </div>
    `;

    return overlay;
  }

  /**
   * Build a compatibility result for a failed initialization or recovery stage.
   * `stage: 'webgl2'` means the opt-in fallback itself failed, so it is not offered again.
   */
  static createInitFailureResult(stage: string, message: string): CompatibilityCheckResult {
    const webgl2Failed = stage === 'webgl2';
    return {
      isSupported: false,
      browserName: this.detectBrowser(),
      message: webgl2Failed
        ? `The WebGL2 fallback failed to start: ${message}`
        : `Initialization failed during ${stage}: ${message}`,
      suggestions: [
        'Reload the page and try again.',
        'Update your browser to the latest Chrome 113+ or Edge 113+ build.',
        'If the problem persists, try disabling hardware acceleration or switching GPUs.',
      ],
      severity: 'critical',
      title: webgl2Failed ? 'WebGL2 Fallback Failed' : undefined,
      offerWebgl2: !webgl2Failed,
    };
  }

  /**
   * Check if a compatibility overlay is already displayed (excluding recovery banner).
   */
  static hasCompatibilityOverlay(): boolean {
    return document.querySelector('#webgpu-compatibility-overlay') !== null;
  }

  /**
   * Check if a compatibility or recovery overlay is already displayed.
   */
  static hasActiveOverlay(): boolean {
    return (
      this.hasCompatibilityOverlay() || document.querySelector('#webgpu-recovery-overlay') !== null
    );
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
          ${result.severity === 'critical' ? WARNING_ICON_SVG : INFO_ICON_SVG}
        </div>

        <h1 class="compatibility-title">
          ${this.escapeHtml(
            result.title ??
              (result.severity === 'critical' ? 'WebGPU Not Available' : 'WebGPU Status'),
          )}
        </h1>

        <p class="compatibility-message">
          ${this.escapeHtml(result.message)}
        </p>

        ${
          result.featureLines && result.featureLines.length > 0
            ? `<ul class="compatibility-features">${result.featureLines
                .map((line) => `<li>${this.escapeHtml(line)}</li>`)
                .join('')}</ul>`
            : ''
        }

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
                Get Chrome 113+
              </button>
              <button class="option-btn option-continue" id="compat-retry-btn">
                Retry
              </button>
              ${
                result.offerWebgl2
                  ? `<button class="option-btn option-fallback" id="compat-webgl2-btn">
                Try WebGL2 (reduced)
              </button>`
                  : ''
              }
            `
                : `
              <button class="option-btn option-continue" id="compat-continue-btn">
                Continue Anyway
              </button>
            `
            }
          </div>
          ${
            result.offerWebgl2 && result.severity === 'critical'
              ? `<p class="compatibility-fallback-note">
            Optional: WebGL2 is a reduced-fidelity view that only starts when you choose it.
            ${this.escapeHtml(FALLBACK_LIMITS)}
          </p>`
              : ''
          }
        </div>

        <p class="compatibility-note">
          Running on: <strong>${this.escapeHtml(result.browserName)}</strong>
        </p>
      </div>
    `;

    // Attach event listeners
    const downloadBtn = overlay.querySelector('#compat-download-btn');
    const retryBtn = overlay.querySelector('#compat-retry-btn');
    const continueBtn = overlay.querySelector('#compat-continue-btn');
    const webgl2Btn = overlay.querySelector('#compat-webgl2-btn');

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

    if (webgl2Btn) {
      webgl2Btn.addEventListener('click', () => {
        window.location.assign(webgl2OptInHref());
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
