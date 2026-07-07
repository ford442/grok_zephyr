import { test, expect } from '@playwright/test';
import {
  HARNESS_QUERY,
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
  warmupAndCapture,
} from './helpers.js';

const UPDATE_BASELINES = process.env.UPDATE_BASELINES === '1';

interface ViewCase {
  name: string;
  /** Extra query string appended to the shared harness params. */
  query: string;
}

const VIEW_CASES: ViewCase[] = [
  { name: 'god-view', query: 'mode=1' },
  { name: 'fleet-pov', query: 'mode=2' },
  { name: 'horizon-720km', query: 'mode=0' },
  { name: 'ground-house', query: 'mode=3&ground=houseWindow' },
  { name: 'ground-beach', query: 'mode=3&ground=beachNight' },
  { name: 'ground-car', query: 'mode=3&ground=carWindshield' },
  { name: 'ground-rooftop', query: 'mode=3&ground=rooftop' },
  { name: 'ground-airplane', query: 'mode=3&ground=airplaneWindow' },
  { name: 'moon-view', query: 'mode=4' },
  { name: 'skyline', query: 'mode=5' },
];

test.describe('WebGL2 visual regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.clear();
      } catch {
        // ignore
      }
    });
  });

  for (const view of VIEW_CASES) {
    test(`${view.name} matches baseline luminance and bloom structure`, async ({ page }) => {
      const url = `/?${HARNESS_QUERY}&${view.query}`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await hideChrome(page);
      const dataUrl = await warmupAndCapture(page, 60);
      expect(dataUrl).toMatch(/^data:image\/png;base64,/);

      const png = dataUrlToPng(dataUrl);
      const metrics = computeMetrics(png);

      if (UPDATE_BASELINES || !baselineExists(view.name)) {
        const bands = bandsFromMetrics(metrics);
        saveBaselineArtifacts(view.name, png, bands);
        test.info().annotations.push({
          type: 'baseline',
          description: `Wrote ${view.name} baseline (meanLum=${metrics.meanLuminance.toFixed(4)}, bright=${(metrics.brightRatio * 100).toFixed(3)}%)`,
        });
        return;
      }

      const bands = loadMetricBands(view.name);
      const baseline = loadBaselinePng(view.name);

      assertMetricBands(metrics, bands);
      const { diffRatio } = compareToBaseline(view.name, png, baseline, bands.maxDiffRatio);

      test.info().annotations.push({
        type: 'metrics',
        description: `meanLum=${metrics.meanLuminance.toFixed(4)} bright=${(metrics.brightRatio * 100).toFixed(3)}% diff=${(diffRatio * 100).toFixed(2)}%`,
      });
    });
  }

  test('bloom pass guard — bloom contributes mid-tone energy', async ({ page }) => {
    const url = `/?${HARNESS_QUERY}&mode=1`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await hideChrome(page);
    await warmupAndCapture(page, 45);
    const withBloom = computeMetrics(
      dataUrlToPng(
        await page.evaluate(() => {
          const w = window as unknown as { zephyrGL: { capture: () => string } };
          return w.zephyrGL.capture();
        }),
      ),
    );

    await page.evaluate(() => {
      const w = window as unknown as { zephyrGL: { setDebug: (o: object) => void } };
      w.zephyrGL.setDebug({ showBloom: false });
    });
    await warmupAndCapture(page, 15);
    const noBloom = computeMetrics(
      dataUrlToPng(
        await page.evaluate(() => {
          const w = window as unknown as { zephyrGL: { capture: () => string } };
          return w.zephyrGL.capture();
        }),
      ),
    );

    expect(withBloom.midBrightRatio).toBeGreaterThan(noBloom.midBrightRatio * 1.02);
    expect(withBloom.meanLuminance).toBeGreaterThan(noBloom.meanLuminance * 1.01);
  });
});
