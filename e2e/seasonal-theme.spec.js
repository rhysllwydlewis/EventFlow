import { test, expect } from '@playwright/test';

/**
 * Seasonal navbar theme, in a real browser.
 *
 * The server's answer is stubbed, so the page is dressed exactly as it would be
 * on the day. What matters here is what only a browser can show: the decoration
 * must sit clear of the logo and every control, never move the header, never
 * catch a click, and never appear before it is styled.
 */

const THEMES = [
  'halloween',
  'bonfire',
  'remembrance',
  'christmas',
  'new-year',
  'chinese-new-year',
  'valentines',
  'mothers-day',
  'easter',
  'fathers-day',
];

const PAGE = '/pricing';

async function stubTheme(page, theme) {
  await page.route('**/api/public/seasonal-theme', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ theme }),
    })
  );
}

/** Where the mark sits, measured against the logo and every visible header control. */
function measureMark(page) {
  return page.evaluate(() => {
    const header = document.querySelector('.ef-header');
    const headerBox = header.getBoundingClientRect();
    const wordmark = header.querySelector('.ef-brand-text').getBoundingClientRect();
    const mark = header.querySelector('.ef-season-mark').getBoundingClientRect();
    const controls = [
      ...header.querySelectorAll('.ef-nav-link, .ef-btn, .ef-icon-btn, #ef-mobile-toggle'),
    ]
      .filter(el => el.getClientRects().length && el.getBoundingClientRect().width)
      .map(el => el.getBoundingClientRect());
    return {
      size: mark.width,
      insideHeader: mark.top >= headerBox.top - 0.5 && mark.bottom <= headerBox.bottom + 0.5,
      clearOfWordmark: mark.left >= wordmark.right - 0.5,
      touching: controls.filter(
        box =>
          mark.right > box.left - 4 &&
          mark.left < box.right + 4 &&
          mark.bottom > box.top &&
          mark.top < box.bottom
      ).length,
      sidewaysScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

test.describe('Seasonal navbar theme', () => {
  test.use({ reducedMotion: 'reduce' });

  test('leaves the header exactly as it is when no theme is on', async ({ page }) => {
    await stubTheme(page, null);
    await page.goto(PAGE);
    await expect(page.locator('.ef-header .ef-brand-text')).toBeVisible();
    await page.waitForLoadState('load');

    await expect(page.locator('.ef-season-on')).toHaveCount(0);
    await expect(page.locator('.ef-season-deco, .ef-season-mark')).toHaveCount(0);
    await expect(page.locator('link[data-eventflow-seasonal]')).toHaveCount(0);
  });

  for (const theme of THEMES) {
    test(`${theme}: dresses the header and keeps clear of the logo and every control`, async ({
      page,
    }) => {
      await stubTheme(page, theme);
      await page.goto(PAGE);
      await expect(page.locator('.ef-header')).toHaveClass(/ef-season-on/);

      const measured = await measureMark(page);
      expect(measured.size).toBeGreaterThan(10);
      expect(measured.insideHeader).toBe(true);
      expect(measured.clearOfWordmark).toBe(true);
      expect(measured.touching).toBe(0);
      expect(measured.sidewaysScroll).toBeLessThanOrEqual(0);

      // Decorative only: hidden from assistive technology and ignored by the pointer.
      const deco = page.locator('.ef-season-deco');
      await expect(deco).toHaveAttribute('aria-hidden', 'true');
      await expect(deco).toHaveCSS('pointer-events', 'none');
      await expect(page.locator('.ef-season-mark')).toHaveCSS('pointer-events', 'none');
    });
  }

  test('does not change the height of the header', async ({ page }) => {
    await stubTheme(page, null);
    await page.goto(PAGE);
    await page.waitForLoadState('load');
    const plain = await page
      .locator('.ef-header')
      .evaluate(el => el.getBoundingClientRect().height);

    const themed = await page.context().newPage();
    await stubTheme(themed, 'halloween');
    await themed.goto(PAGE);
    await expect(themed.locator('.ef-header')).toHaveClass(/ef-season-on/);
    const height = await themed
      .locator('.ef-header')
      .evaluate(el => el.getBoundingClientRect().height);

    expect(height).toBe(plain);
  });

  test('a click goes straight through the decoration to the control underneath', async ({
    page,
  }) => {
    // Halloween's web is drawn behind the top-right corner of "Log in".
    await stubTheme(page, 'halloween');
    await page.goto(PAGE);
    await expect(page.locator('.ef-header')).toHaveClass(/ef-season-on/);

    const login = page.locator('#ef-auth-link');
    const box = await login.boundingBox();
    // The straight right edge, not the rounded corner (which is not part of the button).
    await login.click({ position: { x: box.width - 4, y: box.height / 2 } });

    await expect(page).toHaveURL(/\/auth/);
  });

  test('adds nothing, and moves nothing, until the stylesheet has arrived', async ({ page }) => {
    await stubTheme(page, 'halloween');
    await page.route('**/seasonal-theme.css*', async route => {
      await new Promise(resolve => setTimeout(resolve, 1500));
      await route.continue();
    });
    await page.goto(PAGE);
    await expect(page.locator('.ef-header .ef-brand-text')).toBeVisible();
    await page.waitForLoadState('load');

    const layout = () =>
      page.evaluate(() => ({
        brand: Math.round(document.querySelector('.ef-brand').getBoundingClientRect().width),
        firstLink: Math.round(document.querySelector('.ef-nav-link').getBoundingClientRect().left),
        decoration: document.querySelectorAll('.ef-season-deco, .ef-season-mark').length,
      }));

    const waiting = await layout();
    expect(waiting.decoration).toBe(0);

    await expect(page.locator('.ef-header')).toHaveClass(/ef-season-on/);
    const dressed = await layout();
    expect(dressed.brand).toBe(waiting.brand);
    expect(dressed.firstLink).toBe(waiting.firstLink);
  });

  test('stays plain if the stylesheet cannot be loaded', async ({ page }) => {
    await stubTheme(page, 'halloween');
    await page.route('**/seasonal-theme.css*', route => route.abort());
    await page.goto(PAGE);
    await page.waitForLoadState('load');
    await page.waitForTimeout(500);

    await expect(page.locator('.ef-season-on')).toHaveCount(0);
    await expect(page.locator('.ef-season-deco, .ef-season-mark')).toHaveCount(0);
  });

  test('stays plain if the server cannot say', async ({ page }) => {
    await page.route('**/api/public/seasonal-theme', route =>
      route.fulfill({ status: 503, body: '{}' })
    );
    await page.goto(PAGE);
    await page.waitForLoadState('load');
    await page.waitForTimeout(500);

    await expect(page.locator('.ef-season-on')).toHaveCount(0);
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 800 } });

    for (const theme of ['halloween', 'bonfire', 'christmas', 'chinese-new-year']) {
      test(`${theme}: fits beside the logo and the menu button`, async ({ page }) => {
        await stubTheme(page, theme);
        await page.goto(PAGE);
        await expect(page.locator('.ef-header')).toHaveClass(/ef-season-on/);

        const measured = await measureMark(page);
        expect(measured.size).toBeGreaterThan(10);
        expect(measured.insideHeader).toBe(true);
        expect(measured.clearOfWordmark).toBe(true);
        expect(measured.touching).toBe(0);
        expect(measured.sidewaysScroll).toBeLessThanOrEqual(0);
      });
    }
  });

  test.describe('motion', () => {
    test.describe('when the visitor prefers reduced motion', () => {
      test.use({ reducedMotion: 'reduce' });

      test('nothing is animated', async ({ page }) => {
        await stubTheme(page, 'bonfire');
        await page.goto(PAGE);
        await expect(page.locator('.ef-header')).toHaveClass(/ef-season-on/);

        await expect(
          page.locator('.ef-season-mark animate, .ef-season-mark animateTransform')
        ).toHaveCount(0);
      });
    });

    test.describe('otherwise', () => {
      test.use({ reducedMotion: 'no-preference' });

      test('the mark animates gently', async ({ page }) => {
        await stubTheme(page, 'bonfire');
        await page.goto(PAGE);
        await expect(page.locator('.ef-header')).toHaveClass(/ef-season-on/);

        expect(
          await page.locator('.ef-season-mark animate, .ef-season-mark animateTransform').count()
        ).toBeGreaterThan(0);
      });
    });
  });
});
