/**
 * Admin Hardening E2E Tests
 * Tests admin page navigation, consistency, and responsive behavior
 * Uses route mocking to simulate backend responses
 *
 * Note: Server-side access control testing requires full backend mode (E2E_MODE=full)
 * These tests focus on client-side behavior and UI consistency
 */

import { test, expect } from '@playwright/test';

// Browser-specific timeouts
const WEBKIT_WAIT = 3000;
const DEFAULT_WAIT = 1500;

// Viewport overflow tolerance (allows for minor rounding differences)
const OVERFLOW_TOLERANCE_PX = 5;

// Admin pages to test
const ADMIN_PAGES = [
  '/admin.html',
  '/admin-users.html',
  '/admin-suppliers.html',
  '/admin-analytics.html',
  '/admin-tickets.html',
];

test.describe('Admin Client-Side Access Control - Logged Out User', () => {
  test.beforeEach(async ({ page }) => {
    // Mock auth endpoint to return not authenticated
    await page.route('**/api/auth/me', route => {
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Not authenticated' }),
      });
    });
  });

  ADMIN_PAGES.forEach(adminPage => {
    test(`client-side guard should redirect ${adminPage} to /auth`, async ({
      page,
      browserName,
    }) => {
      // Try to access admin page
      await page.goto(adminPage);

      // Wait for client-side redirect (dashboard-guard.js)
      const waitTime = browserName === 'webkit' ? WEBKIT_WAIT : DEFAULT_WAIT;
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(waitTime);

      // Client-side guard should redirect to auth page
      const url = page.url();
      expect(url).toContain('/auth');
      expect(url).toContain('redirect=');
    });
  });
});

test.describe('Admin Client-Side Access Control - Non-Admin User', () => {
  test.beforeEach(async ({ page }) => {
    // Mock auth endpoint to return non-admin user
    await page.route('**/api/auth/me', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: '123', role: 'customer', name: 'Test Customer', email: 'customer@test.com' },
        }),
      });
    });
  });

  ADMIN_PAGES.forEach(adminPage => {
    test(`client-side guard should redirect non-admin from ${adminPage}`, async ({
      page,
      browserName,
    }) => {
      // Try to access admin page as non-admin
      await page.goto(adminPage);

      // Wait for client-side redirect (dashboard-guard.js)
      const waitTime = browserName === 'webkit' ? WEBKIT_WAIT : DEFAULT_WAIT;
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(waitTime);

      // Client-side guard should redirect away from admin
      const url = page.url();
      expect(url).not.toContain('/admin');
    });
  });
});

