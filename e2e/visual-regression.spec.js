/**
 * Mobile visual layout contracts.
 *
 * These tests intentionally verify stable geometry, visibility and interaction
 * state instead of comparing the homepage to a brittle full-viewport bitmap.
 * A viewport capture is attached to every test so visual evidence remains
 * available in the Playwright report.
 */

import { test, expect } from '@playwright/test';

const MOBILE_VIEWPORT = { width: 395, height: 653 };

async function prepareMobilePage(page) {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#ef-mobile-toggle')).toBeVisible();

  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }
    `,
  });
}

async function visibleBox(locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box;
}

function expectHorizontallyInsideViewport(box) {
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
}

async function attachViewport(page, testInfo, name) {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: false, animations: 'disabled' }),
    contentType: 'image/png',
  });
}

async function captureClosedLayout(page) {
  const selectors = ['.ef-brand', '#ef-mobile-toggle', '.ef-search-bar__form'];
  const boxes = {};

  for (const selector of selectors) {
    boxes[selector] = await visibleBox(page.locator(selector));
  }

  return boxes;
}

test.describe('Visual Regression - Mobile Layout Contracts @visual', () => {
  test.beforeEach(async ({ page }) => {
    await prepareMobilePage(page);
  });

  test('index.html - closed navigation fits the mobile viewport', async ({ page }, testInfo) => {
    const menu = page.locator('#ef-mobile-menu');
    const toggle = page.locator('#ef-mobile-toggle');

    await expect(menu).not.toHaveClass(/\bopen\b/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    for (const selector of ['.ef-brand', '#ef-mobile-toggle']) {
      expectHorizontallyInsideViewport(await visibleBox(page.locator(selector)));
    }

    expectHorizontallyInsideViewport(await visibleBox(page.locator('.ef-search-bar__form')));
    await attachViewport(page, testInfo, 'mobile-menu-closed');
  });

  test('index.html - open navigation exposes an accessible, in-bounds menu', async ({
    page,
  }, testInfo) => {
    const toggle = page.locator('#ef-mobile-toggle');
    const menu = page.locator('#ef-mobile-menu');

    await toggle.click();

    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(menu).toHaveClass(/\bopen\b/);
    await expect(menu).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('body')).toHaveClass(/\bef-menu-open\b/);
    await expect(menu.locator('.ef-mobile-link').first()).toBeVisible();

    expectHorizontallyInsideViewport(await visibleBox(menu));

    const backgroundDisabled = await page.locator('main').evaluate(element => {
      if ('inert' in element) {
        return element.inert;
      }
      return element.getAttribute('aria-hidden') === 'true';
    });
    expect(backgroundDisabled).toBe(true);

    await attachViewport(page, testInfo, 'mobile-menu-open');
  });

  test('index.html - hero search controls remain usable and do not overlap', async ({
    page,
  }, testInfo) => {
    const menu = page.locator('#ef-mobile-menu');
    const form = page.locator('.ef-search-bar__form');
    const input = page.locator('.ef-search-bar__input');
    const button = page.locator('.ef-search-bar__button');

    await expect(menu).not.toHaveClass(/\bopen\b/);

    const formBox = await visibleBox(form);
    const inputBox = await visibleBox(input);
    const buttonBox = await visibleBox(button);

    expectHorizontallyInsideViewport(formBox);
    expect(buttonBox.width).toBeGreaterThanOrEqual(36);
    expect(buttonBox.height).toBeGreaterThanOrEqual(36);
    expect(inputBox.width).toBeGreaterThan(100);
    expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(formBox.x + formBox.width + 1);

    const horizontalOverlap = Math.max(
      0,
      Math.min(inputBox.x + inputBox.width, buttonBox.x + buttonBox.width) -
        Math.max(inputBox.x, buttonBox.x)
    );
    expect(horizontalOverlap).toBeLessThanOrEqual(1);

    await attachViewport(page, testInfo, 'hero-search-layout');
  });

  test('menu open-close cycle preserves the closed layout', async ({ page }, testInfo) => {
    const toggle = page.locator('#ef-mobile-toggle');
    const menu = page.locator('#ef-mobile-menu');
    const before = await captureClosedLayout(page);

    await toggle.click();
    await expect(menu).toHaveClass(/\bopen\b/);

    await toggle.click();
    await expect(menu).not.toHaveClass(/\bopen\b/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();

    const after = await captureClosedLayout(page);
    for (const selector of Object.keys(before)) {
      for (const property of ['x', 'y', 'width', 'height']) {
        expect(
          Math.abs(after[selector][property] - before[selector][property])
        ).toBeLessThanOrEqual(1);
      }
    }

    await attachViewport(page, testInfo, 'menu-toggle-stability');
  });
});
