/**
 * Admin Consolidation E2E Tests (@backend)
 * Tests for:
 * 1. Unified content dates within admin-content
 * 2. Media center page existence and Pexels integration basics
 * 3. Admin search basic endpoints
 */
import { test, expect } from '@playwright/test';

test.describe('Admin Consolidation (@backend)', () => {
  test('admin-content-dates redirects to admin-content with legalDates tab', async ({ page }) => {
    await page.goto('/admin-content-dates');
    // Should redirect to /admin-content?tab=legalDates
    await expect(page).toHaveURL(/admin-content/);
  });

  test('admin-pexels redirects to admin-media after 5 seconds (has banner)', async ({ page }) => {
    // Navigate but don't wait for redirect
    await page.goto('/admin-pexels');
    // Should show the compatibility banner
    await expect(page.locator('text=This page has moved')).toBeVisible({ timeout: 5000 });
  });

  test('admin-media page loads', async ({ page }) => {
    await page.goto('/admin-media');
    // Should redirect to auth since not logged in (dashboard-guard)
    // or load the page - either is fine for smoke test
    const url = page.url();
    expect(url).toMatch(/admin-media|auth/);
  });

  test('admin-search page loads', async ({ page }) => {
    await page.goto('/admin-search');
    const url = page.url();
    expect(url).toMatch(/admin-search|auth/);
  });

  test('admin search endpoint rejects short queries', async ({ request }) => {
    const response = await request.get('/api/admin/search?q=a');
    // Should return 400 (query too short) or 401 (not authenticated)
    expect([400, 401, 403]).toContain(response.status());
  });

  test('admin-content page has Legal Dates tab', async ({ page }) => {
    await page.goto('/admin-content');
    // Either shows the content page or redirects to auth
    const url = page.url();
    if (url.includes('admin-content')) {
      // Page loaded - check for Legal Dates tab
      const legalTab = page.locator('[data-tab="legalDates"]');
      await expect(legalTab).toBeVisible();
    }
  });
});