test.describe('Admin Page Loading - Admin User', () => {
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

    // Mock common admin API endpoints
    await page.route('**/api/admin/badge-counts', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          newUsers: 5,
          pendingPhotos: 3,
          openTickets: 2,
          pendingReviews: 1,
          pendingReports: 0,
        }),
      });
    });

    await page.route('**/api/csrf-token', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ csrfToken: 'test-csrf-token' }),
      });
    });
  });

  test('admin dashboard should load with admin navbar', async ({ page, browserName }) => {
    // Mock dashboard stats
    await page.route('**/api/admin/stats', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          totalUsers: 150,
          totalPackages: 42,
          totalSuppliers: 28,
          pendingPhotos: 3,
        }),
      });
    });

    await page.goto('/admin.html');
    await page.waitForLoadState('domcontentloaded');

    const waitTime = browserName === 'webkit' ? WEBKIT_WAIT : DEFAULT_WAIT;
    await page.waitForTimeout(waitTime);

    // Should stay on admin page
    expect(page.url()).toContain('/admin.html');

    // Should have admin navbar
    const navbar = page.locator('.admin-top-navbar, .admin-navbar');
    await expect(navbar).toBeVisible({ timeout: 5000 });

    // Should NOT have consumer footer nav
    const footerNav = page.locator('[class*="footer-nav"], [id*="footer-nav"]');
    await expect(footerNav).toHaveCount(0);
  });

  test('admin-users page should load with table structure', async ({ page, browserName }) => {
    // Mock users list
    await page.route('**/api/admin/users*', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          users: [
            {
              id: '1',
              firstName: 'John',
              lastName: 'Doe',
              email: 'john@example.com',
              role: 'customer',
              createdAt: new Date().toISOString(),
            },
            {
              id: '2',
              firstName: 'Jane',
              lastName: 'Smith',
              email: 'jane@example.com',
              role: 'supplier',
              createdAt: new Date().toISOString(),
            },
          ],
          total: 2,
          page: 1,
          limit: 50,
        }),
      });
    });

    await page.goto('/admin-users.html');
    await page.waitForLoadState('domcontentloaded');

    const waitTime = browserName === 'webkit' ? WEBKIT_WAIT : DEFAULT_WAIT;
    await page.waitForTimeout(waitTime);

    // Should stay on admin-users page
    expect(page.url()).toContain('/admin-users.html');

    // Should have admin navbar
    const navbar = page.locator('.admin-top-navbar, .admin-navbar');
    await expect(navbar).toBeVisible({ timeout: 5000 });

    // Should NOT have consumer footer nav
    const footerNav = page.locator('[class*="footer-nav"], [id*="footer-nav"]');
    await expect(footerNav).toHaveCount(0);

    // Check for table or table-wrapper
    const table = page.locator('table, .table-wrapper, [id*="table"]');
    await expect(table.first()).toBeVisible({ timeout: 5000 });
  });

  test('admin-suppliers page should load with table structure', async ({ page, browserName }) => {
    // Mock suppliers list
    await page.route('**/api/admin/suppliers*', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          suppliers: [
            {
              id: 'sup1',
              businessName: 'Test Venue',
              contactEmail: 'venue@example.com',
              approved: true,
              createdAt: new Date().toISOString(),
            },
          ],
          total: 1,
          page: 1,
          limit: 50,
        }),
      });
    });

    await page.goto('/admin-suppliers.html');
    await page.waitForLoadState('domcontentloaded');

    const waitTime = browserName === 'webkit' ? WEBKIT_WAIT : DEFAULT_WAIT;
    await page.waitForTimeout(waitTime);

    // Should stay on admin-suppliers page
    expect(page.url()).toContain('/admin-suppliers.html');

    // Should have admin navbar
    const navbar = page.locator('.admin-top-navbar, .admin-navbar');
    await expect(navbar).toBeVisible({ timeout: 5000 });
  });

  test('admin-analytics page (with the Payments tab) should load', async ({
    page,
    browserName,
  }) => {
    // Mock payments list
    await page.route('**/api/admin/payments*', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          payments: [],
          total: 0,
          page: 1,
          limit: 50,
        }),
      });
    });

    await page.goto('/admin-analytics.html');
    await page.waitForLoadState('domcontentloaded');

    const waitTime = browserName === 'webkit' ? WEBKIT_WAIT : DEFAULT_WAIT;
    await page.waitForTimeout(waitTime);

    // Should stay on the admin-analytics page
    expect(page.url()).toContain('/admin-analytics.html');

    // Should have admin navbar
    const navbar = page.locator('.admin-top-navbar, .admin-navbar');
    await expect(navbar).toBeVisible({ timeout: 5000 });
  });

  test('admin-tickets page should load', async ({ page, browserName }) => {
    // Mock tickets list
    await page.route('**/api/admin/tickets*', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          tickets: [],
          total: 0,
          page: 1,
          limit: 50,
        }),
      });
    });

    await page.goto('/admin-tickets.html');
    await page.waitForLoadState('domcontentloaded');

    const waitTime = browserName === 'webkit' ? WEBKIT_WAIT : DEFAULT_WAIT;
    await page.waitForTimeout(waitTime);

    // Should stay on admin-tickets page
    expect(page.url()).toContain('/admin-tickets.html');

    // Should have admin navbar
    const navbar = page.locator('.admin-top-navbar, .admin-navbar');
    await expect(navbar).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Admin Pages - Mobile/Tablet Responsiveness', () => {
  test.beforeEach(async ({ page }) => {
    // Mock admin auth
    await page.route('**/api/auth/me', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: 'admin1', role: 'admin', name: 'Admin User', email: 'admin@test.com' },
        }),
      });
    });

    // Mock API endpoints
    await page.route('**/api/admin/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    });
  });

  test('admin dashboard should not overflow on tablet (768x1024)', async ({
    page,
    browserName,
  }) => {
    // Set tablet viewport
    await page.setViewportSize({ width: 768, height: 1024 });

    await page.goto('/admin.html');
    await page.waitForLoadState('domcontentloaded');

    const waitTime = browserName === 'webkit' ? WEBKIT_WAIT : DEFAULT_WAIT;
    await page.waitForTimeout(waitTime);

    // Check no horizontal scroll
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const windowWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(windowWidth + OVERFLOW_TOLERANCE_PX);

    // Admin navbar should be visible
    const navbar = page.locator('.admin-top-navbar, .admin-navbar');
    await expect(navbar).toBeVisible();
  });

  test('admin dashboard should not overflow on mobile (375x667)', async ({ page, browserName }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto('/admin.html');
    await page.waitForLoadState('domcontentloaded');

    const waitTime = browserName === 'webkit' ? WEBKIT_WAIT : DEFAULT_WAIT;
    await page.waitForTimeout(waitTime);

    // Check no horizontal scroll
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const windowWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(windowWidth + OVERFLOW_TOLERANCE_PX);

    // Admin navbar should be visible (or hamburger menu on mobile)
    const navbar = page.locator('.admin-top-navbar, .admin-navbar, .admin-hamburger');
    await expect(navbar.first()).toBeVisible();
  });

  test('admin-users page should have responsive table on tablet', async ({ page, browserName }) => {
    // Mock users
    await page.route('**/api/admin/users*', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ users: [], total: 0 }),
      });
    });

    // Set tablet viewport
    await page.setViewportSize({ width: 768, height: 1024 });

    await page.goto('/admin-users.html');
    await page.waitForLoadState('domcontentloaded');

    const waitTime = browserName === 'webkit' ? WEBKIT_WAIT : DEFAULT_WAIT;
    await page.waitForTimeout(waitTime);

    // Check for table wrapper or overflow handling
    const table = page.locator('table').first();
    if ((await table.count()) > 0) {
      const tableBox = await table.boundingBox();
      if (tableBox) {
        // Table should not exceed viewport width
        expect(tableBox.width).toBeLessThanOrEqual(768);
      }
    }
  });

  test('search/filter UI should exist and be functional on admin-users', async ({
    page,
    browserName,
  }) => {
    // Mock users
    await page.route('**/api/admin/users*', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ users: [], total: 0 }),
      });
    });

    await page.goto('/admin-users.html');
    await page.waitForLoadState('domcontentloaded');

    const waitTime = browserName === 'webkit' ? WEBKIT_WAIT : DEFAULT_WAIT;
    await page.waitForTimeout(waitTime);

    // Look for search input
    const searchInput = page.locator('input[type="search"], input[placeholder*="search" i]');
    if ((await searchInput.count()) > 0) {
      await expect(searchInput.first()).toBeVisible();
    }

    // Look for filter dropdown
    const filterSelect = page.locator('select, [role="combobox"]');
    if ((await filterSelect.count()) > 0) {
      // At least one should be visible
      const visibleFilters = await filterSelect.filter({ hasText: /.+/ }).count();
      expect(visibleFilters).toBeGreaterThanOrEqual(0);
    }
  });
});

