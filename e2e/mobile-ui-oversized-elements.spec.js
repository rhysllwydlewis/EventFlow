/**
 * Mobile UI Oversized Elements E2E Tests
 * Validates that UI elements are appropriately sized on small mobile viewports.
 * Covers: carousel arrows, hero search button alignment and sizing.
 */

const { test, expect } = require('@playwright/test');

const VIEWPORTS = {
  mobile: { width: 375, height: 667 },
  small: { width: 320, height: 568 },
};

test.describe('Carousel Arrows – Mobile Sizing', () => {
  test('carousel arrows should be ≤ 40px wide on mobile (375px)', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/');

    const prevBtn = page.locator('.carousel-prev').first();
    const nextBtn = page.locator('.carousel-next').first();

    const prevCount = await prevBtn.count();
    if (prevCount === 0) {
      // No carousel rendered (e.g., no data); skip gracefully
      return;
    }

    const prevBox = await prevBtn.boundingBox();
    const nextBox = await nextBtn.boundingBox();

    // Visual size should be compact on mobile (≤ 40px)
    expect(prevBox.width).toBeLessThanOrEqual(40);
    expect(prevBox.height).toBeLessThanOrEqual(40);
    expect(nextBox.width).toBeLessThanOrEqual(40);
    expect(nextBox.height).toBeLessThanOrEqual(40);
  });

  test('carousel arrows should not overlap first carousel item on mobile (375px)', async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/');

    const prevBtn = page.locator('.carousel-prev').first();
    const firstItem = page.locator('.carousel-item').first();

    const prevCount = await prevBtn.count();
    const itemCount = await firstItem.count();
    if (prevCount === 0 || itemCount === 0) {
      return;
    }

    const prevBox = await prevBtn.boundingBox();
    const itemBox = await firstItem.boundingBox();

    // The arrow must not sit on top of the card. It used to live in a gutter to the
    // card's left; on phones the pair now sits under the track, so "overlap" is
    // checked as a real rectangle intersection rather than by assuming a side.
    const TOLERANCE = 1;
    const apart =
      prevBox.x + prevBox.width <= itemBox.x + TOLERANCE ||
      prevBox.x >= itemBox.x + itemBox.width - TOLERANCE ||
      prevBox.y + prevBox.height <= itemBox.y + TOLERANCE ||
      prevBox.y >= itemBox.y + itemBox.height - TOLERANCE;
    expect(apart).toBe(true);
  });

  test('carousel arrows should be ≤ 40px wide on small mobile (320px)', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.small);
    await page.goto('/');

    const prevBtn = page.locator('.carousel-prev').first();
    const prevCount = await prevBtn.count();
    if (prevCount === 0) {
      return;
    }

    const prevBox = await prevBtn.boundingBox();
    expect(prevBox.width).toBeLessThanOrEqual(40);
    expect(prevBox.height).toBeLessThanOrEqual(40);
  });
});

test.describe('Back-to-top, Search Button – Mobile Sizing and Alignment', () => {
  test('search button should be ≤ 44px wide on mobile (375px)', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/');

    const searchBtn = page.locator('.ef-search-bar__button').first();
    const btnCount = await searchBtn.count();
    if (btnCount === 0) {
      return;
    }

    const btnBox = await searchBtn.boundingBox();

    // Visual size should be compact (≤ 38px accounts for sub-pixel rounding at 36px target)
    expect(btnBox.width).toBeLessThanOrEqual(38);
    expect(btnBox.height).toBeLessThanOrEqual(38);
  });

  test('search button should be right-aligned within its form on mobile (375px)', async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/');

    const searchBtn = page.locator('.ef-search-bar__button').first();
    const searchForm = page.locator('.ef-search-bar__form').first();

    const btnCount = await searchBtn.count();
    const formCount = await searchForm.count();
    if (btnCount === 0 || formCount === 0) {
      return;
    }

    const btnBox = await searchBtn.boundingBox();
    const formBox = await searchForm.boundingBox();

    // Button right edge should be within 12px of form right edge
    const btnRight = btnBox.x + btnBox.width;
    const formRight = formBox.x + formBox.width;
    expect(formRight - btnRight).toBeLessThanOrEqual(12);
  });

  test('back-to-top button should be ≤ 40px wide on mobile (375px)', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/');

    // On phones the button waits until the visitor is well down the page and
    // then scrolls back up, so do both. (A single scroll to 500px used to be
    // enough; left as it was, this test would skip without measuring anything.)
    await page.evaluate(() => window.scrollTo(0, 3000));
    await page.waitForTimeout(400);
    await page.evaluate(() => window.scrollTo(0, 2600));
    await page.waitForTimeout(500);

    const backToTop = page.locator('.back-to-top');
    const btnCount = await backToTop.count();
    if (btnCount === 0) {
      return;
    }

    await expect(backToTop).toBeVisible();

    const btnBox = await backToTop.boundingBox();
    // Visual size should be compact (≤ 40px) on mobile
    expect(btnBox.width).toBeLessThanOrEqual(40);
    expect(btnBox.height).toBeLessThanOrEqual(40);

    // Reading on again puts it away.
    await page.evaluate(() => window.scrollTo(0, 3200));
    await expect(backToTop).toBeHidden();
  });

  test('bottom bar Menu tab matches its neighbours on mobile (375px)', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/');

    const menu = page.locator('#ef-bottom-menu');
    if ((await menu.count()) === 0) {
      return;
    }

    const style = await menu.evaluate(el => {
      const cs = getComputedStyle(el);
      return {
        label: getComputedStyle(el, '::before').content,
        shadow: cs.boxShadow,
        borderWidth: cs.borderTopWidth,
        background: cs.backgroundColor,
      };
    });
    // It is a tab, not a call-to-action button: labelled, and without the box.
    expect(style.label).toBe('"Menu"');
    expect(style.shadow).toBe('none');
    expect(style.borderWidth).toBe('0px');
    expect(style.background).toBe('rgba(0, 0, 0, 0)');

    // Same vertical footprint as the tab beside it.
    const menuBox = await menu.boundingBox();
    const neighbourBox = await page
      .locator('.ef-bottom-nav a.ef-bottom-link')
      .first()
      .boundingBox();
    expect(Math.abs(menuBox.height - neighbourBox.height)).toBeLessThanOrEqual(4);
  });
});
