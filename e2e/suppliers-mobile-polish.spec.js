import { test, expect } from '@playwright/test';

const MOCK_SUPPLIERS = {
  success: true,
  data: {
    results: [
      {
        id: 'supplier-mobile-polish-1',
        ownerUserId: 'owner-mobile-polish-1',
        name: 'Willow & Stone Photography',
        category: 'Photography',
        location: 'Cardiff, South Wales',
        description_short:
          'Natural wedding photography for couples who want relaxed, candid coverage across South Wales, the West and beyond without awkward posing or a rushed timeline.',
        approved: true,
        verified: true,
        subscriptionTier: 'pro',
        averageRating: 4.9,
        reviewCount: 28,
        topPackages: [
          {
            id: 'package-mobile-polish-1',
            title: 'Full-day wedding photography',
            price: '300',
            image: '/assets/images/placeholders/package-event.svg',
            gallery: [],
          },
          {
            id: 'package-mobile-polish-2',
            title: 'Ceremony and portraits',
            price: '495.00',
            image: '/assets/images/placeholders/package-event.svg',
            gallery: [],
          },
          {
            id: 'package-mobile-polish-3',
            title: 'Evening celebration coverage',
            price: 'From £650',
            image: '/assets/images/placeholders/package-event.svg',
            gallery: [],
          },
        ],
      },
      {
        id: 'supplier-mobile-polish-2',
        ownerUserId: 'owner-mobile-polish-2',
        name: 'Celyn Event Styling',
        category: 'Decor',
        location: 'Pontypridd, South Wales',
        description_short:
          'Modern event styling, table design and venue dressing for weddings, parties and corporate celebrations.',
        approved: true,
        verified: true,
        subscriptionTier: 'free',
        topPackages: [
          {
            id: 'package-mobile-polish-4',
            title: 'Venue styling collection',
            price: '850',
            image: '/assets/images/placeholders/package-event.svg',
            gallery: [],
          },
        ],
      },
    ],
    pagination: {
      total: 2,
      page: 1,
      pages: 1,
      totalPages: 1,
      limit: 20,
    },
    appliedSort: 'relevance',
  },
};

