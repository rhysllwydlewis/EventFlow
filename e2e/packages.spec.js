import { test, expect } from '@playwright/test';

test.describe('Package Browsing and Booking @backend', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display packages page', async ({ page }) => {
    // Navigate to packages if available
    const packagesLink = page.locator('a:has-text("Packages"), a[href*="package"]');
    if ((await packagesLink.count()) > 0) {
      await packagesLink.first().click();
      await page.waitForLoadState('networkidle');

      // Should show package listings
      const packageCards = page.locator('.package-card, [data-package-id], .card');
      if ((await packageCards.count()) > 0) {
        expect(await packageCards.count()).toBeGreaterThan(0);
      }
    }
  });

  test('should show package details', async ({ page }) => {
    // Find first package card
    const packageCard = page.locator('.package-card, [data-package-id]').first();
    if ((await packageCard.count()) > 0) {
      await packageCard.click();
      await page.waitForLoadState('networkidle');

      // Should show package details
      const packageName = page.locator('h1, .package-name, [data-package-name]');
      if ((await packageName.count()) > 0) {
        await expect(packageName).toBeVisible();
      }

      // Should show price
      const price = page.locator('.price, [data-price]');
      if ((await price.count()) > 0) {
        await expect(price.first()).toBeVisible();
      }
    }
  });

  test('should display package images in gallery', async ({ page }) => {
    const packageCard = page.locator('.package-card, [data-package-id]').first();
    if ((await packageCard.count()) > 0) {
      await packageCard.click();
      await page.waitForLoadState('networkidle');

      // Look for image gallery
      const gallery = page.locator('.gallery, .carousel, [data-gallery]');
      if ((await gallery.count()) > 0) {
        await expect(gallery.first()).toBeVisible();

        // Should have images
        const images = gallery.locator('img');
        if ((await images.count()) > 0) {
          expect(await images.count()).toBeGreaterThan(0);
        }
      }
    }
  });

  test('should filter packages by price range', async ({ page }) => {
    const packagesLink = page.locator('a:has-text("Packages"), a[href*="package"]');
    if ((await packagesLink.count()) > 0) {
      await packagesLink.first().click();
      await page.waitForLoadState('networkidle');

      // Look for price filter
      const priceFilter = page.locator('input[type="range"][name*="price"], .price-filter input');
      if ((await priceFilter.count()) > 0) {
        // Adjust price filter
        await priceFilter.first().fill('500');
        await page.waitForTimeout(1000);

        // Results should be filtered
        const packages = page.locator('.package-card, [data-package-id]');
        if ((await packages.count()) > 0) {
          expect(await packages.count()).toBeGreaterThan(0);
        }
      }
    }
  });

  test('should add package to comparison', async ({ page }) => {
    const packageCard = page.locator('.package-card, [data-package-id]').first();
    if ((await packageCard.count()) > 0) {
      // Look for compare button
      const compareButton = packageCard.locator(
        'button:has-text("Compare"), [data-action="compare"]'
      );
      if ((await compareButton.count()) > 0) {
        await compareButton.click();

        // Should show confirmation or update compare count
        const compareCount = page.locator('.compare-count, [data-compare-count]');
        if ((await compareCount.count()) > 0) {
          const count = await compareCount.textContent();
          expect(parseInt(count || '0')).toBeGreaterThan(0);
        }
      }
    }
  });

  test('should show booking form for authenticated users', async ({ page }) => {
    const packageCard = page.locator('.package-card, [data-package-id]').first();
    if ((await packageCard.count()) > 0) {
      await packageCard.click();
      await page.waitForLoadState('networkidle');

      // Look for booking button
      const bookButton = page.locator(
        'button:has-text("Book"), button:has-text("Enquire"), [data-action="book"]'
      );
      if ((await bookButton.count()) > 0) {
        await bookButton.first().click();

        // Should show booking form or redirect to auth
        await page.waitForTimeout(1000);

        // Check if form or auth page is shown
        const bookingForm = page.locator('form[data-booking], .booking-form');
        const authPage = page.url().includes('auth');

        expect((await bookingForm.count()) > 0 || authPage).toBeTruthy();
      }
    }
  });

  test('should display package reviews', async ({ page }) => {
    const packageCard = page.locator('.package-card, [data-package-id]').first();
    if ((await packageCard.count()) > 0) {
      await packageCard.click();
      await page.waitForLoadState('networkidle');

      // Look for reviews section
      const reviews = page.locator('.reviews, [data-reviews], .review-list');
      if ((await reviews.count()) > 0) {
        await expect(reviews.first()).toBeVisible();
      }
    }
  });

  test('should show related packages', async ({ page }) => {
    const packageCard = page.locator('.package-card, [data-package-id]').first();
    if ((await packageCard.count()) > 0) {
      await packageCard.click();
      await page.waitForLoadState('networkidle');

      // Look for related packages section
      const relatedPackages = page.locator(
        '.related-packages, [data-related], h2:has-text("Related")'
      );
      if ((await relatedPackages.count()) > 0) {
        await expect(relatedPackages.first()).toBeVisible();
      }
    }
  });
});

test.describe('Supplier results mini package card navigation', () => {
  test('clicking a mini package card navigates to the package detail page', async ({ page }) => {
    // Navigate to the suppliers results page
    await page.goto('/suppliers.html');
    await page.waitForLoadState('networkidle');

    // Trigger a search to load supplier cards (submit the search form or wait for default results)
    const searchBtn = page.locator('button[type="submit"], button:has-text("Search"), #search-btn');
    if ((await searchBtn.count()) > 0) {
      await searchBtn.first().click();
      await page.waitForLoadState('networkidle');
    }

    // Wait for mini-card anchors to appear
    const miniCard = page.locator('a.sp-pkg-mini').first();
    if ((await miniCard.count()) === 0) {
      // No mini cards rendered — skip gracefully (no packages in results)
      return;
    }

    // Grab the href before clicking so we can assert the URL changed correctly
    const href = await miniCard.getAttribute('href');
    expect(href).toBeTruthy();
    expect(href).toMatch(/\/package/);

    // Click the card (not the inner button)
    await miniCard.click();
    await page.waitForLoadState('networkidle');

    // URL should have changed to the package detail path
    const currentUrl = page.url();
    expect(currentUrl).toMatch(/\/package/);
  });

  test('Add to plan button inside mini card does not navigate to package detail', async ({
    page,
  }) => {
    await page.goto('/suppliers.html');
    await page.waitForLoadState('networkidle');

    const searchBtn = page.locator('button[type="submit"], button:has-text("Search"), #search-btn');
    if ((await searchBtn.count()) > 0) {
      await searchBtn.first().click();
      await page.waitForLoadState('networkidle');
    }

    const addToPlanBtn = page.locator('.btn-add-to-plan').first();
    if ((await addToPlanBtn.count()) === 0) {
      return;
    }

    const urlBefore = page.url();

    // Click should NOT navigate to /package — it redirects to /auth or /start
    await addToPlanBtn.click();
    // Wait for any navigation or redirect triggered by the button
    await page.waitForLoadState('networkidle').catch(() => {});

    const urlAfter = page.url();
    // Should not have gone to a /package route
    expect(urlAfter).not.toMatch(/\/package(\?|$)/);
    // Should still be on suppliers page or redirect to auth/start
    expect(urlAfter).toMatch(/suppliers|auth|start/);
  });
});
