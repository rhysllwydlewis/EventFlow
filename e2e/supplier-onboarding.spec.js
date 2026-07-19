import { test, expect } from '@playwright/test';
import {
  cleanupBackendFixtures,
  createRunId,
  loginAs,
  seedBackendFixtures,
} from './helpers/backend-fixtures.js';

test.describe('Current account-first supplier onboarding @backend', () => {
  const runId = createRunId('supplier-onboarding');
  let fixtures;

  test.beforeAll(async ({ request }) => {
    fixtures = await seedBackendFixtures(request, runId);
  });

  test.afterAll(async ({ request }) => {
    await cleanupBackendFixtures(request, runId);
  });

  test('reveals supplier account essentials without recreating the retired full-profile form', async ({
    page,
  }) => {
    await page.goto('/auth');
    await page.locator('#tab-create').click();
    await page.locator('.role-pill[data-role="supplier"]').click();

    await expect(page.locator('#reg-role')).toHaveValue('supplier');
    await expect(page.locator('#supplier-fields')).toBeVisible();
    await expect(page.locator('#reg-company')).toBeVisible();
    await expect(page.locator('#reg-jobtitle')).toBeVisible();
    await expect(page.locator('#reg-website')).toBeVisible();
    await expect(page.locator('#reg-location')).toBeVisible();
    await expect(page.locator('#reg-postcode')).toBeVisible();

    // Category, long description and portfolio management now belong in the
    // authenticated dashboard rather than the account-creation form.
    await expect(page.locator('#sup-category, #sup-long, .gallery-upload')).toHaveCount(0);
  });

  test('keeps supplier-specific fields out of the customer account path', async ({ page }) => {
    await page.goto('/auth');
    await page.locator('#tab-create').click();
    await page.locator('.role-pill[data-role="customer"]').click();

    await expect(page.locator('#reg-role')).toHaveValue('customer');
    await expect(page.locator('#supplier-fields')).toBeHidden();
    await expect(page.locator('#reg-location')).toBeVisible();
  });

  test('blocks login until account email verification is complete', async ({ request }) => {
    const response = await request.post('/api/auth/login', {
      data: {
        email: fixtures.users.unverifiedEmail.email,
        password: fixtures.users.unverifiedEmail.password,
      },
    });
    expect(response.status()).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'Please verify your email address before signing in.',
    });
  });

  test('routes a verified supplier account to profile completion in the dashboard', async ({
    page,
  }) => {
    await loginAs(page, fixtures.users.pendingSupplier);
    await page.goto('/dashboard');
    await page.waitForURL('/dashboard/supplier');

    await expect(page.locator('#verification-status-banner')).toBeAttached();
    await expect(page.locator('#toggle-profile-form')).toBeVisible();
    await expect(page.locator('#supplier-form')).toBeAttached();
    await expect(page.locator('#sup-name')).toBeAttached();
    await expect(page.locator('#sup-category')).toBeAttached();
    await expect(page.locator('#sup-location')).toBeAttached();
    await expect(page.locator('#sup-long')).toBeAttached();
  });
});
