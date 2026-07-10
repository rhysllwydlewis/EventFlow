'use strict';

const { test, expect } = require('@playwright/test');

async function gotoFreshEventType(page) {
  await page.goto('/start');
  await page.evaluate(() => {
    localStorage.removeItem('eventflow_plan_builder_v1');
    localStorage.removeItem('eventflow_start');
    localStorage.removeItem('eventflow_wizard_pending');
    localStorage.removeItem('eventflow_wizard_timestamp');
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#start-scratch-btn').click();
}

test.describe('/start wizard hardening', () => {
  test('event-type selection removes both disabled states from Continue', async ({ page }) => {
    await gotoFreshEventType(page);

    const continueButton = page.locator('.wizard-next');
    await expect(continueButton).toBeDisabled();
    await expect(continueButton).toHaveAttribute('aria-disabled', 'true');

    await page.locator('.wizard-option').first().click();

    await expect(continueButton).toBeEnabled();
    expect(await continueButton.getAttribute('aria-disabled')).toBeNull();
    await continueButton.click();
    await expect(page.locator('#wz-guests')).toBeVisible();
  });

  test('decimal guest counts are rejected rather than silently rounded down', async ({ page }) => {
    await gotoFreshEventType(page);
    await page.locator('.wizard-option').first().click();
    await page.locator('.wizard-next').click();

    const guests = page.locator('#wz-guests');
    await guests.fill('10.5');
    await page.locator('.wizard-next').click();

    await expect(guests).toBeVisible();
    await expect(guests).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#wz-guests-hint')).toContainText('whole number');
  });
});
