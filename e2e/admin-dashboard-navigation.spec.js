/**
 * Admin Dashboard Navigation E2E Tests
 *
 * Verifies that every admin dashboard button, quick-action card, moderation
 * button, and export button is wired correctly and navigates to the expected
 * destination using canonical clean URLs (no .html extensions).
 *
 * Uses route mocking — no live backend required (static-mode friendly).
 */

import { test, expect } from '@playwright/test';

// Shared mock setup extracted so each test starts with a clean slate
async function setupAdminMocks(page) {
  // Authenticate as admin
  await page.route('**/api/auth/me', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: { id: 'admin1', role: 'admin', name: 'Admin User', email: 'admin@test.com' },
      }),
    })
  );

  // CSRF tokens
  for (const pattern of ['**/api/csrf-token', '**/api/v1/csrf-token', '**/api/v1/auth/csrf']) {
    await page.route(pattern, route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ csrfToken: 'test-csrf-token' }),
      })
    );
  }

  // Badge counts
  await page.route('**/api/admin/badge-counts', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ newUsers: 2, pendingPhotos: 1, openTickets: 0, pendingReviews: 0 }),
    })
  );

  // Generic admin API fallback — return empty but valid response
  await page.route('**/api/admin/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [],
        users: [],
        suppliers: [],
        packages: [],
        photos: [],
        reviews: [],
        reports: [],
        counts: {},
      }),
    })
  );

  // Feature flags
  await page.route('**/api/features**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ features: {} }),
    })
  );
}

test.describe('Admin Dashboard — Quick Action Buttons', () => {
  // Map of button ID → expected canonical URL the button should navigate to
  const quickActions = [
    { id: 'userManagementBtn', label: 'User Management', href: '/admin-users' },
    { id: 'packageManagementBtn', label: 'Packages', href: '/admin-packages' },
    { id: 'homepageChangesBtn', label: 'Homepage', href: '/admin-homepage' },
    { id: 'supportTicketsBtn', label: 'Tickets', href: '/admin-tickets' },
    { id: 'paymentsAnalyticsBtn', label: 'Payments', href: '/admin-payments' },
    { id: 'reportsQueueBtn', label: 'Reports', href: '/admin-reports' },
    { id: 'auditLogBtn', label: 'Audit Log', href: '/admin-audit' },
    { id: 'adminSettingsBtn', label: 'Settings', href: '/admin-settings' },
  ];

  quickActions.forEach(({ id, label, href }) => {
    test(`"${label}" button (${id}) navigates to ${href}`, async ({ page }) => {
      await setupAdminMocks(page);
      await page.goto('/admin.html');
      await page.waitForLoadState('domcontentloaded');

      const btn = page.locator(`#${id}`);
      await expect(btn).toBeVisible({ timeout: 5000 });

      await btn.click();

      // Canonical URL — no .html extension
      // Use pathname check rather than dynamic regex construction
      await expect(page).toHaveURL(url => new URL(url).pathname === href);
    });
  });
});

test.describe('Admin Dashboard — Moderation Queue Buttons', () => {
  const moderationButtons = [
    { id: 'reviewPhotosBtn', label: 'Review Photos', href: '/admin-photos' },
    { id: 'reviewReportsBtn', label: 'Review Reports', href: '/admin-reports' },
    { id: 'verifySuppliersBtn', label: 'Verify Suppliers', href: '/admin-suppliers' },
  ];

  moderationButtons.forEach(({ id, label, href }) => {
    test(`"${label}" moderation button (${id}) navigates to ${href}`, async ({ page }) => {
      await setupAdminMocks(page);
      await page.goto('/admin.html');
      await page.waitForLoadState('domcontentloaded');

      const btn = page.locator(`#${id}`);
      await expect(btn).toBeVisible({ timeout: 5000 });

      await btn.click();

      // Must land on canonical clean URL — no .html extension
      // Use pathname check rather than dynamic regex construction
      await expect(page).toHaveURL(url => new URL(url).pathname === href);
    });
  });
});

