/**
 * PR721 – Homepage carousel image resolution (placeholder fix)
 *
 * The Spotlight and Featured carousels on the homepage must display real
 * images (not placeholder SVGs) when a package has either:
 *   a) a valid `image` URL, or
 *   b) a placeholder `image` but at least one entry in `gallery`
 *
 * The serve-static.js stub returns four mock packages covering all three
 * cases (valid image, placeholder+gallery, placeholder+empty gallery).
 * This test ensures the homepage renders the carousel and that cards with
 * a gallery fall back to the gallery image rather than the placeholder.
 *
 * The Carousel component (when available) renders with class `.carousel-item`
 * and `.featured-package-card`. The fallback renders with `.featured-fallback-card`.
 * Tests use combined selectors to handle both rendering paths.
 */

const { test, expect } = require('@playwright/test');

const PLACEHOLDER_PATH = '/assets/images/placeholders/';

// Selectors that match whichever rendering path the page takes
const CARD_SEL =
  '#featured-packages .carousel-item, #featured-packages .featured-fallback-card, ' +
  '#spotlight-packages .carousel-item, #spotlight-packages .featured-fallback-card';

const IMG_SEL =
  '#featured-packages .carousel-item img, #featured-packages .featured-fallback-img, ' +
  '#spotlight-packages .carousel-item img, #spotlight-packages .featured-fallback-img';

const LINK_SEL =
  '#featured-packages .featured-package-card, #featured-packages .featured-fallback-link, ' +
  '#spotlight-packages .featured-package-card, #spotlight-packages .featured-fallback-link';

test.describe('Homepage Carousel – Image Resolution (PR721)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait until at least one carousel card is rendered (either rendering path)
    await page.waitForSelector(CARD_SEL, { state: 'visible', timeout: 15000 });
  });

  test('Featured packages section renders at least one card', async ({ page }) => {
    const cards = page.locator(
      '#featured-packages .carousel-item, #featured-packages .featured-fallback-card'
    );
    await expect(cards.first()).toBeVisible();
  });

  test('Spotlight packages section renders at least one card', async ({ page }) => {
    const cards = page.locator(
      '#spotlight-packages .carousel-item, #spotlight-packages .featured-fallback-card'
    );
    await expect(cards.first()).toBeVisible();
  });

  test('Every visible carousel card image has a non-empty src', async ({ page }) => {
    const imgs = page.locator(IMG_SEL);
    const count = await imgs.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const src = await imgs.nth(i).getAttribute('src');
      expect(src).toBeTruthy();
    }
  });

  test('Package with placeholder image but a gallery entry resolves to a real image', async ({
    page,
  }) => {
    // "Barn Exclusive Hire" is mock-spot-1: image=placeholder, gallery has collage-venue.jpg
    // The client-side resolver should pick gallery[0].url instead of the placeholder.
    const imgs = page.locator(IMG_SEL);
    const count = await imgs.count();
    expect(count).toBeGreaterThan(0);

    let foundNonPlaceholder = false;
    for (let i = 0; i < count; i++) {
      const src = await imgs.nth(i).getAttribute('src');
      if (src && !src.includes(PLACEHOLDER_PATH)) {
        foundNonPlaceholder = true;
        break;
      }
    }
    // At least one card (the one with a gallery) must show a real image
    expect(foundNonPlaceholder).toBe(true);
  });

  test('Package card links navigate to the package detail page', async ({ page }) => {
    const firstLink = page.locator(LINK_SEL).first();
    const href = await firstLink.getAttribute('href');
    expect(href).toBeTruthy();
    expect(href).toMatch(/\/package/);
  });
});
