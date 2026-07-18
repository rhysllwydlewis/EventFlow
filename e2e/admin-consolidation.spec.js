/**
 * Current admin route protection and consolidation contracts (@backend).
 */
import { test, expect } from '@playwright/test';

async function expectProtectedAdminRoute(page, route) {
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/auth(?:\.html)?(?:\?|$)/, { timeout: 10000 });

  const url = new URL(page.url());
  const redirect = url.searchParams.get('redirect');
  if (redirect) expect(redirect).toMatch(/^\/admin/);
}

test.describe('Admin consolidation and route protection (@backend)', () => {
  test('legacy admin-content-dates route remains protected', async ({ page }) => {
    await expectProtectedAdminRoute(page, '/admin-content-dates');
  });

  test('legacy admin-pexels route remains protected', async ({ page }) => {
    await expectProtectedAdminRoute(page, '/admin-pexels');
  });

  test('admin-media page remains protected', async ({ page }) => {
    await expectProtectedAdminRoute(page, '/admin-media');
  });

  test('admin-search page remains protected', async ({ page }) => {
    await expectProtectedAdminRoute(page, '/admin-search');
  });

  test('admin search endpoint rejects short or unauthenticated queries', async ({ request }) => {
    const response = await request.get('/api/admin/search?q=a');
    expect([400, 401, 403]).toContain(response.status());
  });

  test('admin-content page remains protected', async ({ page }) => {
    await expectProtectedAdminRoute(page, '/admin-content');
  });
});
