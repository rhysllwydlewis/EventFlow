import { test, expect } from '@playwright/test';
import {
  cleanupBackendFixtures,
  createRunId,
  loginAs,
  seedBackendFixtures,
} from './helpers/backend-fixtures.js';

/**
 * The admin packages page against the real backend: search, the real/test filter, editing a price
 * (the supplier's own dashboard shows the same price afterwards), approving, featuring, adding and
 * deleting a package.
 */

test.describe('Admin packages page @backend', () => {
  // The page glides to its form unless the device asks for less motion. That glide starves WebKit's
  // frames on a busy CI runner, so a button never holds still long enough to be clicked.
  test.use({ reducedMotion: 'reduce' });

  const runId = createRunId('admin-packages');
  let fixtures;

  test.beforeAll(async ({ request }) => {
    fixtures = await seedBackendFixtures(request, runId);
  });

  test.afterAll(async ({ request }) => {
    await cleanupBackendFixtures(request, runId);
  });

  async function openPage(page, context, baseURL) {
    await context.addCookies([
      { name: 'eventflow_cookie_consent', value: 'rejected', url: baseURL },
    ]);
    await loginAs(page, fixtures.users.admin);
    await page.goto('/admin-packages');
    await expect(page.locator('#packagesContainer table')).toBeVisible();
  }

  const rowFor = (page, title) => page.locator('#packagesContainer tbody tr', { hasText: title });

  test('lists packages and the search box narrows them', async ({ page, context, baseURL }) => {
    await openPage(page, context, baseURL);
    const mine = rowFor(page, fixtures.package.title);
    await expect(mine).toBeVisible();

    await page.locator('#searchInput').fill(fixtures.package.title);
    await expect(page.locator('#packagesContainer tbody tr')).not.toHaveCount(0);
    for (const text of await page.locator('#packagesContainer tbody tr').allInnerTexts()) {
      expect(text).toContain(fixtures.package.title);
    }

    await page.locator('#searchInput').fill('zzz-no-such-package-zzz');
    await expect(page.locator('#packagesContainer')).toContainText('No packages found');
    await page.locator('#searchInput').fill('');
    await expect(mine).toBeVisible();
  });

  test('the real and test filters change the list and say which is chosen', async ({
    page,
    context,
    baseURL,
  }) => {
    await openPage(page, context, baseURL);
    const all = await page.locator('#packagesContainer tbody tr').count();
    for (const [label, filter] of [
      ['Real Only', 'real'],
      ['Test Only', 'test'],
      ['All', 'all'],
    ]) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect(page.locator(`.filter-btn[data-filter="${filter}"]`)).toHaveAttribute(
        'aria-pressed',
        'true'
      );
    }
    await expect(page.locator('#packagesContainer tbody tr')).toHaveCount(all);
  });

  test('a price edited here is the price the supplier sees on their dashboard', async ({
    page,
    context,
    baseURL,
  }) => {
    await openPage(page, context, baseURL);
    await rowFor(page, fixtures.package.title)
      .getByRole('button', { name: 'Edit', exact: true })
      .click();
    await expect(page.locator('#packageTitle')).toHaveValue(fixtures.package.title);
    await page.locator('#packagePrice').fill('£777');
    await page.locator('#savePackageBtn').click();
    await expect(rowFor(page, fixtures.package.title)).toContainText('£777');

    // The supplier's own list holds the same price in both fields.
    const supplier = await page.context().browser().newContext({ baseURL });
    const supplierPage = await supplier.newPage();
    await loginAs(supplierPage, fixtures.users.supplier);
    const listed = await (await supplierPage.request.get('/api/me/packages')).json();
    const mine = listed.items.find(item => item.title === fixtures.package.title);
    expect([mine.price, mine.price_display]).toEqual(['£777', '£777']);
    await supplier.close();
  });

  test('approve and feature toggle and show their new state', async ({
    page,
    context,
    baseURL,
  }) => {
    await openPage(page, context, baseURL);
    const row = rowFor(page, fixtures.package.title);
    const featureButton = row.locator('[data-action="toggleFeatured"]');
    const before = (await featureButton.innerText()).trim();
    await featureButton.click();
    await expect(
      rowFor(page, fixtures.package.title).locator('[data-action="toggleFeatured"]')
    ).not.toHaveText(before);
    // And back, so the fixture is left as it was.
    await rowFor(page, fixtures.package.title).locator('[data-action="toggleFeatured"]').click();
    await expect(
      rowFor(page, fixtures.package.title).locator('[data-action="toggleFeatured"]')
    ).toHaveText(before);

    const approveButton = rowFor(page, fixtures.package.title).locator(
      '[data-action="toggleApproval"]'
    );
    const approvedLabel = (await approveButton.innerText()).trim();
    await approveButton.click();
    await expect(
      rowFor(page, fixtures.package.title).locator('[data-action="toggleApproval"]')
    ).not.toHaveText(approvedLabel);
    await rowFor(page, fixtures.package.title).locator('[data-action="toggleApproval"]').click();
    await expect(
      rowFor(page, fixtures.package.title).locator('[data-action="toggleApproval"]')
    ).toHaveText(approvedLabel);
  });

  test('a package can be added for a supplier and deleted again', async ({
    page,
    context,
    baseURL,
  }) => {
    await openPage(page, context, baseURL);
    const title = `Admin added ${runId.slice(-6)}`;
    await page.locator('#addPackageBtn').click();
    await page.locator('#packageSupplierId').selectOption(fixtures.supplier.id);
    await page.locator('#packageTitle').fill(title);
    await page.locator('#packageDescription').fill('Added by the admin packages journey.');
    await page.locator('#packagePrice').fill('From £250');
    await page.locator('#savePackageBtn').click();
    await expect(rowFor(page, title)).toContainText('From £250');

    await rowFor(page, title).getByRole('button', { name: 'Delete', exact: true }).click();
    await page
      .locator('dialog[open], .modal, [role="dialog"]')
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await expect(rowFor(page, title)).toHaveCount(0);
  });
});
