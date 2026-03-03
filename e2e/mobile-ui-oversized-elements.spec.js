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

    // The right edge of the previous arrow must not exceed the left edge of the first item
    expect(prevBox.x + prevBox.width).toBeLessThanOrEqual(itemBox.x + 1); // 1px tolerance
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

test.describe('Hero Search Button – Mobile Sizing and Alignment', () => {
  test('search button should be ≤ 44px wide on mobile (375px)', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/');

    const searchBtn = page.locator('.ef-search-bar__button').first();
    const btnCount = await searchBtn.count();
    if (btnCount === 0) {
      return;
    }

    const btnBox = await searchBtn.boundingBox();

    // Visual size should be compact (≤ 44px)
    expect(btnBox.width).toBeLessThanOrEqual(44);
    expect(btnBox.height).toBeLessThanOrEqual(44);
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

    // Scroll down to make back-to-top visible
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(500);

    const backToTop = page.locator('.back-to-top');
    const btnCount = await backToTop.count();
    if (btnCount === 0) {
      return;
    }

    const isVisible = await backToTop.isVisible();
    if (!isVisible) {
      return;
    }

    const btnBox = await backToTop.boundingBox();
    // Visual size should be compact (≤ 40px) on mobile
    expect(btnBox.width).toBeLessThanOrEqual(40);
    expect(btnBox.height).toBeLessThanOrEqual(40);
  });
});
