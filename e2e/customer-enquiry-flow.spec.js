import { test, expect } from '@playwright/test';
import {
  cleanupBackendFixtures,
  createRunId,
  loginAs,
  seedBackendFixtures,
} from './helpers/backend-fixtures.js';

async function enquirySurface(page) {
  const dialog = page
    .locator('[role="dialog"]:visible')
    .filter({ hasText: /log in|message|enquir/i });
  return {
    authRedirect: new URL(page.url()).pathname === '/auth',
    messengerRedirect: new URL(page.url()).pathname.startsWith('/messenger'),
    dialogVisible: (await dialog.count()) > 0,
  };
}

test.describe('Customer enquiry journey against the real backend @backend', () => {
  const runId = createRunId('customer-enquiry');
  let fixtures;

  test.beforeAll(async ({ request }) => {
    fixtures = await seedBackendFixtures(request, runId);
  });

  test.afterAll(async ({ request }) => {
    await cleanupBackendFixtures(request, runId);
  });

  test('serves the approved supplier on its clean public URL', async ({ page }) => {
    await page.goto(fixtures.supplier.path);
    await expect(page.locator('#hero-title')).toHaveText(fixtures.supplier.name);
    await expect(page.locator('#btn-enquiry')).toBeVisible();
    await expect(page.locator('#btn-call')).toHaveAttribute('href', /^tel:/);
    await expect(page.locator('#sp-section-packages')).toBeAttached();
    await expect(page.locator('#sp-section-reviews')).toBeAttached();
  });

  test('redirects the historical supplier query URL to the clean profile in one hop', async ({
    request,
  }) => {
    const response = await request.get(`/supplier?id=${encodeURIComponent(fixtures.supplier.id)}`, {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(301);
    expect(response.headers().location).toBe(fixtures.supplier.path);
  });

  test('gates a logged-out enquiry with a login-aware message surface', async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto(fixtures.supplier.path);
    await expect(page.locator('#hero-title')).toHaveText(fixtures.supplier.name);
    await page.locator('#btn-enquiry').click();

    await expect
      .poll(async () => {
        const state = await enquirySurface(page);
        return state.authRedirect || state.messengerRedirect || state.dialogVisible;
      })
      .toBe(true);

    if (new URL(page.url()).pathname === '/auth') {
      const url = new URL(page.url());
      expect(url.searchParams.get('intent')).toBe('message');
      expect(url.searchParams.get('redirect')).toContain('/supplier/');
    } else {
      await expect(page.locator('[role="dialog"]:visible')).toContainText(/log in|message|enquir/i);
    }
  });

  test('opens the real compose journey for an authenticated customer', async ({ page }) => {
    await loginAs(page, fixtures.users.customer);
    await page.goto(fixtures.supplier.path);
    await expect(page.locator('#hero-title')).toHaveText(fixtures.supplier.name);
    await page.locator('#btn-enquiry').click();

    await expect
      .poll(async () => {
        const state = await enquirySurface(page);
        return state.messengerRedirect || state.dialogVisible;
      })
      .toBe(true);

    if (new URL(page.url()).pathname.startsWith('/messenger')) {
      const url = new URL(page.url());
      expect(url.searchParams.get('recipientId')).toBe(fixtures.users.supplier.id);
      expect(url.searchParams.get('contextId')).toBe(fixtures.supplier.id);
    } else {
      const dialog = page.locator('[role="dialog"]:visible');
      await expect(dialog).toContainText(/message|enquir/i);
    }
  });
});
