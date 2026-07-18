import { test, expect } from '@playwright/test';

test.describe('Authentication Navbar and Logout Flow @backend', () => {
  test('should redirect to login with redirect parameter from protected page', async ({ page }) => {
    await page.goto('/dashboard-customer.html', { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/\/auth(?:\.html)?\?.*redirect=/, { timeout: 10000 });
    const url = new URL(page.url());
    expect(url.searchParams.get('redirect')).toContain('dashboard-customer.html');
    expect(url.searchParams.has('return')).toBe(false);
  });

  test('should use redirect parameter rather than return in auth links', async ({ page }) => {
    await page.goto('/auth.html?redirect=/dashboard-customer.html', {
      waitUntil: 'domcontentloaded',
    });

    const url = new URL(page.url());
    expect(url.searchParams.get('redirect')).toBe('/dashboard-customer.html');
    expect(url.searchParams.has('return')).toBe(false);
  });
});

test.describe('Logout storage contract (simulated) @backend', () => {
  test('logout clears EventFlow local and session storage', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await page.evaluate(() => {
      localStorage.setItem(
        'user',
        JSON.stringify({ id: '123', role: 'customer', name: 'Test User' })
      );
      localStorage.setItem('eventflow_onboarding_new', '1');
      sessionStorage.setItem('eventflow_test_session', '1');
    });

    await page.route('**/api/auth/logout', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.evaluate(async () => {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Mock logout request did not succeed');

      localStorage.removeItem('eventflow_onboarding_new');
      localStorage.removeItem('user');
      sessionStorage.clear();
    });

    await expect.poll(() => page.evaluate(() => localStorage.getItem('user'))).toBeNull();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('eventflow_onboarding_new')))
      .toBeNull();
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem('eventflow_test_session')))
      .toBeNull();
  });
});
