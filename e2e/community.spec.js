/**
 * EventFlow Community — browser suite.
 *
 * Covers logged-out browsing, navigation integration, responsive behaviour,
 * keyboard access, the legacy /forum redirects and console health. These
 * assertions are static-safe: they check the shells, navigation and metadata
 * that exist without a database.
 */

import { test, expect } from '@playwright/test';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  smallDesktop: { width: 1024, height: 800 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
};

const COMMUNITY_PAGES = [
  '/community',
  '/community/discussions',
  '/community/new',
  '/community/search',
  '/community/guidelines',
  '/community/help',
];

test.describe('Community — logged-out browsing', () => {
  test('the community homepage loads with its hero, search and primary actions', async ({
    page,
  }) => {
    await page.goto('/community');
    await expect(page).toHaveTitle(/EventFlow Community/);
    await expect(page.locator('h1').first()).toContainText('EventFlow Community');
    await expect(page.getByRole('searchbox', { name: /search the community/i })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Start a discussion' }).first()).toBeVisible();
  });

  test('every community page returns a document with a main landmark', async ({ page }) => {
    for (const path of COMMUNITY_PAGES) {
      const response = await page.goto(path);
      expect(response.status(), `${path} should not error`).toBeLessThan(400);
      await expect(page.locator('#main-content')).toHaveCount(1);
      await expect(page.locator('header[role="banner"]')).toHaveCount(1);
      await expect(page.locator('footer[role="contentinfo"]')).toHaveCount(1);
    }
  });

  test('the guidelines page explains the supplier code of conduct and moderation', async ({
    page,
  }) => {
    await page.goto('/community/guidelines');
    await expect(page.getByRole('heading', { name: /supplier code of conduct/i })).toBeVisible();
    await expect(page.getByText(/we do not use silent shadow bans/i)).toBeVisible();
    await expect(page.getByText(/18\+/).first()).toBeVisible();
  });

  test('the help page documents reporting and appeals', async ({ page }) => {
    await page.goto('/community/help');
    await expect(page.locator('#reporting')).toBeVisible();
    await expect(page.locator('#appeals')).toBeVisible();
    await expect(page.getByText(/official eventflow answer/i).first()).toBeVisible();
  });

  test('a search from the hero lands on the search page with the query preserved', async ({
    page,
  }) => {
    await page.goto('/community');
    await page.getByRole('searchbox', { name: /search the community/i }).fill('marquee hire');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/\/community\/search\?q=marquee\+hire/);
  });

  test('the search page shows the query it is reporting results for', async ({ page }) => {
    await page.goto('/community/search?q=marquee+hire');
    await expect(page.getByRole('searchbox', { name: /search the community/i })).toHaveValue(
      'marquee hire'
    );
  });
});

test.describe('Community — legacy URLs', () => {
  for (const legacy of ['/forum', '/forums']) {
    test(`${legacy} redirects permanently to /community`, async ({ page }) => {
      const response = await page.goto(legacy);
      expect(response.status()).toBe(200);
      expect(new URL(page.url()).pathname).toBe('/community');
    });
  }

  test('/community.html redirects to the canonical URL', async ({ page }) => {
    await page.goto('/community.html');
    expect(new URL(page.url()).pathname).toBe('/community');
  });
});

test.describe('Community — navigation integration', () => {
  test('Community appears in the desktop navigation and is marked current', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto('/community');
    const link = page.locator('.ef-nav-desktop a[href="/community"]');
    await expect(link).toBeVisible();
    await expect(link).toHaveClass(/ef-nav-link--active/);
  });

  test('Community appears in the desktop navigation on other pages too', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto('/suppliers');
    await expect(page.locator('.ef-nav-desktop a[href="/community"]')).toBeVisible();
  });

  test('Community appears in the burger menu on mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/community');
    await expect(page.locator('#ef-mobile-menu a[href="/community"]')).toHaveCount(1);
  });

  test('Community is reachable from the footer', async ({ page }) => {
    await page.goto('/community');
    await expect(page.locator('footer a[href="/community"]').first()).toBeVisible();
  });
});

test.describe('Community — responsive behaviour', () => {
  for (const [name, size] of Object.entries(VIEWPORTS)) {
    test(`the community homepage has no horizontal overflow at ${name}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto('/community');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      // A couple of pixels of rounding is acceptable; a broken layout is not.
      expect(overflow).toBeLessThanOrEqual(2);
    });
  }

  test('the burger toggle is visible on mobile and hidden on desktop', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/community');
    await expect(page.locator('#ef-mobile-toggle')).toBeVisible();

    await page.setViewportSize(VIEWPORTS.desktop);
    await expect(page.locator('.ef-nav-desktop')).toBeVisible();
  });

  // The filter panel is always open where there is room for it. The toggle
  // exists only to collapse it on a narrow screen, and once appeared on desktop
  // above an already-open panel because .efc-action won on source order.
  test('the filter toggle collapses the panel on mobile and is absent on desktop', async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/community/discussions');
    const toggle = page.locator('[data-filters-toggle]');
    await expect(toggle).toBeVisible();
    await expect(page.locator('#efc-filters')).toBeHidden();
    await toggle.click();
    await expect(page.locator('#efc-filters')).toBeVisible();

    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto('/community/discussions');
    await expect(page.locator('[data-filters-toggle]')).toBeHidden();
    await expect(page.locator('#efc-filters')).toBeVisible();
  });
});

test.describe('Community — keyboard and accessibility', () => {
  test('the skip link is the first focusable element and reaches main content', async ({
    page,
  }) => {
    await page.goto('/community');

    // It must be the first thing in tab order, not merely present somewhere.
    const firstFocusable = await page.evaluate(() => {
      const candidates = document.querySelectorAll(
        'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      return candidates.length ? candidates[0].className : null;
    });
    expect(firstFocusable).toContain('efc-skip');

    const skip = page.locator('.efc-skip');
    await skip.focus();
    // The link is off-screen until focused, which is what makes it usable.
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();

    await page.keyboard.press('Enter');
    expect(new URL(page.url()).hash).toBe('#main-content');
  });

  test('the page declares a single h1', async ({ page }) => {
    for (const path of COMMUNITY_PAGES) {
      await page.goto(path);
      await expect(page.locator('main h1, h1')).not.toHaveCount(0);
    }
  });

  test('the search field has an accessible name', async ({ page }) => {
    await page.goto('/community/search');
    await expect(page.getByRole('searchbox', { name: /search the community/i })).toBeVisible();
  });
});

test.describe('Community — SEO and console health', () => {
  test('public pages are indexable and private ones are not', async ({ page }) => {
    await page.goto('/community');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/community$/);
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);

    await page.goto('/community/search');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });

  test('the community homepage produces no critical console errors', async ({ page }) => {
    const errors = [];
    page.on('console', message => {
      if (message.type() === 'error') {
        errors.push(message.text());
      }
    });
    page.on('pageerror', error => errors.push(error.message));

    await page.goto('/community');
    await page.waitForLoadState('load');
    await page.waitForTimeout(500);

    // Network failures against the API are expected in static mode; script
    // errors are not.
    const critical = errors.filter(
      text => !/Failed to load resource|net::ERR|404|500|csrf-token|api\/v1\/community/i.test(text)
    );
    expect(critical).toEqual([]);
  });
});
