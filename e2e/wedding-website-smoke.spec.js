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

  test('public page honours the palette, gallery and decline flow', async ({ page }) => {
    const rsvps = [];
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    await page.route('**/api/public/wedding-websites/**', async route => {
      if (route.request().method() === 'POST') {
        rsvps.push(JSON.parse(route.request().postData()));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Thank you — your RSVP has been received.' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          website: {
            coupleNames: 'Alex & Sam',
            eventDate: '2027-09-10',
            ceremonyVenueName: 'Hilltop House',
            ceremonyTime: '2:00pm',
            rsvpEnabled: true,
            accentColor: '#8D3F6F',
            heroLayout: 'editorial',
            coverImageUrl: png,
            galleryImages: [{ imageUrl: png, caption: 'Spring' }],
            weddingParty: [{ name: 'Jo Bloggs', role: 'Best man' }],
          },
        }),
      });
    });

    await page.goto('/wedding/demo-couple');
    await expect(page.locator('.wed-hero--editorial')).toBeVisible();
    await expect(page.locator('.wed-nav a[href="#gallery"]')).toHaveCount(1);
    await page.locator('.wed-gallery__item button').first().click();
    await expect(page.locator('.wed-lightbox figcaption')).toHaveText('Spring');
    await page.keyboard.press('Escape');

    await page.fill('[name="guestName"]', 'Pat Guest');
    await page.check('input[name="attending"][value="false"]');
    await expect(page.locator('[name="partySize"]')).toBeHidden();
    await page.click('#rsvp-form button[type="submit"]');
    await expect(page.locator('.wed-done')).toContainText('Thank you');
    expect(rsvps).toHaveLength(1);
    expect(rsvps[0]).toMatchObject({ guestName: 'Pat Guest', attending: 'false' });
    expect(rsvps[0].partySize).toBeUndefined();
  });

  test('password-protected public page asks for the password first', async ({ page }) => {
    let unlocked = false;
    await page.route('**/api/public/wedding-websites/**', async route => {
      const request = route.request();
      if (request.method() === 'POST' && request.url().endsWith('/access')) {
        unlocked = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: '{"success":true}',
        });
        return;
      }
      await route.fulfill({
        status: unlocked ? 200 : 401,
        contentType: 'application/json',
        body: JSON.stringify(
          unlocked
            ? { website: { coupleNames: 'Alex & Sam', rsvpEnabled: true } }
            : { error: 'Password required', passwordRequired: true }
        ),
      });
    });

    await page.goto('/wedding/demo-couple');
    await expect(page.locator('#wed-password-form')).toBeVisible();
    await page.fill('[name="password"]', 'secret');
    await page.click('#wed-password-form button');
    await expect(page.locator('h1')).toContainText('Alex & Sam');
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
    await page.click('.ww-card-open-app-btn');
    await page.click('#ww-tab-website');
    await page.click('#ww-quick-start');
    await expect(page.locator('#ww-create')).toBeVisible();
  });
});
