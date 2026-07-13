/**
 * Grok Zephyr - WebGL2 debug overlay + scripting surface.
 *
 * Parses `?debug=…` flags, renders a small on-screen panel, and exposes
 * `window.zephyrGL` so agents / Playwright can toggle passes and capture the
 * (readback-friendly) WebGL canvas without UI interaction.
 */

import type { WebGLRenderer, WebGLDebugOptions } from './WebGLRenderer.js';

/** Parse the `?debug=a,b,c` comma list into renderer debug options. */
export function parseDebugFlags(search: string): Partial<WebGLDebugOptions> {
  const params = new URLSearchParams(search);
  const raw = params.get('debug');
  if (!raw) return {};
  const flags = raw.split(',').map((f) => f.trim().toLowerCase());
  const opts: Partial<WebGLDebugOptions> = {};
  if (flags.includes('wireframe')) opts.wireframeEarth = true;
  if (flags.includes('lod')) opts.lodDebug = true;
  if (flags.includes('points')) opts.pointScale = 2.5;
  if (flags.includes('noearth')) opts.showEarth = false;
  if (flags.includes('nostars')) opts.showStars = false;
  if (flags.includes('nobloom')) opts.showBloom = false;
  if (flags.includes('nosats')) opts.showSatellites = false;
  return opts;
}

/** Public scripting API attached to window.zephyrGL. */
export interface ZephyrGLApi {
  renderer: WebGLRenderer;
  setDebug(opts: Partial<WebGLDebugOptions>): void;
  getDebug(): WebGLDebugOptions;
  /** Returns a PNG data URL of the current canvas (preserveDrawingBuffer is on). */
  capture(): string;
}

export class WebGLDebugOverlay {
  private panel: HTMLDivElement | null = null;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly canvas: HTMLCanvasElement,
  ) {}

  /** Build the on-screen badge/panel and the window.zephyrGL scripting surface. */
  install(): void {
    const panel = document.createElement('div');
    panel.id = 'webgl-debug-panel';
    panel.style.cssText = [
      'position:fixed',
      'bottom:10px',
      'right:10px',
      'z-index:9999',
      'font:11px/1.5 monospace',
      'color:#7fffd4',
      'background:rgba(0,0,0,0.6)',
      'padding:8px 10px',
      'border:1px solid #1f6f5f',
      'border-radius:6px',
      'pointer-events:auto',
      'user-select:none',
    ].join(';');
    this.render(panel);
    document.body.appendChild(panel);
    this.panel = panel;

    const api: ZephyrGLApi = {
      renderer: this.renderer,
      setDebug: (opts) => {
        this.renderer.setDebug(opts);
        this.refresh();
      },
      getDebug: () => this.renderer.getDebug(),
      capture: () => this.canvas.toDataURL('image/png'),
    };
    (window as unknown as { zephyrGL: ZephyrGLApi }).zephyrGL = api;
  }

  private refresh(): void {
    if (this.panel) this.render(this.panel);
  }

  private render(panel: HTMLDivElement): void {
    const d = this.renderer.getDebug();
    const badge = `<b>◈ WEBGL2</b>${this.renderer.hdrEnabled ? ' · HDR' : ' · LDR'} <span style="opacity:.6">(debug)</span>`;
    const toggle = (label: string, key: keyof WebGLDebugOptions, on: boolean) =>
      `<label style="display:block;cursor:pointer">` +
      `<input type="checkbox" data-key="${key}" ${on ? 'checked' : ''}/> ${label}</label>`;
    panel.innerHTML =
      badge +
      '<div style="margin-top:6px">' +
      toggle('Earth', 'showEarth', d.showEarth) +
      toggle('Satellites', 'showSatellites', d.showSatellites) +
      toggle('Starfield', 'showStars', d.showStars) +
      toggle('Bloom', 'showBloom', d.showBloom) +
      toggle('Wireframe Earth', 'wireframeEarth', d.wireframeEarth) +
      toggle('LOD debug', 'lodDebug', d.lodDebug) +
      '</div>';
    panel.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((input) => {
      input.addEventListener('change', () => {
        const key = input.dataset.key as keyof WebGLDebugOptions;
        this.renderer.setDebug({ [key]: input.checked });
      });
    });
  }

  destroy(): void {
    this.panel?.remove();
    this.panel = null;
    delete (window as unknown as { zephyrGL?: ZephyrGLApi }).zephyrGL;
  }
}
