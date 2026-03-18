/**
 * Homepage Analytics Stats Section - Mobile Responsive Layout Tests
 *
 * Validates that the stats section (Verified Suppliers, Packages Available,
 * Marketplace Items, Customer Reviews) renders correctly across mobile,
 * tablet, and desktop viewports without overflow or illegible text.
 */

const { test, expect } = require('@playwright/test');

const VIEWPORTS = {
  mobile_sm: { width: 320, height: 568 },
  mobile: { width: 375, height: 667 },
  mobile_lg: { width: 414, height: 896 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
};

test.describe('Homepage Stats Section - Mobile Layout', () => {
  test('stats section exists and is visible on mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const statsSection = page.locator('#stats-section');
    await expect(statsSection).toBeAttached();
    await expect(statsSection).toBeVisible();
  });

  test('stats grid shows 2-column layout on mobile (375px)', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const grid = page.locator('.ef-stats-grid');
    await expect(grid).toBeVisible();

    const gridCols = await grid.evaluate(el => window.getComputedStyle(el).gridTemplateColumns);

    // A 2-column layout produces exactly 2 column widths, e.g. "173.5px 173.5px"
    const colCount = gridCols.trim().split(/\s+/).length;
    expect(colCount).toBe(2);
  });

  test('stats grid shows 2-column layout on small mobile (320px)', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile_sm);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const grid = page.locator('.ef-stats-grid');
    await expect(grid).toBeVisible();

    const gridCols = await grid.evaluate(el => window.getComputedStyle(el).gridTemplateColumns);

    const colCount = gridCols.trim().split(/\s+/).length;
    expect(colCount).toBe(2);
  });

  test('stat labels are readable on mobile (font-size >= 12px)', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const firstLabel = page.locator('.ef-stat__label').first();
    await expect(firstLabel).toBeVisible();

    const fontSize = await firstLabel.evaluate(el => {
      const px = parseFloat(window.getComputedStyle(el).fontSize);
      return px;
    });

    // Label must be at least 12px to remain readable on mobile
    expect(fontSize).toBeGreaterThanOrEqual(12);
  });

  test('stat numbers are visible and sized appropriately on mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const firstNumber = page.locator('.ef-stat__number').first();
    await expect(firstNumber).toBeVisible();

    const fontSize = await firstNumber.evaluate(el => {
      return parseFloat(window.getComputedStyle(el).fontSize);
    });

    // Number should be ≥ 20px on mobile for prominence
    expect(fontSize).toBeGreaterThanOrEqual(20);
    // And not excessively large (desktop size is 42px; mobile should be smaller)
    expect(fontSize).toBeLessThan(42);
  });

  test('stat items do not overflow their containers on mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const statsSection = page.locator('#stats-section');
    const sectionBox = await statsSection.boundingBox();

    const statItems = page.locator('.ef-stat');
    const count = await statItems.count();
    expect(count).toBeGreaterThan(0);

    // Sub-pixel rounding from the browser layout engine can cause getBoundingClientRect()
    // to report values that are off by up to 1–2px. Allow a small tolerance so the test
    // doesn't flake on fractional pixel values.
    const OVERFLOW_TOLERANCE_PX = 2;

    for (let i = 0; i < count; i++) {
      const itemBox = await statItems.nth(i).boundingBox();
      if (itemBox) {
        // Item right edge must not exceed section right edge
        expect(itemBox.x + itemBox.width).toBeLessThanOrEqual(
          sectionBox.x + sectionBox.width + OVERFLOW_TOLERANCE_PX
        );
      }
    }
  });

  test('all 4 stat items are visible on mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const statItems = page.locator('.ef-stat');
    const count = await statItems.count();
    expect(count).toBe(4);

    for (let i = 0; i < count; i++) {
      await expect(statItems.nth(i)).toBeVisible();
    }
  });
});

test.describe('Homepage Stats Section - Desktop Layout', () => {
  test('stats section is visible on desktop', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const statsSection = page.locator('#stats-section');
    await expect(statsSection).toBeVisible();
  });

  test('stats grid uses multi-column layout on desktop', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const grid = page.locator('.ef-stats-grid');
    await expect(grid).toBeVisible();

    const gridCols = await grid.evaluate(el => window.getComputedStyle(el).gridTemplateColumns);

    // Desktop should show at least 4 non-zero columns (one per stat).
    // auto-fit may append extra 0px virtual tracks, so filter those out.
    const nonZeroCols = gridCols
      .trim()
      .split(/\s+/)
      .filter(c => c !== '0px' && c !== '0');
    expect(nonZeroCols.length).toBeGreaterThanOrEqual(4);
  });

  test('stat numbers retain large font size on desktop', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const firstNumber = page.locator('.ef-stat__number').first();
    const fontSize = await firstNumber.evaluate(el =>
      parseFloat(window.getComputedStyle(el).fontSize)
    );

    // Desktop font should be much larger than mobile (42px default)
    expect(fontSize).toBeGreaterThanOrEqual(36);
  });

  test('stat labels have standard readable size on desktop', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const firstLabel = page.locator('.ef-stat__label').first();
    const fontSize = await firstLabel.evaluate(el =>
      parseFloat(window.getComputedStyle(el).fontSize)
    );

    // Desktop label: 14px (--ef-text-sm default)
    expect(fontSize).toBeGreaterThanOrEqual(13);
  });
});

test.describe('Homepage Stats Section - Tablet Layout', () => {
  test('stats section is visible on tablet', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.tablet);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const statsSection = page.locator('#stats-section');
    await expect(statsSection).toBeVisible();
  });

  test('stats grid uses 2-column layout on tablet (768px)', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.tablet);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const grid = page.locator('.ef-stats-grid');
    const gridCols = await grid.evaluate(el => window.getComputedStyle(el).gridTemplateColumns);

    // At exactly 768px the mobile override applies, so 2 columns
    const colCount = gridCols.trim().split(/\s+/).length;
    expect(colCount).toBe(2);
  });
});
