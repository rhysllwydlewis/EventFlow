import { test, expect } from '@playwright/test';

const photo = '/assets/images/home-v3/categories-1.webp';
const packages = Array.from({ length: 5 }, (_, i) => ({
  id: `package-${i}`,
  slug: `live-package-${i}`,
  title: `Live package ${i}`,
  supplier_name: 'Event supplier',
  location: 'Cardiff',
  price_display: '£45 pp',
  image: photo,
}));

async function mockFeeds(page, { unavailable = false, signedIn = false } = {}) {
  await page.route('**/api/v1/auth/me', route =>
    route.fulfill({ json: { user: signedIn ? { id: 'sample-account', role: 'customer' } : null } })
  );
  await page.route('**/api/v1/categories', route =>
    route.fulfill({
      json: {
        items: [
          'Venues',
          'Catering',
          'Entertainment',
          'Photography',
          'Videography',
          'Decorations',
        ].map(name => ({ name, heroImage: photo, visible: true })),
      },
    })
  );
  await page.route('**/api/v1/locations/featured?*', route =>
    route.fulfill({
      json: {
        success: true,
        data: {
          cities: [{ slug: 'cardiff', name: 'Cardiff', supplierCount: 23, imageUrl: photo }],
        },
      },
    })
  );
  await page.route('**/api/packages/*', route =>
    route.fulfill(unavailable ? { status: 503, json: {} } : { json: { items: packages } })
  );
  await page.route('**/api/v1/marketplace/listings?*', route =>
    route.fulfill({
      json: {
        listings: unavailable
          ? []
          : [
              {
                id: 'live-listing',
                title: 'Wedding table décor',
                price: 230,
                location: 'Cardiff',
                condition: 'Used',
                images: [photo],
              },
            ],
      },
    })
  );
}

async function dismissConsent(page) {
  const reject = page.locator('#cookie-consent-reject');
  if (await reject.count()) {
    await reject.click();
  }
}

