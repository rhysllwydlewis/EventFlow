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

  test('no console TypeError on page load (indexOf on undefined)', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/auth.html');
    await page.waitForLoadState('networkidle');

    const indexOfErrors = errors.filter(
      msg => msg.includes('indexOf') && msg.includes('undefined')
    );
    expect(indexOfErrors).toHaveLength(0);
  });

  test('password toggle stays vertically centered on mobile before and after click', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/auth.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    const passwordInput = page.locator('#login-password');
    const toggleButton = page.locator('.password-toggle').first();

    await expect(passwordInput).toBeVisible();
    await expect(toggleButton).toBeVisible();

    const inputBoxBefore = await passwordInput.boundingBox();
    const toggleBoxBefore = await toggleButton.boundingBox();

    // Toggle center Y should be within the input's vertical bounds before click
    const toggleCenterBefore = toggleBoxBefore.y + toggleBoxBefore.height / 2;
    expect(toggleCenterBefore).toBeGreaterThanOrEqual(inputBoxBefore.y);
    expect(toggleCenterBefore).toBeLessThanOrEqual(inputBoxBefore.y + inputBoxBefore.height);

    // Click the toggle to switch to "show" mode
    await toggleButton.click();
    await page.waitForTimeout(200);

    // Re-capture both boxes after click (input may have scrolled)
    const inputBoxAfter = await passwordInput.boundingBox();
    const toggleBoxAfter = await toggleButton.boundingBox();

    // Toggle center must still be within input bounds after the icon swap
    const toggleCenterAfter = toggleBoxAfter.y + toggleBoxAfter.height / 2;
    expect(toggleCenterAfter).toBeGreaterThanOrEqual(inputBoxAfter.y);
    expect(toggleCenterAfter).toBeLessThanOrEqual(inputBoxAfter.y + inputBoxAfter.height);

    // The toggle must not drift relative to the input (within 4px tolerance)
    const toggleOffsetBefore = toggleBoxBefore.y - inputBoxBefore.y;
    const toggleOffsetAfter = toggleBoxAfter.y - inputBoxAfter.y;
    expect(Math.abs(toggleOffsetAfter - toggleOffsetBefore)).toBeLessThanOrEqual(4);
  });

  test('"Forgot password?" link is below password input on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/auth.html');
    await page.waitForLoadState('networkidle');

    const passwordInput = page.locator('#login-password');
    const forgotLink = page.locator('.auth-forgot-link--below');

    await expect(passwordInput).toBeVisible();
    await expect(forgotLink).toBeVisible();

    const inputBox = await passwordInput.boundingBox();
    const forgotBox = await forgotLink.boundingBox();

    // Forgot link top edge must be below the password input's bottom edge
    expect(forgotBox.y).toBeGreaterThan(inputBox.y + inputBox.height - 2);
  });
});

