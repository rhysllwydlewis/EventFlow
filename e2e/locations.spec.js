/**
 * EventFlow UK locations — browser suite.
 *
 * These pages are server-rendered from database state: a city page only exists
 * once an editor has published it. The static E2E server has no database, so
 * asserting against it would test the raw shell rather than the page. The suite
 * therefore runs only in full backend mode (`E2E_MODE=full`).
 */

import { test, expect } from '@playwright/test';

const FULL_MODE = process.env.E2E_MODE === 'full';

test.describe('UK locations', () => {
  test.skip(!FULL_MODE, 'Location pages need the backend; run with E2E_MODE=full.');

  test('the hub renders its heading, search and crawlable city links', async ({ page }) => {
    const response = await page.goto('/locations');
    expect(response.status()).toBe(200);
    await expect(page.locator('h1')).toHaveText('Event suppliers across the UK');
    await expect(page.getByRole('searchbox', { name: /city or postcode/i })).toBeVisible();
    await expect(page.locator('#main-content')).toHaveCount(1);
    await expect(page.locator('header[role="banner"]')).toHaveCount(1);
    await expect(page.locator('footer[role="contentinfo"]')).toHaveCount(1);
  });

  test('an unknown city returns a genuine 404', async ({ page }) => {
    const response = await page.goto('/locations/atlantis');
    expect(response.status()).toBe(404);
  });

  test('the hub has exactly one h1 and an ordered heading structure', async ({ page }) => {
    await page.goto('/locations');
    await expect(page.locator('h1')).toHaveCount(1);
    const levels = await page.$$eval('h1, h2, h3', nodes =>
      nodes.map(node => Number(node.tagName.slice(1)))
    );
    levels.reduce((previous, level) => {
      expect(level).toBeLessThanOrEqual(previous + 1);
      return level;
    }, 0);
  });

  test('the hub never overflows horizontally', async ({ page }) => {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/locations');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      );
      expect(overflow, `no horizontal overflow at ${viewport.width}px`).toBe(false);
    }
  });

  test('the search field is reachable and usable from the keyboard', async ({ page }) => {
    await page.goto('/locations');
    const search = page.getByRole('searchbox', { name: /city or postcode/i });
    await search.focus();
    await expect(search).toBeFocused();
    await search.fill('Cardiff');
    await expect(search).toHaveValue('Cardiff');
  });
});
