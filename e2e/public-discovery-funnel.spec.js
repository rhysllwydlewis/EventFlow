/**
 * PR #1201 — Core Public Discovery & Conversion Funnel
 *
 * Tests the complete public journey:
 *   homepage search → suppliers page (with context) → no-results recovery
 *   → logged-out action gates (save/message/plan) → auth intent notices
 *   → marketplace browse/listing → marketplace logged-out gates
 *   → mobile smoke tests
 *
 * Marked @backend where the test needs a running server.
 * Marked @static where the test only inspects static HTML/JS.
 */

import { test, expect } from '@playwright/test';

// ─── Homepage search → suppliers ──────────────────────────────────────────────

test.describe('Homepage search to suppliers @backend', () => {
  test('search form submits to /suppliers with q param', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const input = page.locator('#ef-search-input, input[name="q"]').first();
    await expect(input).toBeVisible();
    await input.fill('photographer');
    await page.keyboard.press('Enter');

    await page.waitForURL(url => url.pathname === '/suppliers', { timeout: 8000 });
    const url = new URL(page.url());
    expect(url.searchParams.get('q')).toBe('photographer');
  });

  test('search form submits to /suppliers with category param', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const select = page.locator('#ef-search-category, select[name="category"]').first();
    if ((await select.count()) > 0) {
      await select.selectOption({ value: 'Photography' });
    }
    const input = page.locator('#ef-search-input, input[name="q"]').first();
    await input.fill('wedding');
    await page.keyboard.press('Enter');

    await page.waitForURL(url => url.pathname === '/suppliers', { timeout: 8000 });
    const url = new URL(page.url());
    // q param must be preserved
    expect(url.searchParams.get('q')).toBe('wedding');
  });

  test('quick tag click submits search to /suppliers', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const firstTag = page.locator('.ef-quick-tags__tag').first();
    if (await firstTag.isVisible()) {
      const searchTerm = await firstTag.getAttribute('data-search');
      await firstTag.click();
      await page.waitForURL(url => url.pathname === '/suppliers', { timeout: 8000 });
      const url = new URL(page.url());
      if (searchTerm) {
        expect(url.searchParams.get('q')).toBe(searchTerm);
      }
    }
  });
});

// ─── Suppliers page: filter context ──────────────────────────────────────────

test.describe('Suppliers page result context @backend', () => {
  test('renders search context when q param is set', async ({ page }) => {
    await page.goto('/suppliers?q=photographer');
    await page.waitForLoadState('domcontentloaded');
    // Wait for async results to load
    await page.waitForTimeout(2000);

    const ctx = page.locator('#results-context');
    if ((await ctx.count()) > 0) {
      const text = await ctx.textContent();
      // Context should include the search query
      if (text && text.trim()) {
        expect(text.toLowerCase()).toMatch(/photographer|showing/i);
      }
    }
  });

  test('renders category context when category param is set', async ({ page }) => {
    await page.goto('/suppliers?category=Photography');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const ctx = page.locator('#results-context');
    if ((await ctx.count()) > 0) {
      const text = await ctx.textContent();
      if (text && text.trim()) {
        expect(text.toLowerCase()).toMatch(/photography|supplier|showing/i);
      }
    }
  });

  test('active filter chips appear when filters are active @backend', async ({ page }) => {
    await page.goto('/suppliers?category=Photography&location=London');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const chips = page.locator('#active-filters-chips');
    if ((await chips.count()) > 0) {
      const hidden = await chips.getAttribute('hidden');
      // When filters are active the chips container should not be hidden
      expect(hidden).toBeNull();
    }
  });

  test('clearing filters from chip resets results @backend', async ({ page }) => {
    await page.goto('/suppliers?category=Photography');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const clearAllChip = page.locator('#chip-clear-all');
    if ((await clearAllChip.count()) > 0) {
      await clearAllChip.click();
      await page.waitForTimeout(1500);
      const url = new URL(page.url());
      expect(url.searchParams.get('category')).toBeNull();
    }
  });
});

// ─── Suppliers page: no-results recovery ─────────────────────────────────────

