/**
 * Loud badge for the opt-in WebGL2 fallback renderer.
 *
 * WebGL2 is never chosen automatically (a failed WebGPU init shows an error
 * instead). When someone does opt in — `?webgl2=1`, `?renderer=webgl`, or a saved
 * preference — every frame is a reduced-fidelity render, so say so on screen for
 * as long as it runs rather than leaving a small debug tag.
 */

import { webgpuHref, type RendererSource } from '@/webgl/rendererSelection.js';

export const FALLBACK_BADGE_ID = 'renderer-fallback-badge';

/** Body class shared by the top banners so the HUD can sit below them. */
export const STATUS_BANNER_CLASS = 'has-status-banner';

/**
 * Keep `--status-banner-h` equal to the banner's height so the HUD (fixed, top-left)
 * sits below it however many lines the text wraps to.
 */
export function reserveBannerSpace(banner: HTMLElement): void {
  const apply = (): void => {
    const style = document.documentElement?.style;
    if (style && typeof banner.offsetHeight === 'number') {
      style.setProperty('--status-banner-h', `${banner.offsetHeight}px`);
    }
  };
  apply();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(apply).observe(banner);
}

export const FALLBACK_LIMITS =
  'No volumetric beams, trails, TAA or Keplerian / J2 / SGP4 physics.';

export function fallbackBadgeHeadline(source: RendererSource): string {
  switch (source) {
    case 'stored':
      return 'WEBGL2 FALLBACK — selected by a saved preference, not WebGPU.';
    case 'url-renderer':
      return 'WEBGL2 FALLBACK — selected with ?renderer=webgl, not WebGPU.';
    default:
      return 'WEBGL2 FALLBACK — opted in with ?webgl2=1, not WebGPU.';
  }
}

/** Show the badge (idempotent) and reserve room for it above the HUD. */
export function showRendererFallbackBadge(source: RendererSource): HTMLElement {
  let badge = document.getElementById(FALLBACK_BADGE_ID);
  if (!badge) {
    badge = document.createElement('div');
    badge.id = FALLBACK_BADGE_ID;
    badge.setAttribute('role', 'status');
    document.body.appendChild(badge);
  }

  const headline = document.createElement('strong');
  headline.textContent = fallbackBadgeHeadline(source);
  const limits = document.createElement('span');
  limits.textContent = ` Reduced fidelity. ${FALLBACK_LIMITS} `;
  const back = document.createElement('a');
  back.href = webgpuHref();
  back.textContent = 'Use WebGPU';
  badge.replaceChildren(headline, limits, back);

  document.body.classList.add(STATUS_BANNER_CLASS);
  reserveBannerSpace(badge);
  return badge;
}

export function removeRendererFallbackBadge(): void {
  document.getElementById(FALLBACK_BADGE_ID)?.remove();
}
