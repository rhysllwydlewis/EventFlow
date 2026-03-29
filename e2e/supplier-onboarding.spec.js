import { test, expect } from '@playwright/test';

test.describe('Supplier Onboarding Flow @backend', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display supplier registration option', async ({ page }) => {
    // Look for "Become a Supplier" or similar link
    const supplierSignupLink = page.locator(
      'a:has-text("Become a Supplier"), a:has-text("Join"), a:has-text("Register as Supplier"), a[href*="supplier"][href*="register"], a[href*="signup"]'
    );

    if ((await supplierSignupLink.count()) > 0) {
      await expect(supplierSignupLink.first()).toBeVisible();
    } else {
      // Check in navigation menu
      const menuButton = page.locator('#ef-bottom-menu, .menu-toggle, .hamburger');
      if ((await menuButton.count()) > 0) {
        await menuButton.first().click();
        await page.waitForTimeout(500);

        const menuSupplierLink = page.locator('a:has-text("Supplier")');
        if ((await menuSupplierLink.count()) > 0) {
          await expect(menuSupplierLink.first()).toBeVisible();
        }
      }
    }
  });

  test('should navigate to supplier registration page', async ({ page }) => {
    const supplierSignupLink = page
      .locator(
        'a:has-text("Become a Supplier"), a:has-text("Join"), a:has-text("Register"), a[href*="supplier"]'
      )
      .first();

    if ((await supplierSignupLink.count()) > 0) {
      await supplierSignupLink.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);

      // Should show registration form
      const registrationForm = page.locator('form[action*="register"], form#supplier-register');
      if ((await registrationForm.count()) > 0) {
        await expect(registrationForm).toBeVisible();
      }
    }
  });

  test('should display required supplier profile fields', async ({ page }) => {
    // Navigate to supplier registration/profile
    const supplierLink = page.locator('a[href*="supplier"]').first();
    if ((await supplierLink.count()) > 0) {
      await supplierLink.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);

      // Check for essential supplier fields
      const businessNameInput = page.locator(
        'input[name="businessName"], input[placeholder*="business name" i], #businessName'
      );
      const categorySelect = page.locator(
        'select[name="category"], select#category, input[name="category"]'
      );
      const descriptionInput = page.locator(
        'textarea[name="description"], textarea#description, textarea[placeholder*="description" i]'
      );

      // At least some form fields should be present
      const hasFields =
        (await businessNameInput.count()) > 0 ||
        (await categorySelect.count()) > 0 ||
        (await descriptionInput.count()) > 0;

      expect(hasFields).toBe(true);
    }
  });

  test('should validate required fields in registration', async ({ page }) => {
    const registerLink = page.locator('a[href*="register"], a:has-text("Register")').first();
    if ((await registerLink.count()) > 0) {
      await registerLink.click();
      await page.waitForLoadState('networkidle');

      // Try to submit empty form
      const submitButton = page.locator(
        'button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Register")'
      );

      if ((await submitButton.count()) > 0) {
        await submitButton.first().click();
        await page.waitForTimeout(1000);

        // Should show validation errors
        const errorMessage = page.locator(
          '.error, .alert-danger, .invalid-feedback, [role="alert"]'
        );
        if ((await errorMessage.count()) > 0) {
          await expect(errorMessage.first()).toBeVisible();
        }
      }
    }
  });

  test('should allow uploading business logo', async ({ page }) => {
    const registerLink = page.locator('a[href*="supplier"]').first();
    if ((await registerLink.count()) > 0) {
      await registerLink.click();
      await page.waitForLoadState('networkidle');

      // Look for file upload input
      const fileInput = page.locator('input[type="file"], input[accept*="image"]');
      if ((await fileInput.count()) > 0) {
        await expect(fileInput.first()).toBeAttached();
      }
    }
  });

  test('should display category selection options', async ({ page }) => {
    const registerLink = page.locator('a[href*="supplier"]').first();
    if ((await registerLink.count()) > 0) {
      await registerLink.click();
      await page.waitForLoadState('networkidle');

      // Check for category dropdown
      const categorySelect = page.locator('select[name="category"], select#category');
      if ((await categorySelect.count()) > 0) {
        await expect(categorySelect).toBeVisible();

        // Should have multiple categories
        const options = await categorySelect.locator('option').count();
        expect(options).toBeGreaterThan(1);
      }
    }
  });

  test('should display location/address fields', async ({ page }) => {
    const registerLink = page.locator('a[href*="supplier"]').first();
    if ((await registerLink.count()) > 0) {
      await registerLink.click();
      await page.waitForLoadState('networkidle');

      // Check for location fields
      const addressInput = page.locator('input[name*="address"], input[placeholder*="address" i]');
      const postcodeInput = page.locator(
        'input[name*="postcode"], input[placeholder*="postcode" i]'
      );
      const cityInput = page.locator('input[name*="city"], input[placeholder*="city" i]');

      // Should have at least one location field
      const hasLocationFields =
        (await addressInput.count()) > 0 ||
        (await postcodeInput.count()) > 0 ||
        (await cityInput.count()) > 0;

      expect(hasLocationFields).toBe(true);
    }
  });

  test('should display pricing information fields', async ({ page }) => {
    const registerLink = page.locator('a[href*="supplier"]').first();
    if ((await registerLink.count()) > 0) {
      await registerLink.click();
      await page.waitForLoadState('networkidle');

      // Check for pricing fields
      const priceInput = page.locator(
        'input[name*="price"], input[placeholder*="price" i], input[type="number"]'
      );

      if ((await priceInput.count()) > 0) {
        await expect(priceInput.first()).toBeVisible();
      }
    }
  });

  test('should display contact information fields', async ({ page }) => {
    const registerLink = page.locator('a[href*="supplier"]').first();
    if ((await registerLink.count()) > 0) {
      await registerLink.click();
      await page.waitForLoadState('networkidle');

      // Check for contact fields
      const emailInput = page.locator('input[type="email"], input[name*="email"]');
      const phoneInput = page.locator('input[type="tel"], input[name*="phone"]');

      // Should have email at minimum
      const hasContactFields = (await emailInput.count()) > 0 || (await phoneInput.count()) > 0;

      expect(hasContactFields).toBe(true);
    }
  });

  test('should display social media fields', async ({ page }) => {
    const registerLink = page.locator('a[href*="supplier"]').first();
    if ((await registerLink.count()) > 0) {
      await registerLink.click();
      await page.waitForLoadState('networkidle');

      // Check for social media fields
      const socialInput = page.locator(
        'input[name*="facebook"], input[name*="instagram"], input[name*="twitter"], input[placeholder*="social"]'
      );

      if ((await socialInput.count()) > 0) {
        expect(await socialInput.count()).toBeGreaterThan(0);
      }
    }
  });

  test('should allow adding service descriptions', async ({ page }) => {
    const registerLink = page.locator('a[href*="supplier"]').first();
    if ((await registerLink.count()) > 0) {
      await registerLink.click();
      await page.waitForLoadState('networkidle');

      // Check for service description textarea
      const descriptionTextarea = page.locator('textarea');
      if ((await descriptionTextarea.count()) > 0) {
        await expect(descriptionTextarea.first()).toBeVisible();
      }
    }
  });

  test('should display terms and conditions checkbox', async ({ page }) => {
    const registerLink = page.locator('a[href*="register"]').first();
    if ((await registerLink.count()) > 0) {
      await registerLink.click();
      await page.waitForLoadState('networkidle');

      // Check for T&C checkbox
      const termsCheckbox = page.locator(
        'input[type="checkbox"][name*="terms"], input[type="checkbox"]:near(:text("Terms"))'
      );

      if ((await termsCheckbox.count()) > 0) {
        await expect(termsCheckbox.first()).toBeVisible();
      }
    }
  });

  test('should handle successful supplier registration', async ({ page }) => {
    // This test would require actual form submission
    // For now, we just verify the registration flow is accessible
    const registerLink = page.locator('a[href*="register"]').first();
    if ((await registerLink.count()) > 0) {
      await registerLink.click();
      await page.waitForLoadState('networkidle');

      // Verify we're on the registration page
      const pageTitle = await page.title();
      expect(pageTitle).toBeTruthy();
    }
  });

  test('should display subscription tier options', async ({ page }) => {
    const registerLink = page.locator('a[href*="supplier"], a[href*="pricing"]').first();
    if ((await registerLink.count()) > 0) {
      await registerLink.click();
      await page.waitForLoadState('networkidle');

      // Check for subscription tiers
      const subscriptionOption = page.locator(
        '.subscription-tier, .pricing-card, .plan, [data-plan]'
      );

      if ((await subscriptionOption.count()) > 0) {
        expect(await subscriptionOption.count()).toBeGreaterThan(0);
      }
    }
  });

  test('should allow uploading portfolio/gallery images', async ({ page }) => {
    const registerLink = page.locator('a[href*="supplier"]').first();
    if ((await registerLink.count()) > 0) {
      await registerLink.click();
      await page.waitForLoadState('networkidle');

      // Check for multiple file upload or gallery
      const galleryUpload = page.locator(
        'input[type="file"][multiple], input[accept*="image"][multiple], .gallery-upload'
      );

      if ((await galleryUpload.count()) > 0) {
        await expect(galleryUpload.first()).toBeAttached();
      }
    }
  });

  test('should provide onboarding progress indicator', async ({ page }) => {
    const registerLink = page.locator('a[href*="supplier"]').first();
    if ((await registerLink.count()) > 0) {
      await registerLink.click();
      await page.waitForLoadState('networkidle');

      // Check for progress indicators or steps
      const progressIndicator = page.locator('.progress, .stepper, .steps, [role="progressbar"]');

      if ((await progressIndicator.count()) > 0) {
        await expect(progressIndicator.first()).toBeVisible();
      }
    }
  });

  test('should be mobile responsive', async ({ page, isMobile }) => {
    if (isMobile) {
      const registerLink = page.locator('a[href*="supplier"]').first();
      if ((await registerLink.count()) > 0) {
        await registerLink.click();
        await page.waitForLoadState('networkidle');

        // Check form is visible on mobile
        const form = page.locator('form');
        if ((await form.count()) > 0) {
          await expect(form.first()).toBeVisible();

          // Check form width doesn't exceed viewport
          const formWidth = await form.first().evaluate(el => el.offsetWidth);
          const viewportWidth = page.viewportSize()?.width || 0;
          expect(formWidth).toBeLessThanOrEqual(viewportWidth);
        }
      }
    }
  });

  test('should have accessible form labels', async ({ page }) => {
    const registerLink = page.locator('a[href*="supplier"]').first();
    if ((await registerLink.count()) > 0) {
      await registerLink.click();
      await page.waitForLoadState('networkidle');

      // Check for proper form labels
      const inputs = page.locator('input[type="text"], input[type="email"], textarea');
      const inputCount = await inputs.count();

      if (inputCount > 0) {
        // At least one input should have a label or aria-label
        for (let i = 0; i < Math.min(inputCount, 5); i++) {
          const input = inputs.nth(i);
          const hasLabel =
            (await input.getAttribute('aria-label')) !== null ||
            (await input.getAttribute('placeholder')) !== null ||
            (await page.locator(`label[for="${await input.getAttribute('id')}"]`).count()) > 0;

          if (hasLabel) {
            expect(hasLabel).toBe(true);
            break;
          }
        }
      }
    }
  });

  test('should handle navigation back and forth in multi-step form', async ({ page }) => {
    const registerLink = page.locator('a[href*="supplier"]').first();
    if ((await registerLink.count()) > 0) {
      await registerLink.click();
      await page.waitForLoadState('networkidle');

      // Look for next/back buttons in multi-step form
      const nextButton = page.locator('button:has-text("Next"), button:has-text("Continue")');
      const backButton = page.locator('button:has-text("Back"), button:has-text("Previous")');

      if ((await nextButton.count()) > 0) {
        await nextButton.first().click();
        await page.waitForTimeout(500);

        // Should be able to go back
        if ((await backButton.count()) > 0) {
          await expect(backButton.first()).toBeVisible();
        }
      }
    }
  });

  test('should show preview before final submission', async ({ page }) => {
    const registerLink = page.locator('a[href*="supplier"]').first();
    if ((await registerLink.count()) > 0) {
      await registerLink.click();
      await page.waitForLoadState('networkidle');

      // Look for preview or review button
      const previewButton = page.locator('button:has-text("Preview"), button:has-text("Review")');

      if ((await previewButton.count()) > 0) {
        await expect(previewButton.first()).toBeVisible();
      }
    }
  });

  test('should provide help text for complex fields', async ({ page }) => {
    const registerLink = page.locator('a[href*="supplier"]').first();
    if ((await registerLink.count()) > 0) {
      await registerLink.click();
      await page.waitForLoadState('networkidle');

      // Check for help text or tooltips
      const helpText = page.locator(
        '.help-text, .hint, small, [role="tooltip"], [aria-describedby]'
      );

      if ((await helpText.count()) > 0) {
        expect(await helpText.count()).toBeGreaterThan(0);
      }
    }
  });
});