test.describe('Suppliers page mobile polish', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/v2/search/suppliers**', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_SUPPLIERS),
      })
    );

    await page.goto('/suppliers', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.sp-card')).toHaveCount(2, { timeout: 15000 });
    await expect(page.locator('#suppliers-mobile-polish-styles')).toHaveCount(1);
  });

  test('uses the polished hero, native select shell and correct stacking order', async ({
    page,
  }) => {
    const heroStyles = await page.locator('.suppliers-hero').evaluate(element => {
      const styles = window.getComputedStyle(element);
      return {
        backgroundImage: styles.backgroundImage,
        borderRadius: styles.borderRadius,
        boxShadow: styles.boxShadow,
        paddingLeft: styles.paddingLeft,
      };
    });

    expect(heroStyles.backgroundImage).toContain('linear-gradient');
    expect(heroStyles.borderRadius).toBe('12px');
    expect(parseFloat(heroStyles.paddingLeft)).toBeGreaterThanOrEqual(16);
    expect(heroStyles.boxShadow).not.toContain('rgba(0, 0, 0, 0.5)');

    const selectStyles = await page.locator('#filterCategory').evaluate(element => {
      const styles = window.getComputedStyle(element);
      return {
        appearance: styles.appearance,
        backgroundImage: styles.backgroundImage,
        borderRadius: styles.borderRadius,
        paddingRight: styles.paddingRight,
      };
    });

    expect(selectStyles.appearance).toBe('none');
    expect(selectStyles.backgroundImage).toContain('svg');
    expect(parseFloat(selectStyles.borderRadius)).toBeGreaterThanOrEqual(8);
    expect(parseFloat(selectStyles.paddingRight)).toBeGreaterThanOrEqual(30);

    const layers = await page.evaluate(() => ({
      filters: Number.parseInt(
        getComputedStyle(document.querySelector('.sp-filter-panel')).zIndex,
        10
      ),
      results: Number.parseInt(getComputedStyle(document.querySelector('#results')).zIndex, 10),
    }));
    expect(layers.filters).toBeGreaterThan(layers.results);
  });

  test('stacks supplier information full-width with a horizontal action row', async ({ page }) => {
    const card = page.locator('.sp-card').first();
    const cardBox = await card.boundingBox();
    const profileBox = await card.locator('.sp-card-profile').boundingBox();
    const actionsBox = await card.locator('.sp-card-actions').boundingBox();
    const actionBoxes = await card.locator('.sp-card-actions .sp-btn').evaluateAll(elements =>
      elements.map(element => {
        const rect = element.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      })
    );

    expect(cardBox).not.toBeNull();
    expect(profileBox).not.toBeNull();
    expect(actionsBox).not.toBeNull();
    expect(profileBox.width).toBeGreaterThan(cardBox.width * 0.94);
    expect(actionsBox.width).toBeGreaterThan(cardBox.width * 0.94);
    expect(actionBoxes).toHaveLength(3);
    expect(
      Math.max(...actionBoxes.map(box => box.y)) - Math.min(...actionBoxes.map(box => box.y))
    ).toBeLessThan(3);
    expect(actionBoxes.every(box => box.width > 80 && box.height >= 34)).toBe(true);
  });

  test('formats GBP prices and collapses missing package media', async ({ page }) => {
    const firstPrice = page.locator('.sp-pkg-mini-price').first();
    await expect(firstPrice).toHaveText('£300');
    await expect(page.locator('.sp-pkg-mini-price').nth(1)).toHaveText('£495');
    await expect(page.locator('.sp-pkg-mini-price').nth(2)).toHaveText('From £650');

    const fallbackThumb = page.locator('.sp-pkg-mini-thumb--fallback').first();
    await expect(fallbackThumb).toBeVisible();
    const fallbackHeight = await fallbackThumb.evaluate(
      element => element.getBoundingClientRect().height
    );
    expect(fallbackHeight).toBeLessThanOrEqual(66);

    const arrowAlignment = await page
      .locator('.sp-pkg-carousel')
      .first()
      .evaluate(carousel => {
        const thumb = carousel.querySelector('.sp-pkg-mini-thumb');
        const arrow = carousel.querySelector('.sp-pkg-arrow');
        const thumbRect = thumb.getBoundingClientRect();
        const arrowRect = arrow.getBoundingClientRect();
        return {
          thumbCentre: thumbRect.top + thumbRect.height / 2,
          arrowCentre: arrowRect.top + arrowRect.height / 2,
        };
      });
    expect(Math.abs(arrowAlignment.thumbCentre - arrowAlignment.arrowCentre)).toBeLessThan(5);
  });

  test('offers a touch-friendly description expansion control', async ({ page }) => {
    const description = page.locator('.sp-card-description').first();
    const toggle = page.locator('.sp-description-toggle').first();

    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText('Show more');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    await expect(toggle).toHaveText('Show less');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(description).toHaveClass(/is-expanded/);
  });

  test('keeps quick filters swipeable, Clear pinned and FAB clearance available', async ({
    page,
  }, testInfo) => {
    const footerMetrics = await page.locator('.sp-filter-footer').evaluate(footer => {
      const shortcuts = footer.querySelector('.sp-quick-shortcuts');
      const clear = footer.querySelector('.sp-clear-btn');
      const footerRect = footer.getBoundingClientRect();
      const clearRect = clear.getBoundingClientRect();
      return {
        shortcutsClientWidth: shortcuts.clientWidth,
        shortcutsScrollWidth: shortcuts.scrollWidth,
        clearRight: clearRect.right,
        footerRight: footerRect.right,
      };
    });

    expect(footerMetrics.shortcutsScrollWidth).toBeGreaterThan(footerMetrics.shortcutsClientWidth);
    expect(footerMetrics.clearRight).toBeLessThanOrEqual(footerMetrics.footerRight + 1);

    const layoutMetrics = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      resultsPaddingBottom: Number.parseFloat(
        getComputedStyle(document.querySelector('#results')).paddingBottom
      ),
    }));
    expect(layoutMetrics.documentWidth).toBeLessThanOrEqual(layoutMetrics.viewportWidth + 1);
    expect(layoutMetrics.resultsPaddingBottom).toBeGreaterThanOrEqual(96);

    await page.screenshot({
      path: testInfo.outputPath('suppliers-mobile-polish-390.png'),
      fullPage: true,
    });
  });
});
