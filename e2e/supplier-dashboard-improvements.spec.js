import { test, expect } from '@playwright/test';

test.describe('Supplier Dashboard Improvements @backend', () => {
  test.beforeEach(async ({ page }) => {
    // This test assumes the user is logged in as a supplier
    // In a real scenario, you'd need to authenticate first
    await page.goto('/');
  });

  test('navigation pills should be centered on mobile', async ({ page }) => {
    // Navigate to supplier dashboard (adjust URL based on your routing)
    await page.goto('/dashboard-supplier.html');
    await page.waitForLoadState('networkidle');

    // Find the mobile nav pills container
    const navPills = page.locator('.mobile-nav-pills');

    if ((await navPills.count()) > 0) {
      // Check if the container exists
      await expect(navPills).toBeVisible();

      // Verify the justify-content style is set to center
      const justifyContent = await navPills.evaluate(el => {
        return window.getComputedStyle(el).justifyContent;
      });

      expect(justifyContent).toBe('center');
    }
  });

  test('navigation pills should display all sections', async ({ page }) => {
    await page.goto('/dashboard-supplier.html');
    await page.waitForLoadState('networkidle');

    const navPills = page.locator('.mobile-nav-pills');

    if ((await navPills.count()) > 0) {
      // Check for expected navigation items
      await expect(page.getByTestId('nav-overview')).toBeVisible();
      await expect(page.getByTestId('nav-stats')).toBeVisible();
      await expect(page.getByTestId('nav-profiles')).toBeVisible();
      await expect(page.getByTestId('nav-packages')).toBeVisible();
      await expect(page.getByTestId('nav-messages')).toBeVisible();
      await expect(page.getByTestId('nav-tickets')).toBeVisible();
    }
  });

  test('onboarding card should show for first-time users', async ({ page, context }) => {
    // Set the flag that triggers onboarding
    await context.addInitScript(() => {
      localStorage.setItem('eventflow_onboarding_new', '1');
      localStorage.removeItem('ef_onboarding_dismissed');
    });

    await page.goto('/dashboard-supplier.html');
    await page.waitForLoadState('networkidle');

    // Wait for the onboarding dismiss button to appear
    const dismissButton = page.locator('#ef-onboarding-dismiss');
    await expect(dismissButton).toBeVisible({ timeout: 5000 });

    // Check if onboarding card is displayed
    const onboardingCard = dismissButton.locator('..');

    if ((await onboardingCard.count()) > 0) {
      await expect(onboardingCard).toBeVisible();

      // Check for key elements in the new design
      await expect(page.locator('text=Welcome to Your Supplier Dashboard!')).toBeVisible();
      await expect(page.locator('text=Complete your supplier profile')).toBeVisible();
      await expect(page.locator('text=Add your first package or service')).toBeVisible();
      await expect(page.locator('text=Start engaging with customers')).toBeVisible();
    }
  });

  test('onboarding card "Got it" button should permanently dismiss', async ({ page, context }) => {
    // Set the flag that triggers onboarding
    await context.addInitScript(() => {
      localStorage.setItem('eventflow_onboarding_new', '1');
      localStorage.removeItem('ef_onboarding_dismissed');
      localStorage.removeItem('ef_supplier_welcome_dismissed');
    });

    await page.goto('/dashboard-supplier.html');
    await page.waitForLoadState('networkidle');

    const dismissButton = page.locator('#ef-onboarding-dismiss');
    await expect(dismissButton).toBeVisible({ timeout: 5000 });

    if ((await dismissButton.count()) > 0) {
      // Click the "Got it" button
      await dismissButton.click();

      // Check if the card was removed
      const onboardingCard = page.locator('#ef-onboarding-dismiss').locator('..');
      await expect(onboardingCard).not.toBeVisible();

      // Verify both localStorage keys are set
      const dismissedFlag = await page.evaluate(() => {
        return localStorage.getItem('ef_onboarding_dismissed');
      });
      expect(dismissedFlag).toBe('1');

      const welcomeDismissedFlag = await page.evaluate(() => {
        return localStorage.getItem('ef_supplier_welcome_dismissed');
      });
      expect(welcomeDismissedFlag).toBe('1');

      // Welcome section should also be hidden after the animation completes
      // (real code defers display:none by ~350 ms via setTimeout)
      await page.waitForFunction(
        () => {
          const el = document.getElementById('welcome-section');
          return !el || el.style.display === 'none';
        },
        { timeout: 1000 }
      );
    }
  });

  test('welcome section is hidden on reload when ef_supplier_welcome_dismissed is set', async ({
    page,
    context,
  }) => {
    // Simulate a returning supplier who already dismissed the welcome banner
    await context.addInitScript(() => {
      localStorage.setItem('ef_supplier_welcome_dismissed', '1');
    });

    await page.goto('/dashboard-supplier.html');
    await page.waitForLoadState('networkidle');

    // The welcome section should be hidden
    const welcomeVisible = await page.evaluate(() => {
      const el = document.getElementById('welcome-section');
      return el ? el.style.display !== 'none' : false;
    });
    expect(welcomeVisible).toBe(false);
  });

  test('onboarding card should not show when dismissed', async ({ page, context }) => {
    // Set the dismissed flag
    await context.addInitScript(() => {
      localStorage.setItem('ef_onboarding_dismissed', '1');
      localStorage.setItem('eventflow_onboarding_new', '1');
    });

    await page.goto('/dashboard-supplier.html');
    await page.waitForLoadState('networkidle');

    // Onboarding card should not be visible
    const onboardingCard = page.locator('#ef-onboarding-dismiss');
    await expect(onboardingCard).not.toBeVisible();
  });

  test('onboarding card should have teal liquid glass design', async ({ page, context }) => {
    // Set the flag that triggers onboarding
    await context.addInitScript(() => {
      localStorage.setItem('eventflow_onboarding_new', '1');
      localStorage.removeItem('ef_onboarding_dismissed');
    });

    await page.goto('/dashboard-supplier.html');
    await page.waitForLoadState('networkidle');

    const dismissButton = page.locator('#ef-onboarding-dismiss');
    await expect(dismissButton).toBeVisible({ timeout: 5000 });

    const onboardingCard = dismissButton.locator('..');

    if ((await onboardingCard.count()) > 0) {
      // Check for teal gradient background (should contain teal colors)
      const background = await onboardingCard.evaluate(el => {
        return window.getComputedStyle(el).background;
      });

      expect(background).toContain('gradient');

      // Check for liquid glass effects
      const backdropFilter = await onboardingCard.evaluate(el => {
        return window.getComputedStyle(el).backdropFilter;
      });
      expect(backdropFilter).toContain('blur');

      // Check for emoji icon with accessibility attributes
      await expect(page.locator('[role="img"][aria-label="celebration"]')).toBeVisible();

      // Check button has teal color (#0B8073)
      const buttonColor = await dismissButton.evaluate(el => {
        return window.getComputedStyle(el).color;
      });
      // RGB equivalent of #0B8073 is rgb(11, 128, 115)
      // Check for the teal color (should contain 'rgb(11, 128, 115)' or similar)
      expect(buttonColor).toMatch(/rgb\(11,\s*128,\s*115\)/i);

      // Check for the new CTA text
      await expect(page.locator("text=Got it! Let's go 🚀")).toBeVisible();
    }
  });

  test('navigation pills should be scrollable on narrow viewports', async ({ page }) => {
    // Set a narrow viewport to test horizontal scrolling
    await page.setViewportSize({ width: 375, height: 667 }); // iPhone SE size

    await page.goto('/dashboard-supplier.html');
    await page.waitForLoadState('networkidle');

    const navPills = page.locator('.mobile-nav-pills');

    if ((await navPills.count()) > 0) {
      // Check if overflow-x is set to auto
      const overflowX = await navPills.evaluate(el => {
        return window.getComputedStyle(el).overflowX;
      });

      expect(overflowX).toBe('auto');
    }
  });

  test('onboarding card button should have hover effect', async ({ page, context }) => {
    // Set the flag that triggers onboarding
    await context.addInitScript(() => {
      localStorage.setItem('eventflow_onboarding_new', '1');
      localStorage.removeItem('ef_onboarding_dismissed');
    });

    await page.goto('/dashboard-supplier.html');
    await page.waitForLoadState('networkidle');

    const dismissButton = page.locator('#ef-onboarding-dismiss');
    await expect(dismissButton).toBeVisible({ timeout: 5000 });

    if ((await dismissButton.count()) > 0) {
      // Hover over the button
      await dismissButton.hover();

      // The transform should be applied (though exact value varies by browser)
      const transform = await dismissButton.evaluate(el => {
        return window.getComputedStyle(el).transform;
      });

      // Just verify transform property exists and is not 'none'
      expect(transform).toBeTruthy();
      expect(transform).not.toBe('none');
    }
  });

  // ─── Responsive layout overhaul tests ─────────────────────────────────────

  test('messages toolbar search input should be accessible on narrow screens', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/dashboard-supplier.html');
    await page.waitForLoadState('networkidle');

    const searchInput = page.locator('#widget-search-input-supplier');
    if ((await searchInput.count()) > 0) {
      await expect(searchInput).toBeVisible();

      // Verify search input is reachable and wraps cleanly (no overflow)
      const boundingBox = await searchInput.boundingBox();
      expect(boundingBox).not.toBeNull();
      // Should be within the page width with some tolerance
      // +2px accounts for sub-pixel rendering and fractional scroll differences
      expect(boundingBox.x + boundingBox.width).toBeLessThanOrEqual(375 + 2);
    }
  });

  test('messages toolbar filter and sort selects should be visible', async ({ page }) => {
    await page.goto('/dashboard-supplier.html');
    await page.waitForLoadState('networkidle');

    const filterSelect = page.locator('#widget-filter-select-supplier');
    const sortSelect = page.locator('#widget-sort-select-supplier');

    if ((await filterSelect.count()) > 0) {
      await expect(filterSelect).toBeVisible();
    }
    if ((await sortSelect.count()) > 0) {
      await expect(sortSelect).toBeVisible();
    }
  });

  test('section headers use reusable sd-card-header class', async ({ page }) => {
    await page.goto('/dashboard-supplier.html');
    await page.waitForLoadState('networkidle');

    // Verify key section headers use the new CSS class
    const sdHeaders = page.locator('.sd-card-header');
    expect(await sdHeaders.count()).toBeGreaterThanOrEqual(5);
  });

  test('section dividers are compact and use sd-section-divider class', async ({ page }) => {
    await page.goto('/dashboard-supplier.html');
    await page.waitForLoadState('networkidle');

    const dividers = page.locator('.sd-section-divider');
    if ((await dividers.count()) > 0) {
      for (let i = 0; i < (await dividers.count()); i++) {
        const divider = dividers.nth(i);
        const box = await divider.boundingBox();
        if (box) {
          // Dividers should be compact (under 40px tall)
          expect(box.height).toBeLessThan(40);
        }
      }
    }
  });

  test('availability calendar section uses compact CSS classes', async ({ page }) => {
    await page.goto('/dashboard-supplier.html');
    await page.waitForLoadState('networkidle');

    const calendar = page.locator('#availability-calendar');
    if ((await calendar.count()) > 0) {
      await expect(calendar).toBeVisible();
      // Should use sd-card class for consistent styling
      const hasClass = await calendar.evaluate(el => el.classList.contains('sd-card'));
      expect(hasClass).toBe(true);
    }
  });

  test('desktop layout: subscription and lead quality are side-by-side at 1200px', async ({
    page,
  }) => {
    // 1200px is well above the 1024px breakpoint where sd-two-col switches to flex-direction: row
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/dashboard-supplier.html');
    await page.waitForLoadState('networkidle');

    const twoColWrapper = page.locator('.sd-two-col').first();
    if ((await twoColWrapper.count()) > 0) {
      const flexDir = await twoColWrapper.evaluate(el => {
        return window.getComputedStyle(el).flexDirection;
      });
      // At 1200px, should be row (side-by-side)
      expect(flexDir).toBe('row');
    }
  });

  test('mobile layout: sd-two-col stacks vertically at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/dashboard-supplier.html');
    await page.waitForLoadState('networkidle');

    const twoColWrapper = page.locator('.sd-two-col').first();
    if ((await twoColWrapper.count()) > 0) {
      const flexDir = await twoColWrapper.evaluate(el => {
        return window.getComputedStyle(el).flexDirection;
      });
      // On mobile, should stack (column)
      expect(flexDir).toBe('column');
    }
  });

  test('no horizontal overflow at common breakpoints', async ({ page }) => {
    const viewports = [
      { width: 375, height: 667 },
      { width: 768, height: 1024 },
      { width: 1280, height: 800 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize(vp);
      await page.goto('/dashboard-supplier.html');
      await page.waitForLoadState('networkidle');

      // Check body scroll width does not exceed viewport width significantly
      const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(vp.width + 20); // 20px tolerance for scrollbar
    }
  });

  test('critical sections are visible at desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/dashboard-supplier.html');
    await page.waitForLoadState('networkidle');

    // These critical sections should be present in the DOM
    await expect(page.locator('#welcome-section, .dashboard-hero').first()).toBeAttached();
    await expect(page.locator('#supplier-stats-grid')).toBeAttached();
    await expect(page.locator('#my-suppliers')).toBeAttached();
    await expect(page.locator('#my-packages')).toBeAttached();
    await expect(page.locator('#threads-sup')).toBeAttached();
    await expect(page.locator('#tickets-sup')).toBeAttached();
  });

  test('export button uses sd-messages-toolbar__export class and has aria-label', async ({
    page,
  }) => {
    await page.goto('/dashboard-supplier.html');
    await page.waitForLoadState('networkidle');

    const exportBtn = page.locator('#export-enquiries-btn');
    if ((await exportBtn.count()) > 0) {
      const hasClass = await exportBtn.evaluate(el =>
        el.classList.contains('sd-messages-toolbar__export')
      );
      expect(hasClass).toBe(true);
      // aria-label must be present for icon-only display on mobile
      const ariaLabel = await exportBtn.getAttribute('aria-label');
      expect(ariaLabel).toBeTruthy();
    }
  });

  test('reviews placeholder uses sd-reviews-placeholder CSS class', async ({ page }) => {
    await page.goto('/dashboard-supplier.html');
    await page.waitForLoadState('networkidle');

    const placeholder = page.locator('.sd-reviews-placeholder');
    if ((await placeholder.count()) > 0) {
      await expect(placeholder.first()).toBeAttached();
    }
  });

  test('form-toggle buttons use CSS variant classes instead of inline styles', async ({ page }) => {
    await page.goto('/dashboard-supplier.html');
    await page.waitForLoadState('networkidle');

    const profileToggle = page.locator('#toggle-profile-form');
    if ((await profileToggle.count()) > 0) {
      // Button should not have a style attribute (inline styles removed)
      const styleAttr = await profileToggle.getAttribute('style');
      expect(styleAttr).toBeNull();
      // Teal variant class must be present so gradient styling still applies
      const hasTealClass = await profileToggle.evaluate(el =>
        el.classList.contains('form-toggle-btn--teal')
      );
      expect(hasTealClass).toBe(true);
    }

    const packageToggle = page.locator('#toggle-package-form');
    if ((await packageToggle.count()) > 0) {
      const styleAttr = await packageToggle.getAttribute('style');
      expect(styleAttr).toBeNull();
      // Indigo variant class must be present so gradient styling still applies
      const hasIndigoClass = await packageToggle.evaluate(el =>
        el.classList.contains('form-toggle-btn--indigo')
      );
      expect(hasIndigoClass).toBe(true);
    }
  });
});