test.describe('Admin Dashboard — Export Buttons', () => {
  test('Export Users (downloadUsersCsv) triggers API download', async ({ page }) => {
    await setupAdminMocks(page);

    // Intercept the export request
    let exportRequested = false;
    await page.route('**/api/v1/admin/users-export**', route => {
      exportRequested = true;
      route.fulfill({ status: 200, contentType: 'text/csv', body: 'id,name\n1,Test' });
    });

    await page.goto('/admin.html');
    await page.waitForLoadState('domcontentloaded');

    const btn = page.locator('#downloadUsersCsv');
    await expect(btn).toBeVisible({ timeout: 5000 });
    await btn.click();

    // Give page a moment to initiate navigation/fetch
    await page.waitForTimeout(500);
    expect(exportRequested).toBe(true);
  });

  test('Export Marketing (downloadMarketingCsv) triggers API download', async ({ page }) => {
    await setupAdminMocks(page);

    let exportRequested = false;
    await page.route('**/api/v1/admin/marketing-export**', route => {
      exportRequested = true;
      route.fulfill({ status: 200, contentType: 'text/csv', body: 'email\ntest@example.com' });
    });

    await page.goto('/admin.html');
    await page.waitForLoadState('domcontentloaded');

    const btn = page.locator('#downloadMarketingCsv');
    await expect(btn).toBeVisible({ timeout: 5000 });
    await btn.click();

    await page.waitForTimeout(500);
    expect(exportRequested).toBe(true);
  });

  test('Export All Data (downloadAllJson) triggers API download', async ({ page }) => {
    await setupAdminMocks(page);

    let exportRequested = false;
    await page.route('**/api/v1/admin/export/all**', route => {
      exportRequested = true;
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/admin.html');
    await page.waitForLoadState('domcontentloaded');

    const btn = page.locator('#downloadAllJson');
    await expect(btn).toBeVisible({ timeout: 5000 });
    await btn.click();

    await page.waitForTimeout(500);
    expect(exportRequested).toBe(true);
  });
});

test.describe('Admin Dashboard — Navbar Links', () => {
  const navLinks = [
    { text: 'Dashboard', href: '/admin' },
    { text: 'Users', href: '/admin-users' },
    { text: 'Suppliers', href: '/admin-suppliers' },
    { text: 'Packages', href: '/admin-packages' },
    { text: 'Photos', href: '/admin-photos' },
    { text: 'Tickets', href: '/admin-tickets' },
    { text: 'Reports', href: '/admin-reports' },
    { text: 'Audit', href: '/admin-audit' },
    { text: 'Homepage', href: '/admin-homepage' },
    { text: 'Payments', href: '/admin-payments' },
    { text: 'Content', href: '/admin-content' },
    { text: 'Settings', href: '/admin-settings' },
  ];

  navLinks.forEach(({ text, href }) => {
    test(`Navbar link "${text}" has canonical href ${href}`, async ({ page }) => {
      await setupAdminMocks(page);
      await page.goto('/admin.html');
      await page.waitForLoadState('domcontentloaded');

      const link = page.locator(`.admin-nav-btn:has-text("${text}")`).first();
      await expect(link).toBeVisible({ timeout: 5000 });

      const actualHref = await link.getAttribute('href');
      expect(actualHref).toBe(href);
    });
  });
});

test.describe('Admin Dashboard — Refresh Button', () => {
  test('Refresh button (refreshBtn) triggers data reload without page navigation', async ({
    page,
  }) => {
    await setupAdminMocks(page);

    let apiCallCount = 0;
    // Override to count calls
    await page.route('**/api/admin/users**', route => {
      apiCallCount++;
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [] }),
      });
    });

    await page.goto('/admin.html');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500); // let initial load settle

    const initialUrl = page.url();
    const initialCallCount = apiCallCount;

    const refreshBtn = page.locator('#refreshBtn');
    await expect(refreshBtn).toBeVisible({ timeout: 5000 });
    await refreshBtn.click();

    await page.waitForTimeout(500);

    // URL should not have changed
    expect(page.url()).toBe(initialUrl);
    // Should have made additional API calls
    expect(apiCallCount).toBeGreaterThan(initialCallCount);
  });
});

test.describe('Admin Dashboard — Dropdown Navigation', () => {
  test('Admin user dropdown opens on click', async ({ page }) => {
    await setupAdminMocks(page);
    await page.goto('/admin.html');
    await page.waitForLoadState('domcontentloaded');

    const userBtn = page.locator('#adminUserBtn');
    await expect(userBtn).toBeVisible({ timeout: 5000 });

    // Dropdown should not be visible initially
    const dropdown = page.locator('#adminDropdownMenu');
    const isOpen = await dropdown.evaluate(
      el => !el.classList.contains('hidden') && el.offsetParent !== null
    );

    // Click to open
    await userBtn.click();
    await page.waitForTimeout(200);

    // Settings and logout should be in the dropdown
    const settingsLink = page.locator('#adminDropdownMenu a:has-text("Settings")');
    await expect(settingsLink).toBeVisible({ timeout: 2000 });
  });

  test('Settings link in dropdown has clean canonical href /admin-settings', async ({ page }) => {
    await setupAdminMocks(page);
    await page.goto('/admin.html');
    await page.waitForLoadState('domcontentloaded');

    const settingsLink = page.locator('#adminDropdownMenu a:has-text("Settings")');
    const href = await settingsLink.getAttribute('href');
    expect(href).toBe('/admin-settings');
  });
});
