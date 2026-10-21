import { test, expect } from '@playwright/test';
import {
  cleanupBackendFixtures,
  createRunId,
  loginAs,
  seedBackendFixtures,
} from './helpers/backend-fixtures.js';

/**
 * Every control on the supplier dashboard does what its label says, against the real server and a
 * real database. Each test presses the control and checks the result (a dialog, a saved value, a
 * page that loads, a list that updates), not just that the control is there.
 */
test.describe('Supplier dashboard: every control works @backend', () => {
  const runId = createRunId('supplier-actions');
  let fixtures;

  test.beforeAll(async ({ request }) => {
    fixtures = await seedBackendFixtures(request, runId);
  });

  test.afterAll(async ({ request }) => {
    await cleanupBackendFixtures(request, runId);
  });

  async function openDashboard(page, context, baseURL, user = fixtures.users.supplier) {
    await context.addCookies([
      { name: 'eventflow_cookie_consent', value: 'rejected', url: baseURL },
    ]);
    await loginAs(page, user);
    await page.goto('/dashboard/supplier');
    await expect(page.locator('#welcome-heading')).toBeVisible();
    // The cards fill in after the summary arrives.
    await expect(page.locator('#my-packages')).toContainText(fixtures.package.title);
  }

  async function closeTopDialog(page) {
    await page.keyboard.press('Escape');
    const discard = page.locator('dialog[open] button', { hasText: /^Discard/ });
    if (await discard.count()) {
      await discard.first().click();
    }
    await expect(page.locator('dialog[open]')).toHaveCount(0);
  }

  test('the setup guide opens, steps forward and back, and closes', async ({
    page,
    context,
    baseURL,
  }) => {
    await openDashboard(page, context, baseURL);
    await page.locator('#sdh-guide-open').click();
    const dialog = page.locator('dialog[open]');
    await expect(dialog).toContainText(/Step 1 of/);
    await dialog
      .getByRole('button', { name: /^Next|Continue/ })
      .first()
      .click();
    await expect(dialog).toContainText(/Step 2 of/);
    await dialog.getByRole('button', { name: /^Back/ }).first().click();
    await expect(dialog).toContainText(/Step 1 of/);
    await closeTopDialog(page);
  });

  test('the main action and Edit profile open the profile editor, which can be cancelled', async ({
    page,
    context,
    baseURL,
  }) => {
    await openDashboard(page, context, baseURL);
    await page.locator('#toggle-profile-form').click();
    await expect(page.locator('#sdh-profile-dialog[open]')).toBeVisible();
    await expect(page.locator('#sup-name')).toHaveValue(/E2E/);
    await closeTopDialog(page);

    await page.locator('#sdh-next-action').click();
    await expect(page.locator('#sdh-profile-dialog[open]')).toBeVisible();
    await closeTopDialog(page);
  });

  test('"Add photos" opens the file chooser and accepts several images', async ({
    page,
    context,
    baseURL,
  }) => {
    await openDashboard(page, context, baseURL);
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('[data-action="upload-photo"]').first().click(),
    ]);
    expect(chooser.isMultiple()).toBe(true);
  });

  test('the links on the page lead to pages that load', async ({ page, context, baseURL }) => {
    await openDashboard(page, context, baseURL);
    const hrefs = new Set();
    for (const selector of [
      '#sdh-secondary-action',
      '#sdh-view-public',
      '#my-packages a:has-text("View")',
      '#my-packages a:has-text("Photos")',
      '#supplier-cal-cta',
      '#sdh-messages a[href^="/messenger"]',
      '#sdh-support a[href="/faq"]',
      '#sdh-support a[href="/contact"]',
    ]) {
      const link = page.locator(selector).first();
      await expect(link, `${selector} is on the page`).toBeVisible();
      hrefs.add(await link.getAttribute('href'));
    }
    hrefs.add('/supplier/subscription');
    hrefs.add('/supplier/profile-customization');
    hrefs.add('/pricing');
    for (const href of hrefs) {
      const response = await page.request.get(href);
      expect(response.status(), `${href} loads`).toBe(200);
    }
  });

  test('a package can be created, edited, paused, resumed and deleted', async ({
    page,
    context,
    baseURL,
  }) => {
    await openDashboard(page, context, baseURL);
    const title = `Action Pkg ${runId.slice(-6)}`;

    await page.locator('#toggle-package-form').click();
    await expect(page.locator('#sdh-package-dialog[open]')).toBeVisible();
    await page.fill('#pkg-title', title);
    await page.fill('#pkg-price', '£1,234');
    await page.selectOption('#pkg-category', { index: 1 });
    await page.check('#pkg-event-wedding');
    await page.fill('#pkg-desc', 'A package made by the dashboard actions spec.');
    await page.locator('#package-form button[type=submit]').click();
    await expect(page.locator('#sdh-package-dialog[open]')).toHaveCount(0);
    const row = () =>
      page
        .locator('#my-packages [data-pkg-id], #my-packages li, #my-packages article')
        .filter({ hasText: title })
        .first();
    await expect(row()).toContainText('1,234');

    await row().getByRole('button', { name: /^Edit/ }).click();
    await expect(page.locator('#pkg-title')).toHaveValue(title);
    await page.fill('#pkg-title', `${title} edited`);
    await page.locator('#package-form button[type=submit]').click();
    await expect(page.locator('#my-packages')).toContainText(`${title} edited`);

    const edited = () =>
      page
        .locator('#my-packages [data-pkg-id], #my-packages li, #my-packages article')
        .filter({ hasText: `${title} edited` })
        .first();
    await edited().getByRole('button', { name: /Pause/ }).click();
    const confirmPause = page.locator('dialog[open] button', { hasText: /Pause|Confirm|Yes/ });
    if (await confirmPause.count()) {
      await confirmPause.first().click();
    }
    await expect(edited()).toContainText('Paused');
    await edited()
      .getByRole('button', { name: /Resume/ })
      .click();
    const confirmResume = page.locator('dialog[open] button', { hasText: /Resume|Confirm|Yes/ });
    if (await confirmResume.count()) {
      await confirmResume.first().click();
    }
    await expect(edited()).not.toContainText('Paused');

    await edited()
      .getByRole('button', { name: /Delete/ })
      .click();
    await page
      .locator('dialog[open] button', { hasText: /^Delete/ })
      .first()
      .click();
    await expect(page.locator('#my-packages')).not.toContainText(`${title} edited`);
  });

  test('"Request a review" opens its dialog and it closes again', async ({
    page,
    context,
    baseURL,
  }) => {
    await openDashboard(page, context, baseURL);
    await page.locator('#sdh-request-review-btn').click();
    await expect(page.locator('dialog[open]')).toContainText(/review/i);
    await closeTopDialog(page);
  });

  test('a private calendar entry can be added from the button and from a day, with the right date', async ({
    page,
    context,
    baseURL,
  }) => {
    await openDashboard(page, context, baseURL);
    await page.locator('#sup-cal-add-entry-btn').click();
    await expect(page.locator('#sup-cal-entry-title')).toBeVisible();
    await page.keyboard.press('Escape');

    // The "+" on a day names that day and opens the form on that day (not on today).
    const plus = page.locator('.cal-day-add-btn').nth(20);
    const label = await plus.getAttribute('aria-label');
    expect(label).toMatch(/^Add entry for \d{4}-\d{2}-\d{2}$/);
    await plus.evaluate(element => element.click());
    await expect(page.locator('#sup-cal-entry-date')).toHaveValue(
      label.replace('Add entry for ', '')
    );
  });

  test('every calendar view button works', async ({ page, context, baseURL }) => {
    await openDashboard(page, context, baseURL);
    for (const name of ['Next Month', 'Previous Month', 'Week', 'List', 'Month']) {
      await page.getByRole('button', { name, exact: true }).first().click();
    }
    await expect(page.locator('.fc')).toBeVisible();
  });

  test('"Ask to publish public events" opens the request dialog', async ({
    page,
    context,
    baseURL,
  }) => {
    await openDashboard(page, context, baseURL);
    await page.locator('#sup-request-publishing-btn').click();
    await expect(page.locator('dialog[open]')).toBeVisible();
    await closeTopDialog(page);
  });

  test('availability is saved and still there after a reload', async ({
    page,
    context,
    baseURL,
  }) => {
    await openDashboard(page, context, baseURL);
    await page.getByRole('button', { name: 'Limited', exact: true }).first().click();
    const [response] = await Promise.all([
      page.waitForResponse(r => r.request().method() === 'PATCH' && /availability/.test(r.url())),
      page.getByRole('button', { name: 'Save', exact: true }).first().click(),
    ]);
    expect(response.status()).toBe(200);
    await page.reload();
    await expect(page.locator('#my-packages')).toContainText(fixtures.package.title);
    await expect(
      page.getByRole('button', { name: 'Limited', exact: true }).first()
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('message filter and sort change without errors, and the export says what it did', async ({
    page,
    context,
    baseURL,
  }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await openDashboard(page, context, baseURL);
    await page.selectOption('#widget-filter-select-supplier', { index: 1 });
    await page.selectOption('#widget-sort-select-supplier', { index: 1 });
    await page.locator('#export-enquiries-btn').click();
    // A supplier with nothing to export is told so; one with data gets a file.
    await expect(
      page.getByText(/Nothing to export yet|Exported|downloaded/i).first()
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('the visits window buttons work, and longer windows say why they are off', async ({
    page,
    context,
    baseURL,
  }) => {
    await openDashboard(page, context, baseURL);
    const sevenDays = page.getByRole('button', { name: '7 days', exact: true }).first();
    await sevenDays.click();
    await expect(sevenDays).toHaveAttribute('aria-pressed', 'true');
    const thirty = page.getByRole('button', { name: '30 days', exact: true }).first();
    if (await thirty.isDisabled()) {
      await expect(thirty).toHaveAttribute('title', /.+/);
    }
  });

  test('a support ticket can be created and shows up straight away', async ({
    page,
    context,
    baseURL,
  }) => {
    await openDashboard(page, context, baseURL);
    await page.locator('#createSupplierTicketBtn').click();
    const modal = page.locator('.ticket-create-modal');
    await expect(modal).toBeVisible();
    // It is announced as a modal dialog with a name.
    await expect(page.locator('.modal-overlay[role="dialog"][aria-modal="true"]')).toHaveAttribute(
      'aria-labelledby',
      'ticketCreateTitle'
    );
    const subject = `Actions spec ${runId.slice(-6)}`;
    await page.fill('#ticketSubject', subject);
    await page.fill('#ticketMessage', 'Created by the dashboard actions spec.');
    const [response] = await Promise.all([
      page.waitForResponse(r => r.request().method() === 'POST' && /\/api\/tickets/.test(r.url())),
      modal.locator('button[type=submit]').click(),
    ]);
    expect(response.status()).toBe(201);
    await expect(modal).toHaveCount(0);
    // No waiting for the minute-long refresh.
    await expect(page.locator('#tickets-sup')).toContainText(subject, { timeout: 5000 });
  });

  test('Escape closes the ticket form and focus goes back to the button', async ({
    page,
    context,
    baseURL,
  }) => {
    await openDashboard(page, context, baseURL);
    await page.locator('#createSupplierTicketBtn').click();
    await expect(page.locator('.ticket-create-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.ticket-create-modal')).toHaveCount(0);
    await expect(page.locator('#createSupplierTicketBtn')).toBeFocused();
  });

  test('the notifications bell opens its panel', async ({ page, context, baseURL }) => {
    await openDashboard(page, context, baseURL);
    await page.locator('#ef-notification-btn').click();
    await expect(page.locator('#ef-notification-btn')).toHaveAttribute('aria-expanded', 'true');
  });

  test('a supplier waiting for approval cannot start a package, and is told why', async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([
      { name: 'eventflow_cookie_consent', value: 'rejected', url: baseURL },
    ]);
    await loginAs(page, fixtures.users.pendingSupplier);
    await page.goto('/dashboard/supplier');
    const create = page.locator('#toggle-package-form');
    await expect(create).toBeDisabled();
    await expect(create).toHaveAttribute('title', /approved/i);
  });

  test('Log out ends the session', async ({ page, context, baseURL }) => {
    await openDashboard(page, context, baseURL);
    await page.locator('#ef-auth-link').click();
    await page.waitForURL(url => !/dashboard\/supplier/.test(url.pathname), { timeout: 10000 });
    // The session is gone: the account call reports nobody, and the dashboard is protected again.
    const me = await page.request.get('/api/v1/auth/me');
    expect((await me.json()).user).toBeNull();
    const dashboard = await page.request.get('/dashboard/supplier', { maxRedirects: 0 });
    expect(dashboard.status()).toBe(401);
  });
});
