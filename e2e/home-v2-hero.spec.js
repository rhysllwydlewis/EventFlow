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
        return {
          position: style.position,
          // The mask is on the image and on the white backing rather than on
          // the card, so the backing can sit outside the card's own edge.
          clipPath: getComputedStyle(card.querySelector('img')).clipPath,
          separator: getComputedStyle(card, '::before').clipPath,
          separatorColour: getComputedStyle(card, '::before').backgroundColor,
          // A clipped subject drops its `box-shadow`, so depth has to come
          // from a filter.
          filter: style.filter,
          maskExists: Boolean(
            document.querySelector(`#hv2-mask-${category} path`)?.getAttribute('d')
          ),
        };
      })
    );

    for (const shape of shapes) {
      expect(shape.position).toBe('absolute');
      // `border-radius` can only draw four elliptical quadrants; the design's
      // silhouettes need a real path.
      expect(shape.clipPath).toMatch(/^url\(/);
      expect(shape.maskExists).toBe(true);
      expect(shape.filter).toContain('drop-shadow');
      // The separator follows the same contour, so it reads as an outline of
      // the shape rather than a rectangle behind it.
      expect(shape.separator).toBe(shape.clipPath);
      expect(shape.separatorColour).toBe('rgb(255, 255, 255)');
    }

    // Four distinct masks, not one repeated.
    expect(new Set(shapes.map(shape => shape.clipPath)).size).toBe(4);
  });

  test('a card that loads a video is masked like one that loads a photo', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // The collage replaces a card's `<img>` with a `<video>` whenever the admin
    // widget serves a clip, carrying the image's class list over — which is
    // empty. A mask hung off `img` therefore left video cards as rectangles on
    // top of a masked white backing.
    const clips = await page.evaluate(() => {
      const card = document.querySelector('.hero-collage-card[data-category="venues"]');
      const video = document.createElement('video');
      video.muted = true;
      card.appendChild(video);
      const result = {
        video: getComputedStyle(video).clipPath,
        image: getComputedStyle(card.querySelector('img')).clipPath,
      };
      video.remove();
      return result;
    });

    expect(clips.video).toMatch(/^url\(/);
    expect(clips.video).toBe(clips.image);
  });

  test('the collage carries no creator credit', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // `.pexels-credit` is built by the collage module once media loads. V2 does
    // not carry V1's inline styles for it, so an uncaught one renders as raw
    // text over the photograph.
    const display = await page.evaluate(() => {
      const card = document.querySelector('.hero-collage-card[data-category="venues"]');
      const credit = document.createElement('div');
      credit.className = 'pexels-credit';
      credit.textContent = 'Photo by Someone';
      card.appendChild(credit);
      const value = getComputedStyle(credit).display;
      credit.remove();
      return value;
    });

    expect(display).toBe('none');
  });

  test('the hero and its CTA row fit the fold on a laptop', async ({ page }) => {
    // The CTAs carry a 0.3s transition on `all`, so a measurement taken right
    // after a resize catches them at their old size and reads a wrap that is
    // not there once it settles.
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });

    for (const width of [1672, 1620, 1541, 1440, 1280, 1024]) {
      await page.setViewportSize({ width, height: 900 });

      const hero = await page.evaluate(() => {
        const section = document.querySelector('.hero-modern');
        const row = document.querySelector('.hero-modern-ctas');
        const buttons = Array.from(row.children);
        return {
          height: section.getBoundingClientRect().height,
          rowHeight: row.getBoundingClientRect().height,
          buttonHeight: buttons[0].getBoundingClientRect().height,
        };
      });

      // The three CTAs stay on one row: a wrap costs the hero another 76px,
      // which is what pushed it past the fold between 1520 and 1602.
      expect(hero.rowHeight).toBeLessThan(hero.buttonHeight * 1.5);
      expect(hero.height).toBeLessThan(780);
    }
  });

  test('the collage keeps the measured geometry of the design', async ({ page }) => {
    await page.setViewportSize({ width: 1672, height: 941 });

    // The design measures 757 x 659 with the cards at fixed percentages of
    // that box, overlapping. Assert the ratios rather than pixels so this
    // holds at whatever width the column ends up.
    const layout = await page.evaluate(() => {
      const box = document.querySelector('.hero-collage').getBoundingClientRect();
      const of = category => {
        const rect = document
          .querySelector(`.hero-collage-card[data-category="${category}"]`)
          .getBoundingClientRect();
        return {
          left: ((rect.x - box.x) / box.width) * 100,
          top: ((rect.y - box.y) / box.height) * 100,
          width: (rect.width / box.width) * 100,
          height: (rect.height / box.height) * 100,
        };
      };
      return {
        ratio: box.width / box.height,
        venues: of('venues'),
        catering: of('catering'),
        entertainment: of('entertainment'),
        photography: of('photography'),
      };
    });

    expect(layout.ratio).toBeCloseTo(757 / 659, 2);

    const expected = {
      venues: { left: 0, top: 0, width: 85.2, height: 74.96 },
      catering: { left: 62.35, top: 3.64, width: 37.65, height: 39.3 },
      entertainment: { left: 3.3, top: 54.78, width: 40.16, height: 43.1 },
      photography: { left: 59.05, top: 53.72, width: 40.82, height: 46.28 },
    };

    for (const [category, box] of Object.entries(expected)) {
      for (const [edge, value] of Object.entries(box)) {
        expect(layout[category][edge]).toBeCloseTo(value, 0);
      }
    }

    // The overlaps are the composition: catering and photography sit over the
    // feature card, entertainment over its lower left. A grid would not.
    expect(expected.catering.left).toBeLessThan(expected.venues.width);
    expect(expected.entertainment.top).toBeLessThan(expected.venues.height);
    expect(expected.photography.left).toBeLessThan(expected.venues.width);
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

  test('the design layer wins the properties the shared stylesheets also set', async ({ page }) => {
    // Every one of these was a silent specificity loss: `hero-modern.css`
    // reaches the highlight through `.hero-modern h1 .hero-highlight-*`,
    // `home-v2.css` colours all links through `.home-v2-page a`, and
    // `ef-search-bar.css` animates the submit button's shadow — and an
    // animation beats any static declaration. Source-text assertions cannot
    // catch these, so read the computed values.
    await page.setViewportSize({ width: 1440, height: 900 });

    const computed = await page.evaluate(() => {
      const read = (selector, property) =>
        getComputedStyle(document.querySelector(selector))[property];
      return {
        primaryCta: read('.hero-cta-primary', 'color'),
        highlight: read('.hero-highlight-text', 'color'),
        underlineHeight: read('.hero-highlight-bg', 'height'),
        searchButtonAnimation: read('.ef-search-bar__button', 'animationName'),
        emptyCredit: read('.hero-collage-credit', 'display'),
      };
    });

    expect(computed.primaryCta).toBe('rgb(255, 255, 255)');
    expect(computed.highlight).toBe('rgb(11, 128, 115)');
    // The shared rule leaves a 10px bar; the design's bowed stroke is taller.
    expect(parseFloat(computed.underlineHeight)).toBeGreaterThan(10);
    expect(computed.searchButtonAnimation).toBe('none');
    // Credits only have text once the collage loads Pexels media.
    expect(computed.emptyCredit).toBe('none');
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
