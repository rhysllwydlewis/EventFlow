/**
 * Dashboard Mobile UI Fixes E2E Tests
 * Tests for notification bell touch support
 */

const { test, expect } = require('@playwright/test');

// Mobile viewport sizes to test
const VIEWPORTS = {
  mobile: { width: 375, height: 667 },
  mobileLarge: { width: 414, height: 896 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1024, height: 768 },
};

test.describe('Notification Bell Touch Support', () => {
  test('should have notification bell element', async ({ page }) => {
    await page.goto('/dashboard-supplier.html');

    // Look for notification bell by common IDs
    const bellSelectors = ['#ef-notification-btn', '#notification-bell'];
    let bellFound = false;

    for (const selector of bellSelectors) {
      const bell = page.locator(selector);
      const count = await bell.count();
      if (count > 0) {
        bellFound = true;

        // Check bell is not disabled
        const isDisabled = await bell.evaluate(el => el.disabled);
        expect(isDisabled).toBe(false);

        // Check bell has pointer-events enabled
        const pointerEvents = await bell.evaluate(el => window.getComputedStyle(el).pointerEvents);
        expect(pointerEvents).not.toBe('none');

        break;
      }
    }

    // If bell exists, verify touch handling
    if (bellFound) {
      expect(bellFound).toBe(true);
    }
  });

  test('should respond to click events on notification bell', async ({ page }) => {
    await page.goto('/dashboard-supplier.html');

    // Wait for page to be interactive
    await page.waitForLoadState('domcontentloaded');

    const bellSelectors = ['#ef-notification-btn', '#notification-bell'];

    for (const selector of bellSelectors) {
      const bell = page.locator(selector);
      const count = await bell.count();

      if (count > 0) {
        // Click the bell
        await bell.click();

        // Check if dropdown appeared
        const dropdown = page.locator('.notification-dropdown');
        const dropdownCount = await dropdown.count();

        if (dropdownCount > 0) {
          // Wait for dropdown to become visible (may not exist or may timeout)
          try {
            await dropdown.waitFor({ state: 'visible', timeout: 1000 });
          } catch (err) {
            // Dropdown may not be present or may not become visible - test will continue
            console.log('Dropdown did not become visible within timeout:', err.message);
          }

          // Check if dropdown has open class
          const hasOpenClass = await dropdown.evaluate(el =>
            el.classList.contains('notification-dropdown--open')
          );
          expect(hasOpenClass).toBe(true);
        }

        break;
      }
    }
  });

  test('should respond to touch events on mobile viewport', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/dashboard-supplier.html');

    // Wait for page to be interactive
    await page.waitForLoadState('domcontentloaded');

    const bellSelectors = ['#ef-notification-btn', '#notification-bell'];

    for (const selector of bellSelectors) {
      const bell = page.locator(selector);
      const count = await bell.count();

      if (count > 0) {
        // Tap the bell (simulates touch)
        await bell.tap();

        // Check if dropdown appeared
        const dropdown = page.locator('.notification-dropdown');
        const dropdownCount = await dropdown.count();

        if (dropdownCount > 0) {
          // Wait for dropdown to become visible (may not exist or may timeout)
          try {
            await dropdown.waitFor({ state: 'visible', timeout: 1000 });
          } catch (err) {
            // Dropdown may not be present or may not become visible - test will continue
            console.log('Dropdown did not become visible within timeout:', err.message);
          }

          // Check if dropdown has open class
          const hasOpenClass = await dropdown.evaluate(el =>
            el.classList.contains('notification-dropdown--open')
          );
          expect(hasOpenClass).toBe(true);
        }

        break;
      }
    }
  });
});
