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

/**
 * Beam / animation pattern harness cases.
 *
 * WebGL2 does not yet render beam volumes or constellation animation patterns;
 * these baselines guard URL wiring, harness stability, and overall luminance
 * structure. Rebaseline when WebGL pattern parity lands or WebGPU readback
 * tests are added.
 */
const UPDATE_BASELINES = process.env.UPDATE_BASELINES === '1';

interface PatternCase {
  name: string;
  query: string;
  description: string;
}

const PATTERN_CASES: PatternCase[] = [
  {
    name: 'god-chaos-beams',
    query: 'mode=1&pattern=0',
    description: 'God View with CHAOS beam pattern (?pattern=0)',
  },
  {
    name: 'god-grok-beams',
    query: 'mode=1&pattern=1',
    description: 'God View with GROK beam pattern (?pattern=1)',
  },
  {
    name: 'god-x-beams',
    query: 'mode=1&pattern=2',
    description: 'God View with 𝕏 LOGO beam pattern (?pattern=2)',
  },
  {
    name: 'ground-grok-beams',
    query: 'mode=3&ground=houseWindow&pattern=1',
    description: 'Ground View GROK beams with Mie scatter tint (?pattern=1)',
  },
  {
    name: 'horizon-smile',
    query: 'mode=0&animation=3',
    description: 'Horizon 720 km with SMILE animation (?animation=3)',
  },
];

test.describe('WebGL2 pattern harness @pattern', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.clear();
      } catch {
        // ignore
      }
    });
  });

  for (const scene of PATTERN_CASES) {
    test(`${scene.name} matches baseline luminance structure`, async ({ page }) => {
      const url = `/?${HARNESS_QUERY}&${scene.query}`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await hideChrome(page);
      const dataUrl = await warmupAndCapture(page, 90);
      expect(dataUrl).toMatch(/^data:image\/png;base64,/);

      const png = dataUrlToPng(dataUrl);
      const metrics = computeMetrics(png);

      if (UPDATE_BASELINES || !baselineExists(scene.name)) {
        const bands = bandsFromMetrics(metrics);
        bands.description = scene.description;
        saveBaselineArtifacts(scene.name, png, bands);
        test.info().annotations.push({
          type: 'baseline',
          description: `Wrote ${scene.name}: ${scene.description} (meanLum=${metrics.meanLuminance.toFixed(4)})`,
        });
        return;
      }

      const bands = loadMetricBands(scene.name);
      const baseline = loadBaselinePng(scene.name);

      assertMetricBands(metrics, bands);
      const { diffRatio } = compareToBaseline(scene.name, png, baseline, bands.maxDiffRatio);

      test.info().annotations.push({
        type: 'metrics',
        description: `${scene.description} — meanLum=${metrics.meanLuminance.toFixed(4)} diff=${(diffRatio * 100).toFixed(2)}%`,
      });
    });
  }
});
