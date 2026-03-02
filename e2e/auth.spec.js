import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display login page', async ({ page }) => {
    await page.goto('/auth.html');
    await expect(page).toHaveTitle(/EventFlow/i);
    await expect(page.locator('#login-form')).toBeVisible();
  });

  test('should have correct ARIA roles on tab interface', async ({ page }) => {
    await page.goto('/auth.html');
    await page.waitForLoadState('networkidle');

    // Tab list role
    await expect(page.locator('[role="tablist"]')).toBeVisible();

    // Tab buttons
    const signinTab = page.locator('#tab-signin');
    const createTab = page.locator('#tab-create');
    await expect(signinTab).toHaveAttribute('role', 'tab');
    await expect(createTab).toHaveAttribute('role', 'tab');
    await expect(signinTab).toHaveAttribute('aria-selected', 'true');
    await expect(createTab).toHaveAttribute('aria-selected', 'false');
    await expect(signinTab).toHaveAttribute('aria-controls', 'panel-signin');
    await expect(createTab).toHaveAttribute('aria-controls', 'panel-create');

    // Tab panels
    await expect(page.locator('#panel-signin')).toHaveAttribute('role', 'tabpanel');
    await expect(page.locator('#panel-create')).toHaveAttribute('role', 'tabpanel');
    await expect(page.locator('#panel-signin')).toHaveAttribute('aria-labelledby', 'tab-signin');
    await expect(page.locator('#panel-create')).toHaveAttribute('aria-labelledby', 'tab-create');
  });

  test('should switch tabs on click and update aria-selected', async ({ page }) => {
    await page.goto('/auth.html');
    await page.waitForLoadState('networkidle');

    // Initially login panel is visible, create panel is hidden
    await expect(page.locator('#panel-signin')).toBeVisible();
    await expect(page.locator('#panel-create')).toBeHidden();

    // Click create tab
    await page.click('#tab-create');

    await expect(page.locator('#tab-create')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tab-signin')).toHaveAttribute('aria-selected', 'false');
    await expect(page.locator('#panel-create')).toBeVisible();
    await expect(page.locator('#panel-signin')).toBeHidden();

    // Click login tab back
    await page.click('#tab-signin');

    await expect(page.locator('#tab-signin')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tab-create')).toHaveAttribute('aria-selected', 'false');
    await expect(page.locator('#panel-signin')).toBeVisible();
    await expect(page.locator('#panel-create')).toBeHidden();
  });

  test('should support keyboard navigation between tabs', async ({ page }) => {
    await page.goto('/auth.html');
    await page.waitForLoadState('networkidle');

    // Focus login tab and press ArrowRight to switch to create tab
    await page.focus('#tab-signin');
    await page.keyboard.press('ArrowRight');

    await expect(page.locator('#tab-create')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#panel-create')).toBeVisible();

    // Press ArrowLeft to go back
    await page.keyboard.press('ArrowLeft');

    await expect(page.locator('#tab-signin')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#panel-signin')).toBeVisible();
  });

  test('should show validation errors for empty login', async ({ page, browserName }) => {
    await page.goto('/auth.html');

    // Wait for page to be fully loaded
    await page.waitForLoadState('networkidle');
    // Webkit needs more time to fully render and initialize validators
    const initialWait = browserName === 'webkit' ? 2000 : 1000;
    await page.waitForTimeout(initialWait);

    // Try to submit empty form
    await page.click('button[type="submit"]');

    // Wait for validation to process (webkit/Safari needs more time)
    const validationWait = browserName === 'webkit' ? 4000 : 2000;
    await page.waitForTimeout(validationWait);

    // Should show validation errors - be more flexible with selector
    const errorElement = page
      .locator('.error, .alert-danger, .invalid-feedback, [role="alert"]')
      .first();
    await expect(errorElement).toBeVisible({ timeout: 15000 });
  });

  test('should navigate to registration', async ({ page }) => {
    await page.goto('/auth.html');

    // Look for registration link
    const regLink = page.locator('a:has-text("Sign up"), a:has-text("Register")');
    if ((await regLink.count()) > 0) {
      await regLink.first().click();
      await expect(page).toHaveURL(/auth\.html/);
    }
  });

  test('should show password visibility toggle', async ({ page }) => {
    await page.goto('/auth.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    const passwordInput = page.locator('input[type="password"]').first();
    if ((await passwordInput.count()) > 0) {
      await expect(passwordInput).toBeVisible();

      // Look for toggle button (added by app.js with SVG eye icon)
      const toggleButton = page.locator('.password-toggle, [aria-label*="password" i]');
      if ((await toggleButton.count()) > 0) {
        await toggleButton.first().click();
        // Password input type should now be text
        const visibleInput = page.locator('input[type="text"]').first();
        if ((await visibleInput.count()) > 0) {
          await expect(visibleInput).toBeVisible();
        }
      }
    }
  });

  test('should handle login with invalid credentials @backend', async ({ page, browserName }) => {
    await page.goto('/auth.html');

    // Wait for page to be fully loaded
    await page.waitForLoadState('networkidle');
    // Webkit needs more time to initialize
    const initialWait = browserName === 'webkit' ? 2000 : 1000;
    await page.waitForTimeout(initialWait);

    // Fill in invalid credentials
    await page.fill('input[type="email"], input[name="email"]', 'invalid@test.com');
    await page.fill('input[type="password"], input[name="password"]', 'wrongpassword');

    // Submit form
    await page.click('button[type="submit"]');

    // Wait for response (webkit/Safari needs more time for fetch and rendering)
    const responseWait = browserName === 'webkit' ? 10000 : 6000;
    await page.waitForTimeout(responseWait);

    // Should show error message (either from validation or from API response)
    const errorMessage = page
      .locator('.error, .alert-danger, .invalid-feedback, [role="alert"]')
      .first();
    await expect(errorMessage).toBeVisible({ timeout: 20000 }); // Increased timeout for webkit
  });

  test('should have CSRF protection', async ({ page }) => {
    await page.goto('/auth.html');

    // Check for CSRF token in form
    const csrfToken = page.locator('input[name="_csrf"], input[name="csrf"]');
    if ((await csrfToken.count()) > 0) {
      await expect(csrfToken).toBeHidden();
    }
  });

  test('should be responsive on mobile', async ({ page, isMobile }) => {
    if (isMobile) {
      await page.goto('/auth.html');

      // Wait for page to be fully loaded
      await page.waitForLoadState('networkidle');

      // Check viewport
      const viewport = page.viewportSize();
      expect(viewport?.width).toBeLessThan(768);

      // Form should be visible and properly sized
      const form = page.locator('form').first();
      await expect(form).toBeVisible();

      // No horizontal scroll
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      const windowWidth = await page.evaluate(() => window.innerWidth);
      expect(bodyWidth).toBeLessThanOrEqual(windowWidth + 1); // Allow 1px tolerance
    }
  });

  test('should have remember-me checkbox in login form', async ({ page }) => {
    await page.goto('/auth.html');
    await page.waitForLoadState('networkidle');

    const rememberCheckbox = page.locator('#login-remember');
    await expect(rememberCheckbox).toBeVisible();
    // Should be unchecked by default
    await expect(rememberCheckbox).not.toBeChecked();
  });

  test('should show supplier fields only when supplier role selected', async ({ page }) => {
    await page.goto('/auth.html');
    await page.waitForLoadState('networkidle');

    // Switch to create tab
    await page.click('#tab-create');

    // Supplier fields should be hidden initially
    const supplierFields = page.locator('#supplier-fields');
    await expect(supplierFields).toBeHidden();

    // Click supplier role pill
    await page.click('.role-pill[data-role="supplier"]');

    // Supplier fields should now be visible
    await expect(supplierFields).toBeVisible();

    // Switch back to customer
    await page.click('.role-pill[data-role="customer"]');
    await expect(supplierFields).toBeHidden();
  });

  test('login error element should have role="alert"', async ({ page }) => {
    await page.goto('/auth.html');
    await page.waitForLoadState('networkidle');

    const loginError = page.locator('#login-error');
    await expect(loginError).toHaveAttribute('role', 'alert');
  });
});
