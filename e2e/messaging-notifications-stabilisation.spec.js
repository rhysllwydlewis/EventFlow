/**
 * Messaging + Notifications stabilisation checks.
 */

const { test, expect } = require('@playwright/test');

test.describe('Messaging + Notifications stabilisation', () => {
  test('Messenger page loads shared stabilisation helpers without asset 404s', async ({ page }) => {
    const asset404s = [];
    page.on('response', response => {
      if (
        response.status() === 404 &&
        /messaging-notifications-stabilisation|csrf-token|notification-state/.test(response.url())
      ) {
        asset404s.push(response.url());
      }
    });

    await page.goto('/messenger/');
    await page.waitForLoadState('domcontentloaded');

    expect(asset404s).toHaveLength(0);
    await expect(page.locator('.messenger-v4')).toBeVisible();
  });

  test('Notifications page exposes accessible notification controls', async ({ page }) => {
    await page.goto('/notifications');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('.filter-btn').first()).toBeVisible();
    await expect(page.locator('#mark-all-read-btn')).toHaveAttribute('type', /button/i);
    await expect(page.locator('#delete-all-btn')).toHaveAttribute('type', /button/i);
  });

  test('Notification bell has an accessible label when present', async ({ page }) => {
    await page.goto('/messenger/');
    await page.waitForLoadState('domcontentloaded');

    const bell = page.locator('#ef-notification-btn, #notification-bell').first();
    if ((await bell.count()) === 0) {
      test.skip(true, 'Notification bell is hidden for unauthenticated shell');
    }

    await expect(bell).toHaveAttribute('aria-label', /notification/i);
  });

  test('shared stabilisation runtime is exposed on Messenger page', async ({ page }) => {
    await page.goto('/messenger/');
    await page.waitForLoadState('domcontentloaded');

    const hasRuntime = await page.evaluate(() =>
      Boolean(window.__efMessagingNotificationsStabilised)
    );
    expect(hasRuntime).toBe(true);
  });
});