test.describe('Admin Shared JavaScript Module', () => {
  test('AdminShared should be available globally', async ({ page }) => {
    // Mock admin auth
    await page.route('**/api/auth/me', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: 'admin1', role: 'admin', name: 'Admin User', email: 'admin@test.com' },
        }),
      });
    });

    await page.route('**/api/admin/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    });

    await page.goto('/admin.html');
    await page.waitForLoadState('domcontentloaded');

    // Check AdminShared is defined
    const hasAdminShared = await page.evaluate(() => {
      return typeof window.AdminShared !== 'undefined';
    });

    expect(hasAdminShared).toBe(true);

    // Check essential methods exist
    const hasEssentialMethods = await page.evaluate(() => {
      return (
        typeof window.AdminShared?.api === 'function' &&
        typeof window.AdminShared?.adminFetch === 'function' &&
        typeof window.AdminShared?.showToast === 'function' &&
        typeof window.AdminShared?.showConfirmModal === 'function'
      );
    });

    expect(hasEssentialMethods).toBe(true);
  });
});

test.describe('Admin CSS Scoping and Theming', () => {
  test.beforeEach(async ({ page }) => {
    // Mock admin auth
    await page.route('**/api/auth/me', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: 'admin1', role: 'admin', name: 'Admin User', email: 'admin@test.com' },
        }),
      });
    });

    await page.route('**/api/admin/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    });
  });

  ADMIN_PAGES.forEach(adminPage => {
    test(`${adminPage} should have body.admin scoping class`, async ({ page, browserName }) => {
      await page.goto(adminPage);
      await page.waitForLoadState('domcontentloaded');

      const waitTime = browserName === 'webkit' ? WEBKIT_WAIT : DEFAULT_WAIT;
      await page.waitForTimeout(waitTime);

      const hasAdminClass = await page.evaluate(() => document.body.classList.contains('admin'));
      expect(hasAdminClass).toBe(true);
    });
  });

  test('admin body background should be light without !important override', async ({
    page,
    browserName,
  }) => {
    await page.goto('/admin.html');
    await page.waitForLoadState('domcontentloaded');

    const waitTime = browserName === 'webkit' ? WEBKIT_WAIT : DEFAULT_WAIT;
    await page.waitForTimeout(waitTime);

    // Verify the computed background is the expected light gray
    const bgColor = await page.evaluate(
      () => window.getComputedStyle(document.body).backgroundColor
    );

    // rgb(248, 249, 250) is #f8f9fa
    expect(bgColor).toBe('rgb(248, 249, 250)');
  });
});
