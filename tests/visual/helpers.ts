import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import type { Page } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface PngSyncApi {
  read(buffer: Buffer): PngImage;
  write(png: PngImage): Buffer;
}

interface PngImage {
  width: number;
  height: number;
  data: Buffer;
}

const pngSync = (PNG as unknown as { sync: PngSyncApi }).sync;

function createPng(width: number, height: number): PngImage {
  const PngCtor = PNG as unknown as new (options: { width: number; height: number }) => PngImage;
  return new PngCtor({ width, height });
}

export const BASELINES_DIR = join(__dirname, 'baselines');
export const DIFFS_DIR = join(__dirname, 'diffs');

/** Shared harness params for deterministic WebGL captures. */
export const HARNESS_QUERY = 'renderer=webgl&sats=30000&seed=42&demo=0&simTime=180&timescale=0';

export interface ImageMetrics {
  meanLuminance: number;
  brightRatio: number;
  /** Pixels with luminance > 0.5 — sensitive to bloom bleed on software GL. */
  midBrightRatio: number;
  width: number;
  height: number;
}

export interface MetricBands {
  meanLuminance: [number, number];
  brightRatio: [number, number];
  /** Max fraction of pixels allowed to differ from the baseline PNG. */
  maxDiffRatio: number;
  /** Human-readable scene description for baseline sidecars. */
  description?: string;
}

export function dataUrlToPng(dataUrl: string): PngImage {
  const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  return pngSync.read(Buffer.from(b64, 'base64'));
}

export function computeMetrics(png: PngImage): ImageMetrics {
  let lumSum = 0;
  let bright = 0;
  let midBright = 0;
  const n = png.width * png.height;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const r = png.data[o] / 255;
    const g = png.data[o + 1] / 255;
    const b = png.data[o + 2] / 255;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lumSum += lum;
    if (lum > 0.85) bright++;
    if (lum > 0.5) midBright++;
  }
  return {
    meanLuminance: lumSum / n,
    brightRatio: bright / n,
    midBrightRatio: midBright / n,
    width: png.width,
    height: png.height,
  };
}

/** Derive tolerance bands from a reference capture (±30% luminance, ±40% bright ratio). */
export function bandsFromMetrics(metrics: ImageMetrics, maxDiffRatio = 0.1): MetricBands {
  const lumPad = Math.max(metrics.meanLuminance * 0.3, 0.008);
  const brightPad = Math.max(metrics.brightRatio * 0.4, 0.0005);
  return {
    meanLuminance: [
      Math.max(0, metrics.meanLuminance - lumPad),
      Math.min(1, metrics.meanLuminance + lumPad),
    ],
    brightRatio: [
      Math.max(0, metrics.brightRatio - brightPad),
      Math.min(1, metrics.brightRatio + brightPad),
    ],
    maxDiffRatio,
  };
}

export function loadBaselinePng(name: string): PngImage {
  const path = join(BASELINES_DIR, `${name}.png`);
  return pngSync.read(readFileSync(path));
}

export function loadMetricBands(name: string): MetricBands {
  const path = join(BASELINES_DIR, `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf-8')) as MetricBands;
}

export function saveBaselineArtifacts(name: string, png: PngImage, bands: MetricBands): void {
  mkdirSync(BASELINES_DIR, { recursive: true });
  writeFileSync(join(BASELINES_DIR, `${name}.png`), pngSync.write(png));
  writeFileSync(join(BASELINES_DIR, `${name}.json`), `${JSON.stringify(bands, null, 2)}\n`);
}

export function assertMetricBands(metrics: ImageMetrics, bands: MetricBands): void {
  const [lumMin, lumMax] = bands.meanLuminance;
  const [brightMin, brightMax] = bands.brightRatio;
  if (metrics.meanLuminance < lumMin || metrics.meanLuminance > lumMax) {
    throw new Error(
      `meanLuminance ${metrics.meanLuminance.toFixed(5)} outside [${lumMin}, ${lumMax}]`,
    );
  }
  if (metrics.brightRatio < brightMin || metrics.brightRatio > brightMax) {
    throw new Error(
      `brightRatio ${metrics.brightRatio.toFixed(5)} outside [${brightMin}, ${brightMax}]`,
    );
  }
}

export interface CompareResult {
  diffRatio: number;
  /** Absolute path to a red-highlight diff PNG when comparison fails. */
  diffPath?: string;
}

/** Write a pixel-diff image for debugging failed comparisons. */
export function saveDiffPng(caseName: string, diff: PngImage): string {
  mkdirSync(DIFFS_DIR, { recursive: true });
  const path = join(DIFFS_DIR, `${caseName}-diff.png`);
  writeFileSync(path, pngSync.write(diff));
  return path;
}

export function compareToBaseline(
  caseName: string,
  actual: PngImage,
  baseline: PngImage,
  maxDiffRatio: number,
): CompareResult {
  if (actual.width !== baseline.width || actual.height !== baseline.height) {
    throw new Error(
      `Size mismatch: ${actual.width}x${actual.height} vs ${baseline.width}x${baseline.height}`,
    );
  }
  const diff = createPng(actual.width, actual.height);
  const mismatched = pixelmatch(
    actual.data,
    baseline.data,
    diff.data,
    actual.width,
    actual.height,
    { threshold: 0.12, includeAA: false },
  );
  const ratio = mismatched / (actual.width * actual.height);
  if (ratio > maxDiffRatio) {
    const diffPath = saveDiffPng(caseName, diff);
    throw new Error(
      `Pixel diff ratio ${(ratio * 100).toFixed(2)}% exceeds ${(maxDiffRatio * 100).toFixed(2)}% — diff: ${diffPath}`,
    );
  }
  return { diffRatio: ratio };
}

export const UI_HIDE_IDS = [
  'ui',
  'controls',
  'horizon-indicator',
  'horizon-limb-line',
  'moon-scale-annotation',
  'fleet-cockpit-hud',
  'ground-preset-selector',
  'webgl-debug-panel',
  'ground-observer-overlay',
  'onboarding-overlay',
];

export async function hideChrome(page: Page): Promise<void> {
  await page.evaluate((ids) => {
    for (const id of ids) {
      document.getElementById(id)?.style.setProperty('display', 'none', 'important');
    }
  }, UI_HIDE_IDS);
}

export async function warmupAndCapture(page: Page, warmupFrames = 90): Promise<string> {
  await page.waitForFunction(() => {
    const w = window as unknown as { zephyrGL?: { capture: () => string } };
    return typeof w.zephyrGL?.capture === 'function';
  });
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
    const w = window as unknown as { zephyrGL: { capture: () => string } };
    return w.zephyrGL.capture();
  });
}

export function baselineExists(name: string): boolean {
  return (
    existsSync(join(BASELINES_DIR, `${name}.png`)) &&
    existsSync(join(BASELINES_DIR, `${name}.json`))
  );
}
