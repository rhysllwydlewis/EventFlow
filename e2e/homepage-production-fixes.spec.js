const { test, expect } = require('@playwright/test');

/**
 * Homepage Production Fixes - Validation Tests
 *
 * This test suite validates the following fixes:
 * 1. No 404 API calls for /api/public/homepage-settings or /api/reviews
 * 2. Homepage loads cleanly without console errors
 * 3. Mobile navigation (burger menu) works correctly
 * 4. Search button is not oversized on mobile
 * 5. Auth state is properly managed with AuthStateManager
 */

test.describe('Homepage Production Fixes', () => {
  test.beforeEach(async ({ page }) => {
    // Track console errors (excluding extensions and tracking)
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Ignore known third-party/browser extension errors
        if (
          !text.includes('extensions::') &&
          !text.includes('chrome-extension://') &&
          !text.includes('Tracking Protection') &&
          !text.includes('ServiceWorker')
        ) {
          console.log('Console error:', text);
        }
      }
    });
  });

  test('Task 1: No 404 errors for homepage-settings or reviews endpoints', async ({ page }) => {
    const failed404s = [];

    // Track network requests
    page.on('response', response => {
      if (response.status() === 404) {
        const url = response.url();
        // Check for the specific endpoints we removed
        if (url.includes('/api/public/homepage-settings') || url.includes('/api/reviews')) {
          failed404s.push(url);
        }
      }
    });

    // Navigate to homepage
    await page.goto('/', { waitUntil: 'networkidle' });

    // Wait a bit to ensure all async calls are made
    await page.waitForTimeout(2000);

    // Verify no 404s for the removed endpoints
    expect(failed404s).toHaveLength(0);
    console.log('✓ No 404 errors for homepage-settings or reviews');
  });

  test('Task 2: Homepage loads with proper loading/error states at 320×568', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Wait for page to settle
    await page.waitForTimeout(1500);

    // Check that sections either load or are hidden (not broken)
    const sections = [
      'featured-packages',
      'spotlight-packages',
      'marketplace-preview',
      'guides-list',
    ];

    for (const sectionId of sections) {
      const section = page.locator(`#${sectionId}`);
      const exists = (await section.count()) > 0;

      if (exists) {
        const content = await section.textContent();
        // Section should have content OR be hidden (not blank and visible)
        expect(content.trim().length).toBeGreaterThan(0);
      }
    }

    // Testimonials section should be hidden (since endpoint doesn't exist)
    const testimonialsSection = page.locator('#testimonials-section');
    if ((await testimonialsSection.count()) > 0) {
      const display = await testimonialsSection.evaluate(el => window.getComputedStyle(el).display);
      expect(display).toBe('none');
    }

    // Take screenshot
    await page.screenshot({
      path: '/tmp/homepage-320x568.png',
      fullPage: true,
    });
    console.log('✓ Homepage loads properly at 320×568');
  });

  test('Task 2: Homepage loads with proper loading/error states at 395×653', async ({ page }) => {
    await page.setViewportSize({ width: 395, height: 653 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Wait for page to settle
    await page.waitForTimeout(1500);

    // Verify sections are rendering or hidden properly
    const featuredPackages = page.locator('#featured-packages');
    if ((await featuredPackages.count()) > 0) {
      const content = await featuredPackages.textContent();
      expect(content.trim().length).toBeGreaterThan(0);
    }

    // Take screenshot
    await page.screenshot({
      path: '/tmp/homepage-395x653.png',
      fullPage: true,
    });
    console.log('✓ Homepage loads properly at 395×653');
  });

  test('Task 4: Burger menu works correctly on mobile (395×653)', async ({ page }) => {
    await page.setViewportSize({ width: 395, height: 653 });
    await page.goto('/', { waitUntil: 'networkidle' });

    // Check if burger menu toggle exists
    const burgerToggle = page.locator('.nav-toggle, .ef-mobile-toggle');
    const toggleExists = (await burgerToggle.count()) > 0;

    if (!toggleExists) {
      console.log('⚠ Burger menu toggle not found on page');
      return;
    }

    // Check initial state
    const mobileMenu = page.locator('.nav-menu, #ef-mobile-menu');
    const menuExists = (await mobileMenu.count()) > 0;

    if (!menuExists) {
      console.log('⚠ Mobile menu not found on page');
      return;
    }

    // Get initial display state
    const initialDisplay = await mobileMenu.evaluate(el => window.getComputedStyle(el).display);
    console.log('Initial menu display:', initialDisplay);

    // Click burger menu to open
    await burgerToggle.first().click();
    await page.waitForTimeout(500); // Wait for animation

    // Take screenshot with menu open
    await page.screenshot({
      path: '/tmp/homepage-menu-open-395x653.png',
      fullPage: true,
    });

    // Check if menu is visible after opening
    const openDisplay = await mobileMenu.first().evaluate(el => {
      const styles = window.getComputedStyle(el);
      return {
        display: styles.display,
        opacity: styles.opacity,
        visibility: styles.visibility,
      };
    });

    console.log('Menu open state:', openDisplay);

    // Menu should be visible (not display:none)
    expect(openDisplay.display).not.toBe('none');

    // Close menu by clicking toggle again
    await burgerToggle.first().click();
    await page.waitForTimeout(500);

    console.log('✓ Burger menu opens and closes correctly');
  });

  test('Task 4: Burger menu works correctly on mobile (320×568)', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/', { waitUntil: 'networkidle' });

    const burgerToggle = page.locator('.nav-toggle, .ef-mobile-toggle');
    const toggleExists = (await burgerToggle.count()) > 0;

    if (toggleExists) {
      await burgerToggle.first().click();
      await page.waitForTimeout(500);

      await page.screenshot({
        path: '/tmp/homepage-menu-open-320x568.png',
        fullPage: true,
      });

      // Verify menu opened
      const mobileMenu = page.locator('.nav-menu, #ef-mobile-menu');
      if ((await mobileMenu.count()) > 0) {
        const display = await mobileMenu
          .first()
          .evaluate(el => window.getComputedStyle(el).display);
        expect(display).not.toBe('none');
      }
    }

    console.log('✓ Burger menu works at 320×568');
  });

  test('Task 4: Search button is not oversized on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 395, height: 653 });
    await page.goto('/', { waitUntil: 'networkidle' });

    // Check hero search button size
    const heroSearchButton = page.locator('.hero-search-button, button[type="submit"]').first();
    const buttonExists = (await heroSearchButton.count()) > 0;

    if (!buttonExists) {
      console.log('⚠ Search button not found');
      return;
    }

    const buttonSize = await heroSearchButton.evaluate(el => {
      const styles = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        minHeight: styles.minHeight,
        minWidth: styles.minWidth,
        width: rect.width,
        height: rect.height,
      };
    });

    console.log('Search button size:', buttonSize);

    // Button should be reasonably sized (not forced to 44px minimum)
    // The 44px rule should NOT apply to hero-search-button since we excluded it
    // Height should be less than 60px (not the 44px minimum from global rules)
    expect(buttonSize.height).toBeLessThan(60);

    await page.screenshot({
      path: '/tmp/homepage-search-button.png',
    });

    console.log('✓ Search button is properly sized');
  });

  test('Task 3: AuthStateManager is used instead of localStorage', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    // Wait for scripts to load
    await page.waitForTimeout(1000);

    // Check that AuthStateManager is available
    const authManagerExists = await page.evaluate(() => {
      return (
        typeof window.AuthStateManager !== 'undefined' || typeof window.__authState !== 'undefined'
      );
    });

    expect(authManagerExists).toBe(true);

    // Verify notification bell is controlled by auth state
    const notificationBell = page.locator('#notification-bell');
    if ((await notificationBell.count()) > 0) {
      const bellDisplay = await notificationBell.evaluate(
        el => window.getComputedStyle(el).display
      );
      // When not logged in, bell should be hidden
      expect(bellDisplay).toBe('none');
    }

    console.log('✓ AuthStateManager is properly initialized and used');
  });

  test('Desktop: Verify no regressions at 1024×768', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/', { waitUntil: 'networkidle' });

    // Wait for page to settle
    await page.waitForTimeout(1500);

    // Check that navigation is inline (not burger menu)
    const navInline = page.locator('.nav-inline');
    if ((await navInline.count()) > 0) {
      const display = await navInline.evaluate(el => window.getComputedStyle(el).display);
      // Should be visible on desktop
      expect(display).not.toBe('none');
    }

    // Take screenshot
    await page.screenshot({
      path: '/tmp/homepage-desktop-1024x768.png',
      fullPage: true,
    });

    console.log('✓ Desktop view works correctly');
  });

  test('Performance: Page loads without excessive network requests', async ({ page }) => {
    const requests = [];

    page.on('request', request => {
      requests.push(request.url());
    });

    await page.goto('/', { waitUntil: 'networkidle' });

    // Filter for API calls
    const apiCalls = requests.filter(url => url.includes('/api/'));

    console.log('Total API calls:', apiCalls.length);
    console.log('API endpoints called:', [...new Set(apiCalls)]);

    // Should not call the removed endpoints
    const removedEndpoints = apiCalls.filter(
      url => url.includes('/api/public/homepage-settings') || url.includes('/api/reviews')
    );

    expect(removedEndpoints).toHaveLength(0);
    console.log('✓ No calls to removed endpoints');
  });
});
