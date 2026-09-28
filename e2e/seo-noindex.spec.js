import { test, expect } from '@playwright/test';

/**
 * SEO Noindex E2E Tests
 *
 * Tests that non-public/authenticated pages have X-Robots-Tag: noindex, nofollow header
 * This prevents search engines from indexing private content
 */

test.describe('SEO Noindex Headers', () => {
  const noindexPages = [
    '/auth.html',
    '/reset-password.html',
    '/dashboard.html',
    '/dashboard-customer.html',
    '/dashboard-supplier.html',
    '/messages.html',
    '/guests.html',
    '/checkout.html',
    '/my-marketplace-listings.html',
    // Canonical extensionless URLs — these are what production actually
    // serves; a bare X-Robots-Tag check on only the .html suffix previously
    // let a real gap ship unnoticed (see middleware/seo.js).
    '/auth',
    '/reset-password',
    '/dashboard',
    '/dashboard-customer',
    '/dashboard-supplier',
    '/messages',
    '/guests',
    '/checkout',
    '/my-marketplace-listings',
    '/gallery',
  ];

  const adminPages = [
    '/admin.html',
    '/admin-users.html',
    '/admin-suppliers.html',
    '/admin-packages.html',
  ];

  // Test non-authenticated pages
  for (const pagePath of noindexPages) {
    test(`${pagePath} should have X-Robots-Tag: noindex, nofollow header`, async ({ page }) => {
      const response = await page.goto(pagePath);

      // Get the X-Robots-Tag header
      const robotsTag = response?.headers()['x-robots-tag'];

      // Should have the header
      expect(robotsTag).toBeDefined();

      // Should contain both noindex and nofollow
      expect(robotsTag?.toLowerCase()).toContain('noindex');
      expect(robotsTag?.toLowerCase()).toContain('nofollow');
    });
  }

  // Test admin pages (which also get noindex via middleware)
  for (const pagePath of adminPages) {
    test(`${pagePath} should have X-Robots-Tag: noindex, nofollow header`, async ({ page }) => {
      // Admin pages will redirect to auth if not logged in, but we can still check the header
      // before the redirect by using request interception

      const response = await page.goto(pagePath, { waitUntil: 'commit' });

      // The initial response (before redirect) should have X-Robots-Tag
      const robotsTag = response?.headers()['x-robots-tag'];

      // Should have the header (even though it redirects)
      expect(robotsTag).toBeDefined();
      expect(robotsTag?.toLowerCase()).toContain('noindex');
    });
  }

  // Test that public pages do NOT have noindex header
  test('public pages should NOT have X-Robots-Tag: noindex header', async ({ page }) => {
    const publicPages = ['/', '/guides', '/suppliers', '/pricing'];

    for (const pagePath of publicPages) {
      const response = await page.goto(pagePath);
      const robotsTag = response?.headers()['x-robots-tag'];

      // Public pages should not have the noindex header
      if (robotsTag) {
        expect(robotsTag.toLowerCase()).not.toContain('noindex');
      }
    }
  });

  test('verify noindex prevents crawling in robots meta fallback', async ({ page }) => {
    // This test ensures that if we later add meta robots tags,
    // they're consistent with X-Robots-Tag headers

    await page.goto('/dashboard.html');

    // Check if there's a robots meta tag (there shouldn't be, but if there is, it should be noindex)
    const robotsMeta = await page.locator('meta[name="robots"]').count();

    if (robotsMeta > 0) {
      const content = await page.locator('meta[name="robots"]').getAttribute('content');
      expect(content?.toLowerCase()).toContain('noindex');
    }
  });
});
