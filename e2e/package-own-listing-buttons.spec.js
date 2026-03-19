/**
 * PR721 – Own-package button states ("Your listing")
 *
 * When the authenticated user is the owner of a supplier listing, the
 * "Save Package", "Add to Plan", and "Message Supplier" buttons on the
 * package detail page must be disabled and relabelled "Your listing" /
 * "✉️ Your listing" so the supplier cannot interact with their own listing.
 *
 * The serve-static.js stub honours the cookie `test_auth=owner` to simulate
 * an authenticated supplier owner (id: mock-owner-1) — the same id that is
 * set as ownerUserId on the mock package supplier.
 */

const { test, expect } = require('@playwright/test');

const MOCK_SLUG = 'test-own-package';

test.describe('Package Detail – Own-listing button states (PR721)', () => {
  // ── Logged-out: buttons are interactive ───────────────────────────────────
  test.describe('Visitor (not logged in)', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/package?slug=${MOCK_SLUG}`);
      await page.waitForSelector('#package-content', { state: 'visible', timeout: 15000 });
    });

    test('Save Package button is enabled', async ({ page }) => {
      const btn = page.locator('#pkg-save-package-btn');
      await expect(btn).toBeVisible();
      await expect(btn).not.toBeDisabled();
    });

    test('Add to Plan button is enabled', async ({ page }) => {
      const btn = page.locator('#pkg-add-to-plan-btn');
      await expect(btn).toBeVisible();
      await expect(btn).not.toBeDisabled();
    });

    test('Message Supplier button is enabled', async ({ page }) => {
      const btn = page.locator('#pkg-message-btn');
      await expect(btn).toBeVisible();
      await expect(btn).not.toBeDisabled();
    });
  });

  // ── Owner: buttons are disabled with "Your listing" label ─────────────────
  test.describe('Supplier owner viewing own package', () => {
    test.beforeEach(async ({ context, page }) => {
      // Inject the test cookie that makes /api/v1/auth/me return mock-owner-1
      // The playwright baseURL is http://127.0.0.1:4173 in CI static mode.
      // Cookies must match the host the browser actually talks to.
      await context.addCookies([
        {
          name: 'test_auth',
          value: 'owner',
          domain: '127.0.0.1',
          path: '/',
        },
      ]);
      await page.goto(`/package?slug=${MOCK_SLUG}`);
      await page.waitForSelector('#package-content', { state: 'visible', timeout: 15000 });
    });

    test('Save Package button is disabled', async ({ page }) => {
      const btn = page.locator('#pkg-save-package-btn');
      await expect(btn).toBeVisible();
      await expect(btn).toBeDisabled();
    });

    test('Save Package button shows "Your listing" label', async ({ page }) => {
      const btn = page.locator('#pkg-save-package-btn');
      await expect(btn).toHaveText('Your listing');
    });

    test('Add to Plan button is disabled', async ({ page }) => {
      const btn = page.locator('#pkg-add-to-plan-btn');
      await expect(btn).toBeVisible();
      await expect(btn).toBeDisabled();
    });

    test('Add to Plan button shows "Your listing" label', async ({ page }) => {
      const btn = page.locator('#pkg-add-to-plan-btn');
      await expect(btn).toHaveText('Your listing');
    });

    test('Message Supplier button is disabled', async ({ page }) => {
      const btn = page.locator('#pkg-message-btn');
      await expect(btn).toBeVisible();
      await expect(btn).toBeDisabled();
    });

    test('Message Supplier button shows "Your listing" label', async ({ page }) => {
      const btn = page.locator('#pkg-message-btn');
      const text = await btn.textContent();
      // May include an emoji prefix — key substring is "Your listing"
      expect(text).toContain('Your listing');
    });
  });
});
