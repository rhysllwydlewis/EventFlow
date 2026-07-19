import { test, expect } from '@playwright/test';
import {
  cleanupBackendFixtures,
  createRunId,
  loginAs,
  seedBackendFixtures,
} from './helpers/backend-fixtures.js';

test.describe('Current supplier dashboard contracts @backend', () => {
  const runId = createRunId('supplier-dashboard');
  let fixtures;

  test.beforeAll(async ({ request }) => {
    fixtures = await seedBackendFixtures(request, runId);
  });

  test.afterAll(async ({ request }) => {
    await cleanupBackendFixtures(request, runId);
  });

  test('protects the supplier dashboard at the server', async ({ request }) => {
    const response = await request.get('/dashboard/supplier', {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(401);
  });

  test('loads the current dashboard shell for an authenticated supplier', async ({ page }) => {
    await loginAs(page, fixtures.users.supplier);
    const response = await page.goto('/dashboard/supplier');
    expect(response?.status()).toBe(200);

    await expect(page.locator('[data-test="supplier-mobile-nav"]')).toBeAttached();
    await expect(page.locator('[data-test="mobile-nav-pills"]')).toBeVisible();
    await expect(page.locator('[data-test="welcome-card"]')).toBeVisible();
    await expect(page.locator('#welcome-heading')).toContainText(/welcome/i);
    await expect(page.locator('#verification-status-banner')).toBeAttached();
  });

  test('exposes the current navigation destinations instead of retired onboarding cards', async ({
    page,
  }) => {
    await loginAs(page, fixtures.users.supplier);
    await page.goto('/dashboard/supplier');

    const navContracts = [
      ['nav-overview', 'data-section', 'welcome-section'],
      ['nav-profiles', 'data-section', 'my-suppliers'],
      ['nav-packages', 'data-section', 'my-packages'],
      ['nav-messages', 'data-section', 'threads-sup'],
      ['nav-stats', 'data-section', 'supplier-stats-grid'],
      ['nav-tickets', 'data-section', 'tickets-sup'],
      ['nav-settings', 'data-href', '/settings'],
    ];

    for (const [testId, attribute, target] of navContracts) {
      const nav = page.locator(`[data-test="${testId}"]`);
      await expect(nav).toBeVisible();
      await expect(nav).toHaveAttribute(attribute, target);
    }

    await expect(page.locator('.onboarding-card, #onboarding-card')).toHaveCount(0);
  });

  test('renders without horizontal page overflow on a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, fixtures.users.supplier);
    await page.goto('/dashboard/supplier');
    await expect(page.locator('[data-test="mobile-nav-pills"]')).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth,
    }));
    expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport + 2);
  });
});
