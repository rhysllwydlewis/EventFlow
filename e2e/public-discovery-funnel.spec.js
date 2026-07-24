import { test, expect } from '@playwright/test';
import {
  cleanupBackendFixtures,
  createRunId,
  seedBackendFixtures,
} from './helpers/backend-fixtures.js';

test.describe('Public discovery funnel against the real backend @backend', () => {
  const runId = createRunId('discovery');
  let fixtures;

  test.beforeAll(async ({ request }) => {
    fixtures = await seedBackendFixtures(request, runId);
  });

  test.afterAll(async ({ request }) => {
    await cleanupBackendFixtures(request, runId);
  });

  test('homepage exposes the current public discovery destinations', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('a[href="/suppliers"]').first()).toBeVisible();
    await expect(page.locator('a[href="/public-calendar"]').first()).toBeVisible();
    await expect(page.locator('a[href="/marketplace"]').first()).toBeVisible();
  });

  test('supplier search returns the seeded supplier with its clean public path', async ({
    request,
  }) => {
    const response = await request.get(
      `/api/v2/search/suppliers?q=${encodeURIComponent(fixtures.supplier.name)}&limit=20`
    );
    expect(response.ok()).toBe(true);
    const body = await response.json();
    const serialised = JSON.stringify(body);

    expect(serialised).toContain(fixtures.supplier.id);
    expect(serialised).toContain(fixtures.supplier.name);
    expect(serialised).toContain(fixtures.supplier.path);
  });

  test('supplier directory renders a result that links to the clean profile', async ({ page }) => {
    await page.goto(`/suppliers?q=${encodeURIComponent(fixtures.supplier.name)}`);
    const resultLink = page.locator(`a[href="${fixtures.supplier.path}"]`).first();
    await expect(resultLink).toBeVisible({ timeout: 15_000 });
    await expect(resultLink).toContainText(fixtures.supplier.name);
  });

  test('marketplace API and page expose an approved active listing', async ({ request, page }) => {
    const response = await request.get(
      `/api/marketplace/listings?search=${encodeURIComponent(fixtures.marketplaceListing.title)}`
    );
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.listings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: fixtures.marketplaceListing.id,
          title: fixtures.marketplaceListing.title,
          approved: true,
          status: 'active',
          sellerSupplierId: fixtures.supplier.id,
        }),
      ])
    );

    await page.goto(`/marketplace?search=${encodeURIComponent(fixtures.marketplaceListing.title)}`);
    await expect(page.getByText(fixtures.marketplaceListing.title, { exact: true })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('logged-out Create new listing uses the current account-first redirect contract', async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto('/marketplace');
    const createLink = page.locator('#hero-create-listing-btn');
    await expect(createLink).toBeVisible();
    await expect(createLink).toHaveAttribute(
      'href',
      '/auth?redirect=%2Fsupplier%2Fmarketplace-new-listing'
    );

    await createLink.click();
    await expect(page).toHaveURL(/\/auth\?redirect=/);
    const url = new URL(page.url());
    expect(url.searchParams.get('redirect')).toBe('/supplier/marketplace-new-listing');
  });
});
