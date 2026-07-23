import { test, expect } from '@playwright/test';
import {
  cleanupBackendFixtures,
  createRunId,
  loginAs,
  seedBackendFixtures,
} from './helpers/backend-fixtures.js';

async function dismissCookieConsent(page) {
  const reject = page.getByRole('button', { name: 'Reject non-essential cookies' });
  if (await reject.isVisible().catch(() => false)) {
    await reject.click();
  }
}

async function waitForEnquiryWiring(page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const button = document.getElementById('btn-enquiry');
        return Boolean(
          window.__supplierData?.messagingRecipientId &&
            typeof window.QuickComposeV4?.open === 'function' &&
            typeof button?.onclick === 'function' &&
            button?.dataset.supplierComposeReady === 'true'
        );
      })
    )
    .toBe(true);
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
    await waitForEnquiryWiring(page);
  });

  test('redirects the historical supplier query URL to the clean profile in one hop', async ({
    request,
  }) => {
    const response = await request.get(
      `/supplier?id=${encodeURIComponent(fixtures.supplier.id)}`,
      {
        maxRedirects: 0,
      }
    );
    expect(response.status()).toBe(301);
    expect(response.headers().location).toBe(fixtures.supplier.path);
  });

  test('gates a logged-out enquiry through the current Quick Compose auth handoff', async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto(fixtures.supplier.path);
    await expect(page.locator('#hero-title')).toHaveText(fixtures.supplier.name);
    await dismissCookieConsent(page);
    await waitForEnquiryWiring(page);

    await Promise.all([
      page.waitForURL(/\/auth\?redirect=/, { timeout: 15_000 }),
      page.locator('#btn-enquiry').click(),
    ]);

    const url = new URL(page.url());
    expect(url.searchParams.get('redirect')).toContain(fixtures.supplier.path);
  });

  test('opens the real compose panel for an authenticated customer', async ({ page }) => {
    await loginAs(page, fixtures.users.customer);
    await page.goto(fixtures.supplier.path);
    await expect(page.locator('#hero-title')).toHaveText(fixtures.supplier.name);
    await dismissCookieConsent(page);
    await waitForEnquiryWiring(page);
    await page.locator('#btn-enquiry').click();

    const dialog = page.locator('.qcv4-panel.qcv4-panel--visible[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.locator('#qcv4-title')).toHaveText('New Message');
    await expect(dialog.locator('#qcv4-recipient')).toHaveValue(fixtures.users.supplier.id);
    await expect(dialog.locator('#qcv4-message')).toHaveValue(/enquire about your services/i);
    await expect(dialog).toContainText(fixtures.supplier.name);
  });
});
