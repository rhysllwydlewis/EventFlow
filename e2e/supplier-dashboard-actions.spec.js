import { test, expect, request as playwrightRequest } from '@playwright/test';
import {
  cleanupBackendFixtures,
  createRunId,
  loginAs,
  seedBackendFixtures,
} from './helpers/backend-fixtures.js';

import zlib from 'node:zlib';

// A real, solid-colour PNG of the given size (the server checks image dimensions).
function solidPng(size, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return c >>> 0;
  });
  const crc = buf => {
    let c = 0xffffffff;
    for (const byte of buf) {
      c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(size).fill([r, g, b]).flat())]);
  const raw = Buffer.concat(Array(size).fill(row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

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

  /** Reloads the dashboard and waits until it is ready to be used again. */
  async function reloadDashboard(page) {
    await page.reload();
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
      .getByRole('button', { name: /^(Next|Continue)/ })
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

  test('every profile field is saved and is still there after a reload', async ({
    page,
    context,
    baseURL,
  }) => {
    await openDashboard(page, context, baseURL);
    await page.locator('#toggle-profile-form').click();
    await expect(page.locator('#sdh-profile-dialog[open]')).toBeVisible();

    const values = {
      '#sup-name': `Actions Spec Events ${runId.slice(-5)}`,
      '#sup-location': 'Swansea',
      '#sup-short': 'Short line written by the actions spec.',
      '#sup-long': 'A longer description written by the actions spec so it can be read back.',
      '#sup-website': 'https://example.com/actions-spec',
      '#sup-license': 'PLI 5m',
      '#sup-max': '120',
      '#sup-amenities': 'Parking, Garden',
    };
    for (const [selector, value] of Object.entries(values)) {
      await page.fill(selector, value);
    }
    const saved = page.waitForResponse(
      r => ['POST', 'PUT', 'PATCH'].includes(r.request().method()) && /suppliers/.test(r.url())
    );
    await page.locator('#sup-create').click();
    expect((await saved).status()).toBeLessThan(300);

    await reloadDashboard(page);
    await page.locator('#toggle-profile-form').click();
    await expect(page.locator('#sdh-profile-dialog[open]')).toBeVisible();
    for (const [selector, value] of Object.entries(values)) {
      await expect(page.locator(selector), `${selector} was kept`).toHaveValue(value);
    }
    await closeTopDialog(page);
  });

  test('a photo can be added, is kept, and can be removed', async ({ page, context, baseURL }) => {
    await openDashboard(page, context, baseURL);
    const png = solidPng(64, [200, 60, 90]);
    const tiles = page.locator('#sup-photo-preview .photo-preview-item');
    const kept = page.locator('#sup-photo-preview .photo-preview-item--existing');
    const openEditor = async () => {
      await page.locator('#toggle-profile-form').click();
      await expect(page.locator('#sdh-profile-dialog[open]')).toBeVisible();
    };
    await openEditor();
    const before = await kept.count();

    // A supplier who already has a profile uploads straight away: the photo is saved once and no
    // "Pending" tile is left beside it.
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('#sup-photo-drop').click(),
    ]);
    await chooser.setFiles({
      name: `spec-${runId.slice(-5)}.png`,
      mimeType: 'image/png',
      buffer: png,
    });
    await expect(kept).toHaveCount(before + 1);
    await expect(tiles).toHaveCount(before + 1);

    // It is still there after a reload.
    await reloadDashboard(page);
    await openEditor();
    await expect(kept).toHaveCount(before + 1);
    // ... and it shows its image (the saved list used to lose the address of each photo).
    await expect
      .poll(() =>
        kept
          .last()
          .locator('img')
          .evaluate(img => img.complete && img.naturalWidth > 0)
      )
      .toBe(true);

    // Removing it asks first, then it is gone for good.
    await kept.last().locator('.photo-delete-btn').click();
    await page.locator('dialog[open] button', { hasText: /^Remove photo/ }).click();
    await expect(kept).toHaveCount(before);
    await reloadDashboard(page);
    await openEditor();
    await expect(kept).toHaveCount(before);
    await closeTopDialog(page);
  });

  /** The profile editor's photo area, with a way to add files and to take every saved one away. */
  async function openPhotoEditor(page, context, baseURL) {
    await openDashboard(page, context, baseURL);
    await page.locator('#toggle-profile-form').click();
    await expect(page.locator('#sdh-profile-dialog[open]')).toBeVisible();
    const kept = page.locator('#sup-photo-preview .photo-preview-item--existing');
    const file = (name, colour) => ({
      name: `${name}-${runId.slice(-5)}.png`,
      mimeType: 'image/png',
      buffer: solidPng(64, colour),
    });
    const removeKept = async () => {
      while ((await kept.count()) > 0) {
        const left = await kept.count();
        await kept.first().locator('.photo-delete-btn').click();
        await page.locator('dialog[open] button', { hasText: /^Remove photo/ }).click();
        await expect(kept).toHaveCount(left - 1);
      }
    };
    return { kept, file, removeKept };
  }

  test('several photos chosen together are each saved once', async ({ page, context, baseURL }) => {
    const { kept, file, removeKept } = await openPhotoEditor(page, context, baseURL);
    await removeKept();
    const uploads = [];
    page.on('request', r => {
      if (r.method() === 'POST' && /\/photos$/.test(r.url())) {
        uploads.push(r.url());
      }
    });
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('#sup-photo-drop').click(),
    ]);
    await chooser.setFiles([
      file('a', [200, 60, 90]),
      file('b', [60, 200, 90]),
      file('c', [60, 90, 200]),
    ]);
    await expect(kept).toHaveCount(3);
    await expect(page.locator('#sup-photo-preview .photo-preview-item')).toHaveCount(3);
    expect(uploads).toHaveLength(3);
    await removeKept();
  });

  test('photos chosen while others are uploading are neither uploaded twice nor lost', async ({
    page,
    context,
    baseURL,
  }) => {
    const { kept, file, removeKept } = await openPhotoEditor(page, context, baseURL);
    await removeKept();
    const uploads = [];
    page.on('request', r => {
      if (r.method() === 'POST' && /\/photos$/.test(r.url())) {
        uploads.push(r.url());
      }
    });
    // Hold the first upload back so the second choice arrives while it is still going.
    let held = false;
    await page.route('**/photos', async route => {
      if (route.request().method() === 'POST' && !held) {
        held = true;
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      await route.continue();
    });
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('#sup-photo-drop').click(),
    ]);
    await chooser.setFiles(file('first', [200, 60, 90]));
    await expect(page.locator('#sup-photo-preview .photo-preview-item--pending')).toHaveCount(1);
    // The picker's own input, used directly so the choice lands mid-upload.
    await page.locator('body > input[type=file]').setInputFiles(file('second', [60, 200, 90]));
    await expect(kept).toHaveCount(2, { timeout: 15000 });
    await expect(page.locator('#sup-photo-preview .photo-preview-item')).toHaveCount(2);
    expect(uploads).toHaveLength(2);
    await reloadDashboard(page);
    await page.locator('#toggle-profile-form').click();
    await expect(kept).toHaveCount(2);
    await removeKept();
  });

  test('a photo that cannot be uploaded stays on screen, marked as failed', async ({
    page,
    context,
    baseURL,
  }) => {
    const { kept, file, removeKept } = await openPhotoEditor(page, context, baseURL);
    await removeKept();
    await page.route('**/photos', route =>
      route.request().method() === 'POST'
        ? route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Photo storage unavailable' }),
          })
        : route.continue()
    );
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('#sup-photo-drop').click(),
    ]);
    await chooser.setFiles(file('broken', [200, 60, 90]));
    const failed = page.locator('#sup-photo-preview .photo-preview-item--failed');
    await expect(failed).toHaveCount(1);
    await expect(failed).toContainText('Failed');
    await expect(kept).toHaveCount(0);
    // It can be dismissed.
    await failed.getByRole('button', { name: /remove/i }).click();
    await expect(page.locator('#sup-photo-preview .photo-preview-item')).toHaveCount(0);
  });

  test('the banner can be added, is kept after a reload, and can be removed', async ({
    page,
    context,
    baseURL,
  }) => {
    await openDashboard(page, context, baseURL);
    const openEditor = async () => {
      await page.locator('#toggle-profile-form').click();
      await expect(page.locator('#sdh-profile-dialog[open]')).toBeVisible();
    };
    await openEditor();
    const status = page.locator('#sdh-banner-status');
    const image = page.locator('#sdh-banner-img');
    await expect(page.locator('#sdh-banner-empty')).toBeVisible();
    await expect(page.locator('#sdh-banner-remove')).toBeHidden();

    // Something that is not an image is refused, with a reason.
    await page.locator('#sdh-banner-input').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not an image'),
    });
    await expect(status).toHaveText('Use a JPG, PNG or WebP image.');
    await expect(page.locator('#sdh-banner-empty')).toBeVisible();

    // An image is saved straight away and shown.
    await page.locator('#sdh-banner-input').setInputFiles({
      name: 'banner.png',
      mimeType: 'image/png',
      buffer: solidPng(64, [40, 90, 200]),
    });
    await expect(status).toHaveText('Banner saved.');
    await expect(image).toBeVisible();
    await expect(page.locator('#sdh-banner-upload')).toHaveText('Change banner');
    await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);

    // It is still there after a reload.
    await reloadDashboard(page);
    await openEditor();
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);

    // Removing it asks first; then the profile has none, and that is kept too.
    await page.locator('#sdh-banner-remove').click();
    // The confirmation is the topmost dialog; the profile editor (with its own button) is beneath it.
    await page
      .locator('dialog[open]')
      .last()
      .getByRole('button', { name: 'Remove banner' })
      .click();
    await expect(status).toHaveText('Banner removed.');
    await expect(page.locator('#sdh-banner-empty')).toBeVisible();
    await reloadDashboard(page);
    await openEditor();
    await expect(page.locator('#sdh-banner-empty')).toBeVisible();
    await expect(page.locator('#sdh-banner-remove')).toBeHidden();
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

  test('a review request is checked, sent once, and not sent twice to the same customer', async ({
    page,
    context,
    baseURL,
  }) => {
    await openDashboard(page, context, baseURL);
    const status = page.locator('#rreq-status');
    const email = `spec-${runId.slice(-8)}@example.test`;
    await page.locator('#sdh-request-review-btn').click();
    await expect(page.locator('#sdh-review-dialog[open]')).toBeVisible();

    // Nothing, or something that is not an address, is refused with a reason.
    await page.locator('#rreq-send-btn').click();
    await expect(status).toHaveText('Enter a valid customer email address.');
    await page.fill('#rreq-email', 'not-an-address');
    await page.locator('#rreq-send-btn').click();
    await expect(status).toHaveText('Enter a valid customer email address.');

    // A real address is sent to: the dialog closes and the request is listed.
    const asked = () =>
      page.waitForResponse(
        r => r.request().method() === 'POST' && /supplier\/request-review/.test(r.url())
      );
    await page.fill('#rreq-email', email);
    await page.fill('#rreq-name', 'Spec Customer');
    const [sent] = await Promise.all([asked(), page.locator('#rreq-send-btn').click()]);
    expect(sent.status()).toBeLessThan(300);
    await expect(page.locator('#sdh-review-dialog[open]')).toHaveCount(0);
    await expect(page.locator('#supplier-review-request-widget')).toContainText(
      /Spec Customer|spec-/
    );

    // Asking the same customer again is refused, with a reason, and the dialog stays open.
    await page.locator('#sdh-request-review-btn').click();
    await page.fill('#rreq-email', email);
    const [again] = await Promise.all([asked(), page.locator('#rreq-send-btn').click()]);
    expect(again.status()).toBeGreaterThanOrEqual(400);
    await expect(page.locator('#sdh-review-dialog[open]')).toBeVisible();
    await expect(status).not.toHaveText('');
    await expect(status).not.toHaveText('Sending…');
  });

  test('a review can be replied to, the reply is kept, and it can be edited', async ({
    page,
    context,
    baseURL,
  }) => {
    await openDashboard(page, context, baseURL);
    await expect(page.locator('.sr-review-card').first()).toBeVisible();
    const reviewId = await page
      .locator('.sr-review-card', { has: page.locator('.sr-reply-btn') })
      .first()
      .getAttribute('data-review-id');
    const card = page
      .locator(`[data-review-id="${reviewId}"]`)
      .locator('xpath=ancestor-or-self::article');
    await card.locator('.sr-reply-btn').click();
    const form = card.locator('.sr-reply-form');
    await expect(form).toBeVisible();

    // Too short is refused with a reason, and nothing is posted.
    await form.locator('textarea').fill('Thanks');
    await form.locator('.sr-reply-submit').click();
    await expect(form.locator('.sr-reply-status')).not.toHaveText('');
    await expect(card.locator('.sr-response')).toHaveCount(0);

    // Cancel closes the form.
    await form.locator('.sr-reply-cancel').click();
    await expect(form).toHaveCount(0);

    // A proper reply is posted and shown as "Your reply".
    await card.locator('.sr-reply-btn').click();
    const text = `Thank you, we enjoyed working with you. (${runId.slice(-5)})`;
    await card.locator('.sr-reply-form textarea').fill(text);
    await card.locator('.sr-reply-submit').click();
    await expect(card.locator('.sr-response-text')).toHaveText(text);

    // It is still there after a reload, and can be edited.
    await reloadDashboard(page);
    const same = page
      .locator('.sr-review-card', { has: page.locator('.sr-response-text') })
      .first();
    await expect(same.locator('.sr-response-text')).toHaveText(text);
    await same.locator('.sr-edit-reply-btn').click();
    const edited = `${text} Edited.`;
    await same.locator('.sr-reply-form textarea').fill(edited);
    await same.locator('.sr-reply-submit').click();
    await expect(same.locator('.sr-response-text')).toHaveText(edited);
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
    const seen = [];
    page.on('console', m => m.type() === 'error' && seen.push(`console: ${m.text()}`));
    page.on('requestfailed', r => seen.push(`failed: ${r.method()} ${r.url()}`));
    page.on('response', r => r.status() >= 400 && seen.push(`${r.status()} ${r.url()}`));
    const posted = page.waitForResponse(
      r => r.request().method() === 'POST' && /\/api\/tickets/.test(r.url()),
      { timeout: 15000 }
    );
    await modal.locator('button[type=submit]').click();
    const response = await posted.catch(error => {
      throw new Error(`${error.message}\nWhat the page reported: ${seen.join(' | ') || 'nothing'}`);
    });
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

  test('an enquiry from a customer reaches the supplier: notification first, then the drawer', async ({
    page,
    context,
    baseURL,
  }) => {
    const customer = await playwrightRequest.newContext({
      baseURL,
      extraHTTPHeaders: {
        'x-eventflow-e2e': 'backend-suite',
        'x-csrf-token': 'backend-e2e-csrf-token',
      },
    });
    const sender = `Dana Quote ${runId.slice(-6)}`;
    const sent = await customer.post('/api/quote-requests', {
      data: {
        name: sender,
        email: 'dana@example.com',
        eventType: 'Wedding',
        notes: 'Photography for 80 guests',
        suppliers: [{ supplierId: fixtures.supplier.id, supplierName: fixtures.supplier.name }],
      },
    });
    expect(sent.status()).toBe(200);
    await customer.dispose();

    await openDashboard(page, context, baseURL);
    // The supplier is told without having to look: a notification names the customer.
    await expect
      .poll(async () => {
        const response = await page.request.get('/api/notifications');
        const body = await response.json();
        return JSON.stringify(body.notifications || body.items || []);
      })
      .toContain(`New quote request from ${sender}`);
    // And the enquiry itself is in the drawer.
    await page.locator('#sdh-enquiries-open').click();
    await expect(page.locator('#sdh-enquiries-dialog[open]')).toContainText(sender);
  });

  test('a supplier can reply to an enquiry from the drawer, and it is kept and marked handled', async ({
    page,
    context,
    baseURL,
  }) => {
    const customer = await playwrightRequest.newContext({
      baseURL,
      extraHTTPHeaders: {
        'x-eventflow-e2e': 'backend-suite',
        'x-csrf-token': 'backend-e2e-csrf-token',
      },
    });
    const sender = `Eli Reply ${runId.slice(-6)}`;
    const sent = await customer.post('/api/quote-requests', {
      data: {
        name: sender,
        email: 'eli@example.com',
        eventType: 'Party',
        notes: 'Do you have a free date in June?',
        suppliers: [{ supplierId: fixtures.supplier.id, supplierName: fixtures.supplier.name }],
      },
    });
    expect(sent.status()).toBe(200);
    await customer.dispose();

    await openDashboard(page, context, baseURL);
    await page.locator('#sdh-enquiries-open').click();
    const drawer = page.locator('#sdh-enquiries-dialog[open]');
    await drawer.getByRole('button', { name: new RegExp(sender) }).click();

    const replyBox = drawer.getByLabel(`Reply to ${sender}`);
    await expect(replyBox).toBeVisible();
    // Nothing typed: it says so and sends nothing.
    await drawer.getByRole('button', { name: 'Send reply' }).click();
    await expect(page.locator('.sdh-toast')).toContainText('Write a reply first.');

    await replyBox.fill('Yes, 14 June is free. I will send a quote today.');
    await drawer.getByRole('button', { name: 'Send reply' }).click();
    await expect(page.locator('.sdh-toast')).toContainText('Reply sent.');
    await expect(drawer.locator('.sdh-enq__reply')).toContainText(
      'Yes, 14 June is free. I will send a quote today.'
    );
    await expect(drawer).toContainText('Status: Handled');
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

  test('a supplier waiting for approval can send their profile for verification', async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([
      { name: 'eventflow_cookie_consent', value: 'rejected', url: baseURL },
    ]);
    await loginAs(page, fixtures.users.pendingSupplier);
    await page.goto('/dashboard/supplier');
    await expect(page.locator('#welcome-heading')).toBeVisible();
    // A first visit opens the setup guide on top of the page; put it away first.
    await expect(page.locator('#sdh-guide-dialog[open]')).toBeVisible();
    await closeTopDialog(page);
    const dialog = page.locator('#sv-verification-modal');
    await page.locator('button[data-sdh-action="verify"]').first().click();
    await expect(dialog).toBeVisible();

    // It is filled in from the profile; blanking a required field is refused with the field named.
    await expect(page.locator('#sv-name')).not.toHaveValue('');
    await page.fill('#sv-phone', '');
    await page.locator('#sv-submit-btn').click();
    await expect(page.locator('#sv-modal-error')).toContainText('Phone');

    // Cancel closes it without sending anything.
    let posted = false;
    page.on('request', r => {
      posted ||= r.method() === 'POST' && /verification\/submit/.test(r.url());
    });
    await page.locator('#sv-cancel-btn').click();
    await expect(dialog).toBeHidden();
    expect(posted).toBe(false);

    // Complete, it is sent and the answer is shown.
    await page.locator('button[data-sdh-action="verify"]').first().click();
    await page.fill('#sv-phone', '+44 7700 900123');
    const [response] = await Promise.all([
      page.waitForResponse(
        r => r.request().method() === 'POST' && /verification\/submit/.test(r.url())
      ),
      page.locator('#sv-submit-btn').click(),
    ]);
    expect(response.status()).toBe(200);
    expect((await response.json()).verificationStatus).toBe('pending_review');
    await expect(page.locator('#sv-modal-success')).toContainText('Verification submitted');
    await expect(page.locator('#sv-fields')).toBeHidden();
    await expect(page.locator('#sv-submit-btn')).toBeHidden();
    await expect(page.locator('#sv-cancel-btn')).toHaveText('Close');
    await page.locator('#sv-cancel-btn').click();
    await expect(dialog).toBeHidden();
  });

  test.describe('the plan card of a supplier on a paid plan', () => {
    /** Opens the dashboard as if the supplier's plan were a paid one (only the plan card changes). */
    async function openOnPaidPlan(page, context, baseURL, portalReply) {
      await page.route('**/api/supplier/dashboard-summary*', async route => {
        const response = await route.fetch();
        const body = await response.json();
        body.subscription = {
          plan: 'pro',
          status: 'active',
          activeUntil: '2027-01-01T00:00:00.000Z',
        };
        await route.fulfill({ response, json: body });
      });
      await page.route('**/api/payments/create-portal-session', route =>
        portalReply ? route.fulfill(portalReply) : route.continue()
      );
      // Stripe is not reached from the test: a page on its hosted domain is answered here.
      await page.route('https://billing.stripe.com/**', route =>
        route.fulfill({ contentType: 'text/html', body: '<title>Stripe billing portal</title>' })
      );
      await openDashboard(page, context, baseURL);
      return page.locator('[data-sdh-action="billing"]');
    }

    const portal = (status, body) => ({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });

    test('shows its billing and subscription links, and "Manage billing" opens Stripe', async ({
      page,
      context,
      baseURL,
    }) => {
      const billing = await openOnPaidPlan(
        page,
        context,
        baseURL,
        portal(200, { url: 'https://billing.stripe.com/p/session/test_123' })
      );
      await expect(billing).toHaveText('Manage billing');
      await expect(page.getByRole('link', { name: 'View subscription' })).toHaveAttribute(
        'href',
        '/supplier/subscription'
      );
      await billing.click();
      await page.waitForURL('https://billing.stripe.com/p/session/test_123');
    });

    for (const [name, reply] of [
      ['another website', { url: 'https://evil.example/billing' }],
      ['a look-alike of the Stripe address', { url: 'https://billing.stripe.com.evil.example/p' }],
      ['a script', { url: 'javascript:alert(1)' }],
      ['no address at all', {}],
    ]) {
      test(`refuses to open ${name}, and says so`, async ({ page, context, baseURL }) => {
        const billing = await openOnPaidPlan(page, context, baseURL, portal(200, reply));
        const here = page.url();
        await billing.click();
        await expect(page.getByText('Could not open the billing portal.').first()).toBeVisible();
        await expect(billing).toBeEnabled();
        expect(page.url()).toBe(here);
      });
    }

    test('says so, and keeps the button usable, when the billing portal cannot be reached', async ({
      page,
      context,
      baseURL,
    }) => {
      const billing = await openOnPaidPlan(
        page,
        context,
        baseURL,
        portal(500, { error: 'The billing portal is unavailable.' })
      );
      const here = page.url();
      await billing.click();
      await expect(page.getByText('The billing portal is unavailable.').first()).toBeVisible();
      await expect(billing).toBeEnabled();
      await expect(billing).toHaveText('Manage billing');
      expect(page.url()).toBe(here);
    });
  });

  test('Log out ends the session', async ({ page, context, baseURL }) => {
    await openDashboard(page, context, baseURL);
    // The header says "Log in" until the page has learned who is signed in; only then is it Log out.
    await expect(page.locator('#ef-auth-link')).toHaveText('Log out');
    await page.locator('#ef-auth-link').click();
    await page.waitForURL(url => !/dashboard\/supplier/.test(url.pathname), { timeout: 10000 });
    // The session is gone: the account call reports nobody, and the dashboard is protected again.
    const me = await page.request.get('/api/v1/auth/me');
    expect((await me.json()).user).toBeNull();
    const dashboard = await page.request.get('/dashboard/supplier', { maxRedirects: 0 });
    expect(dashboard.status()).toBe(401);
  });
});
