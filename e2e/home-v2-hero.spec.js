/**
 * Homepage V2 hero behaviour. V2 carries its own hero design but is still
 * wired by the shared ef-search-bar.js and hero-collage.js, so these cover the
 * behaviour end to end against the static server.
 */
import { test, expect } from '@playwright/test';

const PREVIEW_PATH = '/home-v2-preview';

test.describe('homepage V2 hero', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PREVIEW_PATH, { waitUntil: 'domcontentloaded' });
  });

  test('renders the redesigned hero with the Community CTA', async ({ page }) => {
    const hero = page.locator('section.hero.hero-modern');
    await expect(hero).toBeVisible();

    await expect(hero.locator('.hero-line-1')).toHaveText('Everything you need');
    await expect(hero.locator('.hero-line-2')).toHaveText('to organise an event');
    await expect(hero.locator('.hero-highlight-text')).toContainText('In one place');
    await expect(hero.locator('.hero-modern-subcopy')).toHaveText(
      'Find venues, catering, entertainment and more.'
    );
    await expect(hero.locator('.ef-search-bar__input')).toHaveAttribute(
      'placeholder',
      'Search suppliers, packages, venues…'
    );

    const ctas = hero.locator('.hero-modern-ctas a');
    await expect(ctas).toHaveCount(3);
    await expect(ctas.nth(0)).toHaveAttribute('href', '/start');
    await expect(ctas.nth(1)).toHaveAttribute('href', '/suppliers');
    await expect(ctas.nth(2)).toHaveAttribute('href', '/community');
    await expect(ctas.nth(2)).toHaveText('Community');
  });

  test('the search bar submits a keyword to the suppliers page', async ({ page }) => {
    await page.fill('.ef-search-bar__input', 'photographer');
    await page.click('.ef-search-bar__button');

    await page.waitForURL(/\/suppliers/);
    const url = new URL(page.url());
    expect(url.pathname).toMatch(/^\/suppliers/);
    expect(url.searchParams.get('q')).toBe('photographer');
  });

  test('the search bar submits a category on its own', async ({ page }) => {
    await page.selectOption('.ef-search-bar__select', 'Catering');
    await page.click('.ef-search-bar__button');

    await page.waitForURL(/\/suppliers/);
    expect(new URL(page.url()).searchParams.get('category')).toBe('Catering');
  });

  test('an empty search does not navigate away', async ({ page }) => {
    await page.click('.ef-search-bar__button');

    await expect(page).toHaveURL(new RegExp(`${PREVIEW_PATH}(?:\\.html)?(?:\\?|$)`));
    await expect(page.locator('.ef-search-bar__input')).toBeFocused();
  });

  test('a quick tag fills the search and submits it', async ({ page }) => {
    const tag = page.locator('.ef-quick-tags__tag').first();
    await expect(tag).toHaveAttribute('data-search', 'london venues');
    await tag.click();

    await page.waitForURL(/\/suppliers/);
    expect(new URL(page.url()).searchParams.get('q')).toBe('london venues');
  });

  test('Community is in the header navigation', async ({ page }) => {
    const link = page.locator('.hv2-nav a[href="/community"]');
    await expect(link).toBeVisible();
    await expect(link).toHaveText('Community');
  });

  test('the collage links to the four category pages', async ({ page }) => {
    const cards = page.locator('.hero-collage .hero-collage-card');
    await expect(cards).toHaveCount(4);

    for (const slug of ['venues', 'catering', 'entertainment', 'photography']) {
      await expect(
        page.locator(`.hero-collage .hero-collage-card[href="/category?slug=${slug}"]`)
      ).toHaveCount(1);
    }
  });

  test('the collage cards take their own organic shapes on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    const shapes = await page.evaluate(() =>
      ['venues', 'catering', 'entertainment', 'photography'].map(category => {
        const card = document.querySelector(`.hero-collage-card[data-category="${category}"]`);
        const style = getComputedStyle(card);
        return { position: style.position, radius: style.borderTopLeftRadius };
      })
    );

    for (const shape of shapes) {
      expect(shape.position).toBe('absolute');
      // Percentage radii resolve to a two-value `x y` pair, which is what makes
      // the corners organic rather than circular.
      expect(shape.radius.trim().split(/\s+/)).toHaveLength(2);
    }

    // Four distinct shapes, not one repeated.
    expect(new Set(shapes.map(shape => shape.radius)).size).toBe(4);
  });

  test('the quick tags carry decorative icons that stay out of the accessible name', async ({
    page,
  }) => {
    // The tag row is hidden below 640px, where an accessible name is not
    // computed, so pin a desktop viewport.
    await page.setViewportSize({ width: 1440, height: 900 });

    const tags = page.locator('.ef-quick-tags__tag');
    await expect(tags.locator('svg.hv2-quick-tag-icon')).toHaveCount(4);
    await expect(tags.first()).toHaveAccessibleName('London venues');
  });

  test('the decorative collage stays out of the keyboard tab order', async ({ page }) => {
    const collage = page.locator('.hero-collage');
    await expect(collage).toHaveAttribute('aria-hidden', 'true');

    const focusable = await page.evaluate(() => {
      const node = document.querySelector('.hero-collage');
      return node ? node.matches('[inert]') : null;
    });
    expect(focusable).toBe(true);
  });

  test('the shared collage module is available to the page', async ({ page }) => {
    const facade = await page.evaluate(() => {
      const api = window.EFHeroCollage;
      return api
        ? Object.keys(api)
            .filter(key => typeof api[key] === 'function')
            .sort()
        : null;
    });

    expect(facade).toEqual(
      expect.arrayContaining(['cleanup', 'initErrorHandlers', 'initParallax', 'load'])
    );
  });
});
