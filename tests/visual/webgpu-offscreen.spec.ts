import { test, expect } from '@playwright/test';
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