test.describe('V3 approved homepage concept', () => {
  test('uses current cards and published locations with safe text and links', async ({ page }) => {
    await mockFeeds(page);
    await page.route('**/api/packages/featured', route =>
      route.fulfill({
        json: {
          items: [
            { ...packages[0], title: '<img src=x onerror=alert(1)>', image: 'javascript:alert(1)' },
            ...packages.slice(1),
          ],
        },
      })
    );
    await page.goto('/home-v3-preview');
    await dismissConsent(page);
    await expect(page.locator('h1')).toHaveText('Everything you need.In one place.');
    await expect(page.locator('[data-v3-locations] small')).toHaveText('23 suppliers');
    await page.locator('#featured').scrollIntoViewIfNeeded();
    await expect(page.locator('#featured .package')).toHaveCount(5);
    await expect(page.locator('#featured h3').first()).toHaveText('<img src=x onerror=alert(1)>');
    await expect(page.locator('#featured .package').first()).toHaveAttribute(
      'href',
      '/package/live-package-0'
    );
    await expect(page.locator('#featured img').first()).toHaveAttribute(
      'src',
      /package-placeholder\.webp$/
    );
    await page.locator('#marketplace').scrollIntoViewIfNeeded();
    await expect(page.locator('.market-card')).toHaveAttribute(
      'href',
      '/marketplace?listing=live-listing'
    );
    await expect(page.locator('.market-card strong')).toHaveText('£230');
  });

  test('search keeps the location parameter and navigates on the current origin', async ({
    page,
  }) => {
    await mockFeeds(page);
    await page.goto('/home-v3-preview');
    await dismissConsent(page);
    await page.locator('#search-category').selectOption('Catering');
    await page.locator('#search-location').fill('Cardiff');
    await page.getByRole('button', { name: 'Find my suppliers' }).click();
    await page.waitForURL(/\/suppliers\?/);
    expect(new URL(page.url()).searchParams.get('location')).toBe('Cardiff');
    expect(new URL(page.url()).searchParams.get('category')).toBe('Catering');
  });

  test('feed errors and empty inventory offer useful browse links', async ({ page }) => {
    await mockFeeds(page, { unavailable: true });
    await page.goto('/home-v3-preview');
    await dismissConsent(page);
    await page.locator('#featured').scrollIntoViewIfNeeded();
    await expect(page.locator('#featured')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#featured a')).toHaveAttribute('href', '/suppliers');
    await expect(page.locator('#featured')).toContainText('could not load');
    await page.route('**/api/packages/featured', route =>
      route.fulfill({ json: { items: packages } })
    );
    await page.locator('#featured').getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.locator('#featured .package')).toHaveCount(5);
    await page.locator('#marketplace').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-v3-feed=marketplace]')).toContainText('New pre-loved finds');
    await expect(page.locator('[data-v3-feed=marketplace] a')).toHaveAttribute(
      'href',
      '/marketplace'
    );
  });

  test('wedding samples update, enforce capacity and reset without writes', async ({ page }) => {
    await mockFeeds(page);
    const writes = [];
    page.on('request', req => {
      if (req.method() !== 'GET') writes.push(req.url());
    });
    await page.goto('/home-v3-preview');
    await dismissConsent(page);
    await page.getByRole('button', { name: 'RSVP now', exact: true }).click();
    await page.getByRole('button', { name: 'Send RSVP', exact: true }).click();
    await page.getByRole('button', { name: 'Guest replies', exact: true }).click();
    await expect(page.locator('#sample-yes')).toHaveText('65');
    await page.getByRole('button', { name: 'Seating plan', exact: true }).click();
    await page.locator('#sample-table').selectOption('3');
    await expect(page.locator('.hws-drop')).toHaveAttribute('cx', '242');
    await page.getByRole('button', { name: 'Seat guest', exact: true }).click();
    await page.getByRole('button', { name: 'Priya S.', exact: true }).click();
    await page.getByRole('button', { name: 'Seat guest', exact: true }).click();
    await expect(page.locator('.hws-seat-status')).toContainText('Table 3 is full');
    await page.getByRole('button', { name: 'Reset wedding preview' }).click();
    await page.getByRole('button', { name: 'Guest replies', exact: true }).click();
    await expect(page.locator('#sample-yes')).toHaveText('64');
    expect(writes.filter(url => !url.includes('/api/csp-report'))).toEqual([]);
  });

  test('shared footer sends one subscription and account links reflect auth state', async ({
    page,
  }) => {
    await mockFeeds(page, { signedIn: true });
    let subscriptions = 0;
    await page.route('**/api/v1/csrf-token', route =>
      route.fulfill({ json: { csrfToken: 'test-csrf' } })
    );
    await page.route('**/api/newsletter/subscribe', route => {
      subscriptions++;
      expect(route.request().postDataJSON()).toEqual({
        email: 'test@example.com',
        source: 'footer',
      });
      return route.fulfill({
        json: { message: 'Please check your email to confirm your subscription.' },
      });
    });
    await page.goto('/home-v3-preview');
    await dismissConsent(page);
    await expect(page.locator('[data-v3-account]').first()).toHaveAttribute('href', '/dashboard');
    await expect(page.locator('.ef-footer-premium')).toHaveCount(1);
    await page.getByRole('button', { name: 'Cookie preferences', exact: true }).click();
    await expect(page.locator('.cookie-prefs-overlay')).toBeVisible();
    expect(
      await page.locator('.cookie-prefs-overlay').evaluate(el => getComputedStyle(el).position)
    ).toBe('fixed');
    await page.keyboard.press('Escape');
    await page.locator('#ef-footer-email').fill('test@example.com');
    await page.getByRole('button', { name: 'Subscribe', exact: true }).click();
    await expect(page.locator('.ef-nl-feedback')).toContainText('check your email');
    expect(subscriptions).toBe(1);
  });

  test('responsive views, mobile menu and reduced motion remain usable', async ({ page }) => {
    await mockFeeds(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const width of [320, 390, 768, 1024, 1180, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/home-v3-preview');
      await dismissConsent(page);
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await expect(page.locator('.orbit-toggle')).toBeDisabled();
      if (width <= 800) {
        await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
        await page.keyboard.press('Escape');
        await expect(
          page.getByRole('button', { name: 'Open navigation', exact: true })
        ).toBeFocused();
      }
      await page.getByRole('button', { name: 'Guest replies', exact: true }).click();
      await expect(page.locator('#sample-replies')).toBeVisible();
      await page.getByRole('button', { name: 'Seating plan', exact: true }).click();
      await expect(page.locator('#sample-seating')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    }
    expect(errors).toEqual([]);
  });
  test('categories follow current CMS visibility and update hero photos', async ({ page }) => {
    await mockFeeds(page);
    await page.route('**/api/v1/categories', route =>
      route.fulfill({
        json: {
          items: [
            {
              name: 'Venues',
              heroImage: '/assets/images/home-v3/categories-0.webp',
              visible: true,
            },
            { name: 'Transport', visible: false },
            { name: 'Catering', heroImage: '/assets/images/collage-catering.jpg', visible: true },
            { name: 'Videography', heroImage: photo, visible: true },
          ],
        },
      })
    );
    await page.goto('/home-v3-preview');
    await dismissConsent(page);
    await expect(page.locator('[data-v3-categories] .category')).toHaveCount(3);
    await expect(page.locator('[data-v3-categories]')).toContainText('Videography');
    await expect(page.locator('[data-v3-categories]')).not.toContainText('Transport');
    await expect(page.locator('.photo-bubble--catering img')).toHaveAttribute(
      'src',
      /home-v3\/categories-1\.webp$/
    );
    await expect(page.locator('.photo-bubble--venue img')).toHaveAttribute(
      'src',
      /categories-0\.webp$/
    );
    await expect(page.locator('[data-v3-categories] a').last()).toHaveAttribute(
      'href',
      '/suppliers?category=Videography'
    );
  });

  test('missing optional browser APIs do not prevent feed loading or wedding samples', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      delete window.IntersectionObserver;
      delete window.ResizeObserver;
      AbortSignal.timeout = undefined;
    });
    await mockFeeds(page);
    await page.goto('/home-v3-preview');
    await dismissConsent(page);
    await expect(page.locator('#featured .package')).toHaveCount(5);
    await page.getByRole('button', { name: 'RSVP now', exact: true }).click();
    await page.getByRole('button', { name: 'Send RSVP', exact: true }).click();
    await page.getByRole('button', { name: 'Guest replies', exact: true }).click();
    await expect(page.locator('#sample-yes')).toHaveText('65');
  });

  test('without JavaScript, legal navigation works and sample controls cannot submit', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 390, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(baseURL + '/home-v3-preview');
    await expect(page.locator('.ef-footer-premium a[href="/privacy"]')).toBeVisible();
    await expect(page.locator('.ef-footer-premium a[href="/legal#cookies"]')).toBeVisible();
    await expect(page.locator('#mobile-navigation')).toBeVisible();
    await expect(page.locator('.hws-send-rsvp')).toBeDisabled();
    await expect(page.locator('#ef-footer-email')).toBeDisabled();
    await expect(page.locator('.orbit-toggle')).toBeDisabled();
    await expect(page.locator('.photo-bubble').first()).toHaveCSS('animation-name', 'none');
    await context.close();
  });
  test('the sample guest can be dragged onto a table without bypassing capacity', async ({
    page,
  }) => {
    await mockFeeds(page);
    await page.goto('/home-v3-preview');
    await dismissConsent(page);
    await page.getByRole('button', { name: 'Seating plan', exact: true }).click();
    await page
      .locator('#sample-drag')
      .dragTo(page.getByRole('button', { name: 'Choose table 3', exact: true }));
    await expect(page.locator('.hws-seat-status')).toContainText('Charlotte E. is now at Table 3');
    await expect(page.getByRole('button', { name: 'Charlotte E.', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Priya S.', exact: true }).click();
    await page
      .locator('#sample-drag')
      .dragTo(page.getByRole('button', { name: 'Choose table 3', exact: true }));
    await expect(page.locator('.hws-seat-status')).toContainText('Table 3 is full');
  });
});
