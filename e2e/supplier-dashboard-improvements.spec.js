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

    // One visible h1 (the greeting), the summary row and the verification strip's home.
    await expect(page.locator('h1:visible')).toHaveCount(1);
    await expect(page.locator('#welcome-heading')).toBeVisible();
    await expect(page.locator('#sdh-summary-grid')).toBeAttached();
    await expect(page.locator('#verification-status-banner')).toBeAttached();
  });

  test('shows the profile, packages, messages and support cards, once each, with no retired layers', async ({
    page,
  }) => {
    await loginAs(page, fixtures.users.supplier);
    await page.goto('/dashboard/supplier');

    for (const id of ['profile-card', 'packages-section', 'sdh-messages', 'sdh-support']) {
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }
    // The old section nav, hero chips, accordions and injected onboarding card are gone.
    await expect(
      page.locator('.dashboard-mobile-nav, .dashboard-hero, .card-collapse-btn')
    ).toHaveCount(0);
    await expect(page.locator('.onboarding-card, #onboarding-card')).toHaveCount(0);
  });

  test('renders without horizontal page overflow on a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, fixtures.users.supplier);
    await page.goto('/dashboard/supplier');
    await expect(page.locator('#welcome-heading')).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth,
    }));
    expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport + 2);
  });
});