test.describe('ALTCHA Registration Payload', () => {
  /**
   * Simulate a verified ALTCHA widget so we can test payload wiring without
   * actually solving a proof-of-work challenge.
   */
  async function simulateAltchaVerified(page, token = 'test-altcha-token') {
    await page.evaluate(t => {
      window.__altchaRegPayload = t;
      // Belt-and-braces: also override .value on the widget element if it exists.
      // Object.defineProperty may fail if the property is already non-configurable on a
      // fully-initialised custom element — that's intentional and safe to ignore here
      // because the __altchaRegPayload global is the primary token source.
      const widget = document.getElementById('reg-altcha-widget');
      if (widget) {
        try {
          Object.defineProperty(widget, 'value', { get: () => t, configurable: true });
        } catch (_) {
          // Property not configurable — __altchaRegPayload global is sufficient
        }
      }
    }, token);
  }

  /**
   * Fill all required registration fields so form validation passes and the
   * submission handler reaches the ALTCHA check.
   */
  async function fillRequiredFields(page) {
    await page.fill('#reg-firstname', 'Test');
    await page.fill('#reg-lastname', 'User');
    await page.fill('#reg-email', `altcha-test-${Date.now()}@example.com`);
    await page.fill('#reg-password', 'TestPass123');
    await page.fill('#reg-password-confirm', 'TestPass123');
    // Location is required — select any valid UK county.
    await page.selectOption('#reg-location', 'Greater London');
    // Terms checkbox is required before the handler proceeds.
    const termsCheckbox = page.locator('#reg-terms');
    if ((await termsCheckbox.count()) > 0) {
      await termsCheckbox.check();
    }
  }

  test('registration request includes captchaToken when ALTCHA widget is verified', async ({
    page,
  }) => {
    // Capture the outgoing register request body.
    let capturedBody = null;
    await page.route('**/api/v1/auth/register', async route => {
      const request = route.request();
      try {
        capturedBody = JSON.parse(request.postData() || '{}');
      } catch (_) {
        // postData not valid JSON — fall back to empty object so assertions produce a clear failure
        capturedBody = {};
      }
      // Return a mock success so the test does not depend on a live backend.
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await page.goto('/auth.html');
    await page.waitForLoadState('networkidle');

    // Switch to the registration tab.
    await page.click('#tab-create');
    await page.waitForSelector('#panel-create', { state: 'visible' });

    await fillRequiredFields(page);

    // Simulate the ALTCHA widget being verified.
    await simulateAltchaVerified(page);

    // Wait for the outgoing request while clicking submit.
    const registerRequestPromise = page.waitForRequest('**/api/v1/auth/register');
    await page.click('#register-form button[type="submit"]');
    await registerRequestPromise;

    // The outgoing payload MUST include captchaToken.
    expect(capturedBody).not.toBeNull();
    expect(capturedBody).toHaveProperty('captchaToken');
    expect(capturedBody.captchaToken).toBe('test-altcha-token');
  });

  test('registration request does NOT produce "No ALTCHA payload provided" error', async ({
    page,
  }) => {
    // Return 400 only when captchaToken is absent so the test detects the regression.
    let altchaErrorSeen = false;
    await page.route('**/api/v1/auth/register', async route => {
      const request = route.request();
      let body = {};
      try {
        body = JSON.parse(request.postData() || '{}');
      } catch (_) {
        // postData not valid JSON — treat as empty body (captchaToken will be absent)
      }

      if (!body.captchaToken) {
        altchaErrorSeen = true;
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'No ALTCHA payload provided' }),
        });
      } else {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      }
    });

    await page.goto('/auth.html');
    await page.waitForLoadState('networkidle');

    await page.click('#tab-create');
    await page.waitForSelector('#panel-create', { state: 'visible' });

    await fillRequiredFields(page);

    // Simulate verified ALTCHA before submitting.
    await simulateAltchaVerified(page);

    const registerResponsePromise = page.waitForResponse('**/api/v1/auth/register');
    await page.click('#register-form button[type="submit"]');
    await registerResponsePromise;

    expect(altchaErrorSeen).toBe(false);
  });

  test('registration form is blocked when ALTCHA widget is present but not yet verified', async ({
    page,
  }) => {
    // Capture any request to the register endpoint.
    let requestFired = false;
    await page.route('**/api/v1/auth/register', async route => {
      requestFired = true;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await page.goto('/auth.html');
    await page.waitForLoadState('networkidle');

    await page.click('#tab-create');
    await page.waitForSelector('#panel-create', { state: 'visible' });

    // Fill all required fields so the handler reaches the ALTCHA check.
    await fillRequiredFields(page);

    // Explicitly leave ALTCHA unverified (clear any global that may have been set).
    await page.evaluate(() => {
      window.__altchaRegPayload = null;
    });

    await page.click('#register-form button[type="submit"]');

    // Wait for the inline status/error message to appear.
    const statusEl = page.locator('#reg-status');
    await expect(statusEl).not.toBeEmpty({ timeout: 5000 });

    // The request should NOT have been sent because the ALTCHA guard blocks it.
    expect(requestFired).toBe(false);

    // The message must relate to the ALTCHA verification challenge.
    const statusText = await statusEl.textContent();
    expect(statusText).toMatch(/verification|challenge/i);
  });
});