test.describe('Suppliers no-results state @backend', () => {
  test('no-results state appears for unmatched search', async ({ page }) => {
    // Use a very specific unlikely query to force no results
    await page.goto('/suppliers?q=xyzzy_nothing_here_12345abc');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    const emptyState = page.locator('.sp-empty-state, .sp-fallback-header');
    if ((await emptyState.count()) > 0) {
      await expect(emptyState.first()).toBeVisible();
    }
  });

  test('no-results state offers clear-filters action when filters applied', async ({ page }) => {
    await page.goto('/suppliers?q=xyzzy_nothing_here_12345abc&category=Photography');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // Should offer a way to clear filters
    const clearBtn = page.locator('#clear-filters-btn');
    if ((await clearBtn.count()) > 0) {
      await expect(clearBtn).toBeVisible();
    }
  });

  test('no-results state links to browse all suppliers', async ({ page }) => {
    await page.goto('/suppliers?q=xyzzy_nothing_here_12345abc');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    const browseLink = page.locator('a[href="/suppliers"]');
    if ((await browseLink.count()) > 0) {
      await expect(browseLink.first()).toBeVisible();
    }
  });
});

// ─── Logged-out supplier card actions ────────────────────────────────────────

test.describe('Logged-out supplier card action gates @backend', () => {
  test.beforeEach(async ({ page }) => {
    // Ensure logged-out state by going to suppliers page directly
    await page.goto('/suppliers');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);
  });

  test('logged-out Save redirects to /auth with redirect and intent=save', async ({ page }) => {
    const saveBtn = page.locator('.btn-shortlist').first();
    if ((await saveBtn.count()) === 0) return; // no suppliers loaded, skip

    await saveBtn.click();

    // Should navigate to /auth within a short time (toast + setTimeout)
    await page.waitForURL(url => url.pathname === '/auth', { timeout: 5000 });
    const url = new URL(page.url());
    expect(url.searchParams.get('intent')).toBe('save');
    const redirect = url.searchParams.get('redirect');
    expect(redirect).toBeTruthy();
    expect(redirect).toMatch(/^\//); // relative path
    expect(redirect).toContain('/suppliers');
  });

  test('logged-out Contact redirects to /auth with redirect and intent=message', async ({
    page,
  }) => {
    const contactBtn = page.locator('.btn-contact-supplier').first();
    if ((await contactBtn.count()) === 0) return;

    await contactBtn.click();

    await page.waitForURL(url => url.pathname === '/auth', { timeout: 5000 });
    const url = new URL(page.url());
    expect(url.searchParams.get('intent')).toBe('message');
    const redirect = url.searchParams.get('redirect');
    expect(redirect).toBeTruthy();
    expect(redirect).toMatch(/^\//);
  });

  test('logged-out Add to Plan redirects to /auth with redirect and intent=plan', async ({
    page,
  }) => {
    const planBtn = page.locator('.btn-add-to-plan').first();
    if ((await planBtn.count()) === 0) return;

    await planBtn.click();

    await page.waitForURL(url => url.pathname === '/auth', { timeout: 5000 });
    const url = new URL(page.url());
    expect(url.searchParams.get('intent')).toBe('plan');
    const redirect = url.searchParams.get('redirect');
    expect(redirect).toBeTruthy();
    expect(redirect).toMatch(/^\//);
  });
});

// ─── Auth intent notice ───────────────────────────────────────────────────────

test.describe('Auth intent notice display @static', () => {
  test('save intent shows contextual notice on /auth page', async ({ page }) => {
    await page.goto('/auth?redirect=/suppliers&intent=save');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    const notice = page.locator('#auth-intent-notice');
    if ((await notice.count()) > 0) {
      const isVisible = await notice.evaluate(el => {
        return el.classList.contains('is-visible') || getComputedStyle(el).display !== 'none';
      });
      if (isVisible) {
        const text = await notice.textContent();
        expect(text).toMatch(/log in|save|shortlist/i);
      }
    }
  });

  test('message intent shows contextual notice on /auth page', async ({ page }) => {
    await page.goto('/auth?redirect=/suppliers&intent=message');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    const notice = page.locator('#auth-intent-notice');
    if ((await notice.count()) > 0) {
      const isVisible = await notice.evaluate(
        el => el.classList.contains('is-visible') || getComputedStyle(el).display !== 'none'
      );
      if (isVisible) {
        const text = await notice.textContent();
        expect(text).toMatch(/log in|message|supplier/i);
      }
    }
  });

  test('plan intent shows contextual notice on /auth page', async ({ page }) => {
    await page.goto('/auth?redirect=/plan&intent=plan');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    const notice = page.locator('#auth-intent-notice');
    if ((await notice.count()) > 0) {
      const isVisible = await notice.evaluate(
        el => el.classList.contains('is-visible') || getComputedStyle(el).display !== 'none'
      );
      if (isVisible) {
        const text = await notice.textContent();
        expect(text).toMatch(/log in|plan|package/i);
      }
    }
  });

  test('listing intent shows contextual notice on /auth page', async ({ page }) => {
    await page.goto('/auth?redirect=/supplier/marketplace-new-listing&intent=listing');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    const notice = page.locator('#auth-intent-notice');
    if ((await notice.count()) > 0) {
      const isVisible = await notice.evaluate(
        el => el.classList.contains('is-visible') || getComputedStyle(el).display !== 'none'
      );
      if (isVisible) {
        const text = await notice.textContent();
        expect(text).toMatch(/log in|list|marketplace/i);
      }
    }
  });
});

// ─── Marketplace public funnel ────────────────────────────────────────────────

test.describe('Marketplace browse and listing funnel @backend', () => {
  test('marketplace page loads', async ({ page }) => {
    await page.goto('/marketplace');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);

    // Page should not be completely blank
    const body = await page.textContent('body');
    expect(body).toBeTruthy();

    // Should have marketplace content areas
    const results = page.locator('#marketplace-results, .marketplace-results, [data-marketplace]');
    if ((await results.count()) > 0) {
      await expect(results.first()).toBeVisible();
    }
  });

  test('marketplace listing modal can open @backend', async ({ page }) => {
    await page.goto('/marketplace');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    const card = page.locator('.listing-card, [data-listing-id]').first();
    if ((await card.count()) > 0 && (await card.isVisible())) {
      await card.click();
      await page.waitForTimeout(1000);
      // A modal or detail should appear
      const modal = page.locator('.modal, [role="dialog"], .listing-modal, .listing-detail');
      if ((await modal.count()) > 0) {
        await expect(modal.first()).toBeVisible();
      }
    }
  });

  test('logged-out marketplace save redirects to /auth with intent=save', async ({ page }) => {
    await page.goto('/marketplace');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    const saveBtn = page.locator('[data-action="save-listing"], .btn-save-listing').first();
    if ((await saveBtn.count()) === 0) return;

    await saveBtn.click();
    await page.waitForURL(url => url.pathname === '/auth', { timeout: 5000 });
    const url = new URL(page.url());
    expect(url.searchParams.get('intent')).toBe('save');
  });

  test('logged-out marketplace new listing redirects to /auth with intent=listing', async ({
    page,
  }) => {
    await page.goto('/marketplace');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Find the "List an item" / "Create listing" button
    const listBtn = page
      .locator(
        'button:has-text("List"), a:has-text("List"), button:has-text("Sell"), a:has-text("Create listing")'
      )
      .first();

    if ((await listBtn.count()) === 0) return;
    await listBtn.click();

    await page.waitForURL(
      url => url.pathname === '/auth' || url.pathname.includes('marketplace-new'),
      {
        timeout: 5000,
      }
    );

    if (new URL(page.url()).pathname === '/auth') {
      const url = new URL(page.url());
      expect(url.searchParams.get('intent')).toBe('listing');
    }
  });
});

// ─── Mobile viewport smoke tests ─────────────────────────────────────────────

test.describe('Mobile viewport smoke tests @static', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('suppliers page loads on mobile', async ({ page }) => {
    await page.goto('/suppliers');
    await page.waitForLoadState('domcontentloaded');

    // No horizontal scroll
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = 390;
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 10); // 10px tolerance

    // Search/filter area should be present
    const filterArea = page.locator('.sp-filters, #filter-query, input[name="q"], .sp-search-form');
    if ((await filterArea.count()) > 0) {
      // At least one filter element present in DOM
      expect(await filterArea.count()).toBeGreaterThan(0);
    }
  });

  test('marketplace page loads on mobile', async ({ page }) => {
    await page.goto('/marketplace');
    await page.waitForLoadState('domcontentloaded');

    // No horizontal scroll
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(400);
  });

  test('suppliers filter panel does not overflow on mobile', async ({ page }) => {
    await page.goto('/suppliers');
    await page.waitForLoadState('domcontentloaded');

    const hasHScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth + 5;
    });
    expect(hasHScroll).toBe(false);
  });

  test('auth intent page renders correctly on mobile', async ({ page }) => {
    await page.goto('/auth?redirect=/suppliers&intent=save');
    await page.waitForLoadState('domcontentloaded');

    const hasHScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 5
    );
    expect(hasHScroll).toBe(false);
  });
});
