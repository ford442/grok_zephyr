import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Accessibility scan of the UI layer.
 *
 * The WebGL canvas itself is opaque to axe, so these assertions cover the
 * chrome around it: controls, panels, overlays and live regions.
 */

async function gotoApp(page: Page): Promise<void> {
  // The onboarding modal covers the controls; mark it dismissed before the app
  // boots so these tests exercise the main UI. It gets its own coverage below.
  await page.addInitScript(() => {
    localStorage.setItem('grok-zephyr-onboarding-dismissed', 'true');
  });
  await page.goto('/?renderer=webgl');
  // The control panel is the surface under test; wait for it rather than for
  // first paint, so the scan does not race UI construction.
  await page.waitForSelector('#controls', { state: 'attached' });
  await page.waitForTimeout(1500);
}

test.describe('accessibility', () => {
  test('has no serious or critical axe violations', async ({ page }) => {
    await gotoApp(page);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const blocking = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );

    // Print enough detail that a CI failure is actionable without a rerun.
    if (blocking.length > 0) {
      console.error(
        JSON.stringify(
          blocking.map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            help: violation.help,
            nodes: violation.nodes.slice(0, 5).map((node) => node.target),
          })),
          null,
          2,
        ),
      );
    }

    expect(blocking).toEqual([]);
  });

  test('has no serious or critical axe violations with onboarding open', async ({ page }) => {
    // The modal is the first thing a new user meets, and it is not in the DOM
    // for the scan above, so it needs its own pass.
    await page.goto('/?renderer=webgl');
    await page.waitForSelector('#onboarding-overlay', { state: 'visible' });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const blocking = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    if (blocking.length > 0) {
      console.error(JSON.stringify(blocking.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), null, 2));
    }
    expect(blocking).toEqual([]);
  });

  test('canvas exposes an accessible description of the active view', async ({ page }) => {
    await gotoApp(page);

    const canvas = page.locator('#gpu-canvas');
    await expect(canvas).toHaveAttribute('role', 'img');

    const initial = await canvas.getAttribute('aria-label');
    expect(initial).toBeTruthy();
    expect(initial).toMatch(/720 ?km Horizon/i);

    // Switching view must update the description, not leave it stale.
    await page.locator('#btn1').click();
    await expect(canvas).toHaveAttribute('aria-label', /God View/i);
  });

  test('announces view changes politely', async ({ page }) => {
    await gotoApp(page);

    const status = page.locator('#view-announcer');
    await expect(status).toHaveAttribute('aria-live', 'polite');
    await expect(status).toHaveAttribute('role', 'status');

    await page.locator('#btn1').click();
    await expect(status).toHaveText(/God View/i);
  });

  test('view modes are reachable by number key', async ({ page }) => {
    await gotoApp(page);

    await page.locator('body').press('2');
    await expect(page.locator('#gpu-canvas')).toHaveAttribute('aria-label', /God View/i);

    await page.locator('body').press('1');
    await expect(page.locator('#gpu-canvas')).toHaveAttribute('aria-label', /720 ?km Horizon/i);
  });

  test('shortcut overlay opens with ? and returns focus on close', async ({ page }) => {
    await gotoApp(page);

    const overlay = page.locator('#shortcut-overlay');
    await expect(overlay).toBeHidden();

    await page.locator('body').press('?');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute('role', 'dialog');

    // Escape must close it — a keyboard user has to be able to get out.
    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();
  });

  test('every control is reachable by keyboard alone', async ({ page }) => {
    await gotoApp(page);

    // Tab through the document and confirm the view buttons are all reachable.
    const reached = new Set<string>();
    for (let i = 0; i < 120; i++) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate(() => document.activeElement?.id ?? '');
      if (id) reached.add(id);
    }

    for (const id of ['btn0', 'btn1', 'btn3']) {
      expect(reached, `${id} should be keyboard reachable`).toContain(id);
    }
  });

  test('onboarding modal contains focus while open', async ({ page }) => {
    // Deliberately do NOT dismiss onboarding here.
    await page.goto('/?renderer=webgl');
    const overlay = page.locator('#onboarding-overlay');
    await expect(overlay).toBeVisible();

    // Tab well past the modal's own controls; focus must never escape it.
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(
        () => document.getElementById('onboarding-overlay')?.contains(document.activeElement) ?? false,
      );
      expect(inside, `focus escaped the modal after ${i + 1} tabs`).toBe(true);
    }
  });

  test('respects prefers-reduced-motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoApp(page);

    const reduced = await page.evaluate(
      () => document.documentElement.dataset.reducedMotion,
    );
    expect(reduced).toBe('true');
  });
});
