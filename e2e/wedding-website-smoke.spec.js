import { test, expect } from '@playwright/test';

test.describe('Wedding website smoke coverage', () => {
  test('public /wedding/:slug renders key sections', async ({ page }) => {
    await page.route('**/api/public/wedding-websites/**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          website: {
            coupleNames: 'Alex & Sam',
            welcomeMessage: 'Welcome to our day',
            venueName: 'Hilltop House',
            eventDate: '2026-09-10',
            rsvpEnabled: true,
            status: 'published',
            mealOptions: ['Vegan'],
          },
        }),
      });
    });

    await page.goto('/wedding/demo-couple');
    await expect(page.locator('h1')).toContainText('Alex & Sam');
    await expect(page.locator('#rsvp')).toBeVisible();
    await expect(page.locator('#rsvp-form')).toBeVisible();
  });

  test('customer dashboard quick-start renders module shell', async ({ page }) => {
    await page.addInitScript(() => {
      window.fetch = async url => {
        const path = String(url);
        if (path.includes('/api/me/plans/wedding-workspace')) {
          return new Response(
            JSON.stringify({ plan: { id: 'p1', eventType: 'wedding', name: 'Test wedding' } }),
            { status: 200 }
          );
        }
        if (path.includes('/api/me/plans/p1/wedding-website')) {
          return new Response(JSON.stringify({ website: null }), { status: 200 });
        }
        return new Response(JSON.stringify({ plans: [] }), { status: 200 });
      };
    });

    await page.goto('/dashboard-customer.html');
    await page.evaluate(() => {
      window.initWeddingWebsiteDashboard([]);
    });
    await page.click('#ww-quick-start');
    await expect(page.locator('#ww-create')).toBeVisible();
  });
});
