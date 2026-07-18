/**
 * Current real-server contracts for the /start planning wizard.
 * @backend
 */

const { test, expect } = require('@playwright/test');

async function gotoFreshStart(page) {
  // Establish a same-origin document before touching localStorage.
  await page.goto('/start', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.removeItem('eventflow_plan_builder_v1');
    localStorage.removeItem('eventflow_start');
    localStorage.removeItem('eventflow_wizard_pending');
    localStorage.removeItem('eventflow_wizard_timestamp');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#wizard-container')).toBeVisible();
}

test.describe('Planning wizard current journey @backend', () => {
  test('loads the wizard and current template choices', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    await gotoFreshStart(page);

    await expect(page).toHaveTitle(/event|plan/i);
    expect(await page.locator('.wz-tpl-card').count()).toBeGreaterThanOrEqual(4);
    await expect(page.locator('#start-scratch-btn')).toBeVisible();

    const unexpected = errors.filter(
      error => !/Unauthenticated|401|websocket|pexels|AbortError/i.test(error)
    );
    expect(unexpected).toEqual([]);
  });

  test('start from scratch exposes event type choices', async ({ page }) => {
    await gotoFreshStart(page);
    await page.locator('#start-scratch-btn').click();

    const options = page.locator('.wizard-option');
    expect(await options.count()).toBeGreaterThanOrEqual(4);
    await expect(options.first()).toBeVisible();
  });

  test('selecting an event type updates accessible state and persisted state', async ({ page }) => {
    await gotoFreshStart(page);
    await page.locator('#start-scratch-btn').click();

    const option = page.locator('.wizard-option').first();
    await option.click();
    await expect(option).toHaveAttribute('aria-pressed', 'true');

    const state = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('eventflow_plan_builder_v1') || '{}')
    );
    expect(state.eventType).toBeTruthy();
  });

  test('template selection persists an event type', async ({ page }) => {
    await gotoFreshStart(page);
    const template = page.locator('.wz-tpl-card').first();
    await template.click();

    await expect
      .poll(() =>
        page.evaluate(
          () => JSON.parse(localStorage.getItem('eventflow_plan_builder_v1') || '{}').eventType
        )
      )
      .toBeTruthy();
  });

  test('resume state can be restored from a previous same-origin session', async ({ page }) => {
    await page.goto('/start', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem(
        'eventflow_plan_builder_v1',
        JSON.stringify({
          eventType: 'Wedding',
          eventName: 'Current test event',
          currentStep: 1,
          wizardStartedAt: new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
        })
      );
    });
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.locator('#wizard-container')).toBeVisible();
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('eventflow_plan_builder_v1') || '{}')
    );
    expect(stored.eventType).toBe('Wedding');
  });

  test('wizard remains usable when recommendation APIs fail', async ({ page }) => {
    await page.route('**/api/v1/packages/search*', route =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"test"}' })
    );
    await page.route('**/api/v1/venues/near*', route =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"test"}' })
    );

    await gotoFreshStart(page);
    await page.locator('#start-scratch-btn').click();
    await page.locator('.wizard-option').first().click();

    await expect(page.locator('#wizard-container')).toBeVisible();
    await expect(page.locator('.wizard-next').first()).toBeEnabled();
  });

  test('mobile layout does not overflow horizontally', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoFreshStart(page);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(395);
  });

  test('screen-reader announcement region is present', async ({ page }) => {
    await gotoFreshStart(page);

    const liveRegion = page.locator('#wizard-live-region');
    await expect(liveRegion).toBeAttached();
    await expect(liveRegion).toHaveAttribute('aria-live', 'polite');
  });
});
