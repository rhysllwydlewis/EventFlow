/**
 * Admin Settings Navigation E2E Tests
 * Tests that admin settings links navigate correctly from admin pages
 *
 * Validates:
 * - Dropdown settings link navigates to /admin-settings (canonical clean URL)
 * - Quick action settings button navigates to /admin-settings
 */

import { test, expect } from '@playwright/test';

test.describe('Admin Settings Navigation', () => {
  test.beforeEach(async ({ page }) => {
    // Mock auth endpoint to return admin user
    await page.route('**/api/auth/me', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: 'admin1', role: 'admin', name: 'Admin User', email: 'admin@test.com' },
        }),
      });
    });

    // Mock CSRF token endpoint
    await page.route('**/api/csrf-token', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ csrfToken: 'test-token' }),
      });
    });

    // Mock admin data endpoints to prevent loading errors
    await page.route('**/api/admin/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], counts: {} }),
      });
    });
  });

  test('Admin dropdown settings link navigates to /admin-settings', async ({ page }) => {
    // Navigate to admin dashboard
    await page.goto('/admin.html');

    // Click the admin dropdown button to open menu
    const dropdownButton = page
      .locator('button.admin-user-dropdown, button[id*="dropdown"], button:has-text("Admin")')
      .first();
    await dropdownButton.click();

    // Find and click the settings link in dropdown
    const settingsLink = page.locator('a.admin-dropdown-item:has-text("Settings")');
    await expect(settingsLink).toBeVisible();

    // Verify the link has correct href (canonical clean URL, no .html extension)
    const href = await settingsLink.getAttribute('href');
    expect(href).toBe('/admin-settings');
  });

  test('Quick action settings button navigates to /admin-settings', async ({ page }) => {
    // Navigate to admin dashboard
    await page.goto('/admin.html');

    // Wait for page to load
    await page.waitForLoadState('domcontentloaded');

    // Find and click the Admin Settings quick action button
    const settingsButton = page.locator('button#adminSettingsBtn');
    await expect(settingsButton).toBeVisible();

    // Verify button has correct text
    await expect(settingsButton).toContainText('Settings');

    // Click the button
    await settingsButton.click();

    // Verify navigation to /admin-settings (canonical clean URL)
    await expect(page).toHaveURL(/\/admin-settings$/);
  });

  test('Settings dropdown link is correct on admin-users page', async ({ page }) => {
    // Navigate to admin users page
    await page.goto('/admin-users.html');

    // Click the admin dropdown button to open menu
    const dropdownButton = page
      .locator('button.admin-user-dropdown, button[id*="dropdown"], button:has-text("Admin")')
      .first();
    await dropdownButton.click();

    // Find the settings link in dropdown
    const settingsLink = page.locator('a.admin-dropdown-item:has-text("Settings")');
    await expect(settingsLink).toBeVisible();

    // Verify the link has correct href (canonical clean URL, no .html extension)
    const href = await settingsLink.getAttribute('href');
    expect(href).toBe('/admin-settings');
  });

  test('Settings dropdown link is correct on admin-packages page', async ({ page }) => {
    // Navigate to admin packages page
    await page.goto('/admin-packages.html');

    // Click the admin dropdown button to open menu
    const dropdownButton = page
      .locator('button.admin-user-dropdown, button[id*="dropdown"], button:has-text("Admin")')
      .first();
    await dropdownButton.click();

    // Find the settings link in dropdown
    const settingsLink = page.locator('a.admin-dropdown-item:has-text("Settings")');
    await expect(settingsLink).toBeVisible();

    // Verify the link has correct href (canonical clean URL, no .html extension)
    const href = await settingsLink.getAttribute('href');
    expect(href).toBe('/admin-settings');
  });
});
