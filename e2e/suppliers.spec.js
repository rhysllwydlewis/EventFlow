import { test, expect } from '@playwright/test';

test.describe('Current supplier discovery contracts @backend', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
  });

  test('supplier directory loads with its current search controls', async ({ page }) => {
    const response = await page.goto('/suppliers', { waitUntil: 'domcontentloaded' });

    expect(response?.status()).toBeLessThan(500);
    await expect(page).toHaveTitle(/supplier|EventFlow/i);
    await expect(page.locator('main, #main-content').first()).toBeVisible();

    const searchControls = page.locator(
      'input[type="search"], input[name="q"], select[name="category"], [data-supplier-search]'
    );
    expect(await searchControls.count()).toBeGreaterThan(0);
  });

  test('supplier query parameters remain on the directory URL', async ({ page }) => {
    await page.goto('/suppliers?category=Venues&q=barn', { waitUntil: 'domcontentloaded' });

    const url = new URL(page.url());
    expect(url.pathname).toBe('/suppliers');
    expect(url.searchParams.get('category')).toBe('Venues');
    expect(url.searchParams.get('q')).toBe('barn');
  });

  test('supplier search API returns a controlled JSON response', async ({ request }) => {
    const response = await request.get('/api/v2/search/suppliers?limit=1');

    expect(response.status()).toBeLessThan(500);
    expect(response.headers()['content-type']).toContain('application/json');
    const body = await response.json();
    expect(body).toBeTruthy();
  });

  test('logged-out users receive a contextual save notice on auth', async ({ page }) => {
    await page.goto('/auth?redirect=%2Fsuppliers&intent=save', {
      waitUntil: 'domcontentloaded',
    });

    await expect(page.locator('.auth-heading')).toBeVisible();
    const notice = page.locator('#auth-intent-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(/save suppliers/i);
  });

  test('logged-out users receive a contextual message notice on auth', async ({ page }) => {
    await page.goto('/auth?redirect=%2Fsuppliers&intent=message', {
      waitUntil: 'domcontentloaded',
    });

    const notice = page.locator('#auth-intent-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(/message/i);
  });

  test('logged-out supplier directory does not trust stale shortlist storage', async ({ page }) => {
    await page.goto('/suppliers', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem(
        'eventflow_shortlist',
        JSON.stringify({
          items: [{ type: 'supplier', id: 'stale-id', name: 'Stale supplier' }],
          lastUpdated: new Date().toISOString(),
        })
      );
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    const activeButtons = page.locator('.sp-btn--shortlist-active, .btn-shortlist-active');
    expect(await activeButtons.count()).toBe(0);
  });
});
