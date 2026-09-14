import { test, expect, type Page } from '@playwright/test';
import {
  assertMetricBands,
  bandsFromMetrics,
  baselineExists,
  compareToBaseline,
  computeMetrics,
  dataUrlToPng,
  hideChrome,
  loadBaselinePng,
  loadMetricBands,
  saveBaselineArtifacts,
} from './helpers.js';

const UPDATE_BASELINES = process.env.UPDATE_BASELINES === '1';

/** Shared harness for WebGPU offscreen readback (no swapchain present). */
const WEBGPU_QUERY =
  'capture=offscreen&sats=16384&seed=42&demo=0&simTime=180&timescale=0&hdr=0';

interface GpuCase {
  name: string;
  query: string;
}

const GPU_CASES: GpuCase[] = [
  { name: 'webgpu-horizon-720km', query: 'mode=0' },
  { name: 'webgpu-god-view', query: 'mode=1' },
];

async function warmupAndCaptureGpu(page: import('@playwright/test').Page, warmupFrames = 45): Promise<string> {
  await page.waitForFunction(() => {
    const w = window as unknown as { zephyrGPU?: { capture: () => Promise<string> } };
    return typeof w.zephyrGPU?.capture === 'function';
  }, undefined, { timeout: 120_000 });
  await page.evaluate(async (frames) => {
    await new Promise<void>((resolve) => {
      let count = 0;
      const tick = () => {
        if (++count >= frames) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, warmupFrames);
  return page.evaluate(() => {
    const w = window as unknown as { zephyrGPU: { capture: () => Promise<string> } };
    return w.zephyrGPU.capture();
  });
}

test.describe('WebGPU offscreen visual regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.clear();
      } catch {
        // ignore
      }
    });
  });

  for (const view of GPU_CASES) {
    test(`${view.name} offscreen capture matches baseline`, async ({ page }) => {
      const url = `/?${WEBGPU_QUERY}&${view.query}`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await hideChrome(page);
      const dataUrl = await warmupAndCaptureGpu(page);
      expect(dataUrl).toMatch(/^data:image\/png;base64,/);

      const png = dataUrlToPng(dataUrl);
      const metrics = computeMetrics(png);

      if (UPDATE_BASELINES || !baselineExists(view.name)) {
        const bands = bandsFromMetrics(metrics, 0.2);
        bands.description = 'WebGPU offscreen SwiftShader capture (no swapchain present)';
        saveBaselineArtifacts(view.name, png, bands);
        test.info().annotations.push({
          type: 'baseline',
          description: `Wrote ${view.name} (meanLum=${metrics.meanLuminance.toFixed(4)})`,
        });
        return;
      }

      const bands = loadMetricBands(view.name);
      const baseline = loadBaselinePng(view.name);
      assertMetricBands(metrics, bands);
      const { diffRatio } = compareToBaseline(view.name, png, baseline, bands.maxDiffRatio);
      test.info().annotations.push({
        type: 'metrics',
        description: `meanLum=${metrics.meanLuminance.toFixed(4)} diff=${(diffRatio * 100).toFixed(2)}%`,
      });
    });
  }
});

/**
 * Light Brush golden at 16k satellites: a stroke held at the screen centre in
 * God View, captured while the paint is still lit. The brush is WebGPU-only
 * (paint is written by a compute pass into the packed animation scratch), so
 * there is no WebGL2 counterpart.
 *
 * Under headless SwiftShader the offscreen capture is black, as it is for the
 * other WebGPU cases here — see tests/visual/baselines/README.md. The
 * isEnabled() assertions still check the ?brush=1 wiring and the quality rule
 * in a real browser; the image comparison only means something on a GPU.
 */
test.describe('Light Brush (WebGPU offscreen)', () => {
  const BRUSH_QUERY = `${WEBGPU_QUERY}&mode=1&brush=1&brushKm=900&brushFade=5&brushColor=ff7a1a`;

  /** Boot applies ?brush after the quality preset; the HUD status line says what won. */
  async function waitForBrushStatus(page: Page, expected: string): Promise<void> {
    await page.waitForFunction(
      (text) => document.getElementById('brushStatus')?.textContent?.startsWith(text) ?? false,
      expected,
      { timeout: 120_000 },
    );
  }

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.clear();
      } catch {
        // ignore
      }
    });
  });

  test('webgpu-god-brush offscreen capture matches baseline', async ({ page }) => {
    const name = 'webgpu-god-brush';
    await page.goto(`/?${BRUSH_QUERY}`, { waitUntil: 'domcontentloaded' });
    await hideChrome(page);
    await waitForBrushStatus(page, 'Brush: point');
    expect(await page.evaluate(() => {
      const w = window as unknown as { zephyrBrush?: { isEnabled: () => boolean } };
      return w.zephyrBrush?.isEnabled() ?? false;
    })).toBe(true);

    await page.evaluate(() => {
      const w = window as unknown as { zephyrBrush: { stampNdc: (x: number, y: number) => void } };
      w.zephyrBrush.stampNdc(0, 0);
    });
    const dataUrl = await warmupAndCaptureGpu(page, 30);
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);

    const png = dataUrlToPng(dataUrl);
    const metrics = computeMetrics(png);
    if (UPDATE_BASELINES || !baselineExists(name)) {
      const bands = bandsFromMetrics(metrics, 0.2);
      bands.description = 'WebGPU offscreen God View with a Light Brush stroke held at screen centre';
      saveBaselineArtifacts(name, png, bands);
      test.info().annotations.push({
        type: 'baseline',
        description: `Wrote ${name} (meanLum=${metrics.meanLuminance.toFixed(4)})`,
      });
      return;
    }
    const bands = loadMetricBands(name);
    assertMetricBands(metrics, bands);
    const { diffRatio } = compareToBaseline(name, png, loadBaselinePng(name), bands.maxDiffRatio);
    test.info().annotations.push({
      type: 'metrics',
      description: `meanLum=${metrics.meanLuminance.toFixed(4)} diff=${(diffRatio * 100).toFixed(2)}%`,
    });
  });

  test('?brush=1 stays off on the low preset', async ({ page }) => {
    await page.goto(`/?${BRUSH_QUERY}&preset=low`, { waitUntil: 'domcontentloaded' });
    await waitForBrushStatus(page, 'Brush: off on Low quality and mobile');
  });
});
