import { expect, test, type Page } from '@playwright/test';

/**
 * A machine with `navigator.gpu` but no adapter (and no emoji font) at a short
 * 1024x594 window: the failure path must be readable, nothing may start a
 * renderer on its own, and the WebGL2 fallback is opt-in only.
 */

test.use({ viewport: { width: 1024, height: 594 } });

async function noAdapter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('grok-zephyr-onboarding-dismissed', 'true');
    const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<null> } }).gpu;
    if (gpu) gpu.requestAdapter = async () => null;
  });
}

test.describe('no WebGPU adapter', () => {
  test('fails loudly, fits the window, and does not start WebGL2 by itself', async ({ page }) => {
    await noAdapter(page);
    await page.goto('/');
    const overlay = page.locator('#webgpu-compatibility-overlay');
    await expect(overlay).toBeVisible();

    // The card sits inside the viewport rather than spilling past its border.
    // offsetTop/offsetHeight ignore the slide-in transform, which is still at its
    // 40px starting offset on the first frame.
    const card = await page.evaluate(() => {
      const el = document.querySelector('.compatibility-content') as HTMLElement;
      return { top: el.offsetTop, bottom: el.offsetTop + el.offsetHeight };
    });
    expect(card.top).toBeGreaterThanOrEqual(0);
    expect(card.bottom).toBeLessThanOrEqual(594);

    // "Get Chrome 113+" used to wrap, leaving "113+" as a stray fragment.
    for (const button of await page.locator('.option-btn').all()) {
      const box = await button.boundingBox();
      expect(box!.height).toBeLessThan(60);
    }
    await expect(page.locator('#compat-webgl2-btn')).toBeVisible();

    // Opt-in only: no fallback renderer and no fallback badge were started.
    await expect(page.locator('#renderer-fallback-badge')).toHaveCount(0);
    expect(await page.evaluate(() => 'zephyrGL' in window)).toBe(false);
  });

  test('locks the page, explains the placeholders and collapses the panel', async ({ page }) => {
    await noAdapter(page);
    await page.goto('/');
    await page.locator('#webgpu-compatibility-overlay').click({ position: { x: 4, y: 4 } });

    await expect(page.locator('#renderer-unavailable-banner')).toContainText('NO RENDERER');
    await expect(page.locator('#s-fps')).toContainText('n/a (no renderer)');
    await expect(page.locator('#s-visible')).toContainText('n/a (no renderer)');

    // The panel starts tucked away; the HUD title is not hidden by the banner.
    await expect(page.locator('#controls')).toBeHidden();
    const banner = await page.locator('#renderer-unavailable-banner').boundingBox();
    const title = await page.locator('#ui .title').boundingBox();
    expect(title!.y).toBeGreaterThanOrEqual(banner!.y + banner!.height);

    const toggle = page.locator('#controls-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#controls')).toBeVisible();

    // Expanded, it is bounded: it never grows past 60% of a short window.
    const panel = await page.locator('#controls').boundingBox();
    expect(panel!.y).toBeGreaterThanOrEqual(0);
    expect(panel!.height).toBeLessThanOrEqual(594 * 0.6 + 1);
    const overflowsX = await page.evaluate(() => {
      const el = document.getElementById('controls')!;
      return el.scrollWidth > el.clientWidth + 1;
    });
    expect(overflowsX).toBe(false);

    await toggle.click();
    await expect(page.locator('#controls')).toBeHidden();
  });

  test('labels carry no emoji that a font-less machine would draw as boxes', async ({ page }) => {
    await noAdapter(page);
    await page.goto('/');
    const text = await page.evaluate(() =>
      [...document.querySelectorAll('#controls button, #controls .time-label, #ground-preset-selector button')]
        .map((el) => el.textContent ?? '')
        .join(' '),
    );
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(text).toContain('HEARTBEAT');
  });
});

test.describe('WebGL2 opt-in', () => {
  test('?webgl2=1 shows a loud badge and disables what it cannot run', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('grok-zephyr-onboarding-dismissed', 'true');
    });
    await page.goto('/?webgl2=1&sats=2000');

    const badge = page.locator('#renderer-fallback-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('WEBGL2 FALLBACK');
    await expect(badge.getByRole('link', { name: 'Use WebGPU' })).toBeVisible();

    // Not persisted: the next plain visit would be WebGPU again.
    expect(await page.evaluate(() => localStorage.getItem('zephyr.renderer'))).toBeNull();

    // J2 / Keplerian / SGP4 are WebGPU-only, so they are disabled and say why.
    await expect(page.locator('#phys0')).toBeEnabled();
    for (const id of ['#phys1', '#phys2', '#phys3']) {
      await expect(page.locator(id)).toBeDisabled();
    }
    await expect(page.locator('#physicsNote')).toContainText('WebGPU');
    await expect(page.locator('#s-visible')).toContainText('n/a (WebGL2)');
  });

  test('the panel toggle remembers the choice across a reload', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('grok-zephyr-onboarding-dismissed', 'true');
    });
    await page.goto('/?webgl2=1&sats=2000');

    // 594px is a short window, so with no saved choice the panel starts tucked away.
    const toggle = page.locator('#controls-toggle');
    await expect(page.locator('#controls')).toBeHidden();
    await toggle.click();
    await expect(page.locator('#controls')).toBeVisible();

    await page.reload();
    await expect(page.locator('#controls')).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  test('the overlay button opts in with ?webgl2=1', async ({ page }) => {
    await noAdapter(page);
    await page.goto('/?sats=2000');
    await page.locator('#compat-webgl2-btn').click();
    await page.waitForURL(/webgl2=1/);
    expect(new URL(page.url()).searchParams.get('sats')).toBe('2000');
  });
});
