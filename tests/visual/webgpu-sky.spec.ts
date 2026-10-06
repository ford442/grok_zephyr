import { test, expect, type Page } from '@playwright/test';
import { dataUrlToPng, hideChrome } from './helpers.js';

/**
 * Opt-in (`SKY_VISUAL=1`) smoke spec for the Hipparcos sky (`?sky=hip`,
 * docs/SKY.md) in God View and Moon View.
 *
 * Under headless SwiftShader WebGPU captures come back black (see
 * tests/visual/baselines/README.md), so this spec stores no golden: it checks
 * that the catalog loads, that both catalog pipelines compile (boot awaits
 * shader compilation), and that an offscreen frame can be read back. Star
 * placement is pinned by the CPU mirrors in src/render/SkyCatalog.test.ts.
 * The default URL keeps the procedural sky and the existing baselines.
 */
const SKY_QUERY = 'capture=offscreen&sats=16384&seed=42&demo=0&simTime=180&timescale=0&hdr=0&sky=hip';

const CASES = [
  { name: 'webgpu-sky-god-view', query: 'mode=1' },
  { name: 'webgpu-sky-moon-view', query: 'mode=4' },
];

async function captureAfterBoot(page: Page): Promise<string> {
  await page.waitForFunction(() => {
    const w = window as unknown as { zephyrGPU?: { capture: () => Promise<string> } };
    return typeof w.zephyrGPU?.capture === 'function';
  }, undefined, { timeout: 120_000 });
  return page.evaluate(() => {
    const w = window as unknown as { zephyrGPU: { capture: () => Promise<string> } };
    return w.zephyrGPU.capture();
  });
}

test.describe('Hipparcos sky (WebGPU offscreen, opt-in)', () => {
  test.skip(process.env.SKY_VISUAL !== '1', 'set SKY_VISUAL=1 to run the ?sky=hip smoke spec');

  for (const view of CASES) {
    test(`${view.name} boots with the catalog`, async ({ page }) => {
      const logs: string[] = [];
      page.on('console', (msg) => logs.push(msg.text()));
      await page.addInitScript(() => {
        try {
          localStorage.clear();
        } catch {
          // ignore
        }
      });

      await page.goto(`/?${SKY_QUERY}&${view.query}`, { waitUntil: 'domcontentloaded' });
      await hideChrome(page);
      const dataUrl = await captureAfterBoot(page);

      expect(logs.some((l) => /\[SkyCatalog\] loaded \d+ stars/.test(l))).toBe(true);
      expect(logs.some((l) => l.includes('[GrokZephyr] Initialization complete'))).toBe(true);
      expect(logs.some((l) => l.includes('[SkyCatalog] load failed'))).toBe(false);
      expect(dataUrlToPng(dataUrl).width).toBeGreaterThan(0);
    });
  }
});
