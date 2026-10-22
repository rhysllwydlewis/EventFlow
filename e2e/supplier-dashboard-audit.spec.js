import { test, expect } from '@playwright/test';
import {
  cleanupBackendFixtures,
  createRunId,
  E2E_HEADERS,
  loginAs,
  seedBackendFixtures,
} from './helpers/backend-fixtures.js';

const CSRF = { ...E2E_HEADERS, 'x-csrf-token': 'backend-e2e-csrf-token' };

// Check the actual painted layout: a page can hide horizontal overflow while
// individual controls still overlap, disappear behind one another, or leave a card.
async function expectInside(child, parent) {
  const inner = await child.boundingBox();
  const outer = await parent.boundingBox();
  expect(inner, 'control is rendered').not.toBeNull();
  expect(outer, 'container is rendered').not.toBeNull();
  expect(inner.x).toBeGreaterThanOrEqual(outer.x - 1);
  expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + 1);
}

async function expectMessageControls(page) {
  const tools = page.locator('.sdh-msg-tools');
  const controls = tools.locator('input, select');
  const boxes = [];
  for (const control of await controls.all()) {
    await expectInside(control, tools);
    boxes.push(await control.boundingBox());
    if ((await control.evaluate(el => el.tagName)) === 'SELECT') {
      const readable = await control.evaluate(el => {
        const style = getComputedStyle(el);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.font = style.font;
        return (
          ctx.measureText(el.selectedOptions[0].text).width <=
          el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) + 1
        );
      });
      expect(readable, 'selected option is fully readable').toBe(true);
    }
  }
  expect(boxes[0].width, 'search has room for text, not only its padding').toBeGreaterThan(200);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i],
        b = boxes[j];
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      expect(overlapX > 1 && overlapY > 1, 'message controls do not overlap').toBe(false);
    }
  }
}

test.describe('Supplier dashboard visual-audit regressions @backend', () => {
  test.describe.configure({ mode: 'default' });
  const runId = createRunId('dashboard-audit');
  const runs = [runId];
  let fixtures;

  test.beforeAll(async ({ request }) => {
    fixtures = await seedBackendFixtures(request, runId, {
      supplierPhotoSource: 'profilePhotoUrl',
    });
  });
  test.afterAll(async ({ request }) => {
    for (const id of runs) await cleanupBackendFixtures(request, id);
  });

  async function fixture(request, options) {
    const id = createRunId('dashboard-audit-state');
    runs.push(id);
    return seedBackendFixtures(request, id, options);
  }

  async function open(page, context, baseURL, data = fixtures, who = 'supplier') {
    await context.addCookies([
      { name: 'eventflow_cookie_consent', value: 'rejected', url: baseURL },
    ]);
    await loginAs(page, data.users[who]);
    await page.goto('/dashboard/supplier');
    await expect(page.locator('.sdh-profile__name')).toBeVisible();
    await expect(page.locator('#my-packages')).not.toContainText('Loading');
    if (await page.locator('#sdh-guide-dialog[open]').count()) await page.keyboard.press('Escape');
    await expect(page.locator('#supplier-events-calendar.fc')).toBeAttached();
  }

  async function expandCalendar(page) {
    const folded = page.locator('#availability-calendar details:not([open]) summary');
    if (await folded.count()) await folded.click();
  }

  for (const width of [1920, 1440, 1280, 1024, 768, 390, 360, 320]) {
    test(`controls fit their cards and remain readable at ${width}px`, async ({
      page,
      context,
      baseURL,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page, context, baseURL);
      await expectMessageControls(page);

      const remove = page.getByRole('button', { name: 'Delete profile photo', exact: true });
      const camera = page.locator('.sdh-avatar__camera');
      const visual = await remove.boundingBox();
      const cameraBox = await camera.boundingBox();
      expect(visual.width).toBe(32);
      expect(visual.height).toBe(32);
      expect(cameraBox.width).toBe(visual.width);
      expect(cameraBox.x).toBe(visual.x);
      const hit = await remove.evaluate(el => {
        const s = getComputedStyle(el, '::after');
        return { width: parseFloat(s.width), height: parseFloat(s.height) };
      });
      expect(hit.width).toBeGreaterThanOrEqual(44);
      expect(hit.height).toBeGreaterThanOrEqual(44);
      await expect(remove.locator('svg')).toHaveAttribute('aria-hidden', 'true');

      for (const row of await page.locator('.sdh-pkg__actions').all()) {
        for (const action of await row.locator('button, a').all()) await expectInside(action, row);
      }
      await expandCalendar(page);
      const calendar = page.locator('#availability-calendar');
      for (const action of await calendar
        .locator('.sdh-card__actions a, .sdh-card__actions button:visible')
        .all()) {
        await expectInside(action, calendar);
      }
      const notice = page.locator('#sup-cal-permission-notice');
      await expect(notice.locator('.sup-cal-permission-notice__copy')).toContainText(
        'Your private calendar is not affected.'
      );
      await expectInside(page.locator('#sup-request-publishing-btn'), notice);
      await testInfo.attach(`calendar-${width}`, {
        body: await calendar.screenshot(),
        contentType: 'image/png',
      });
    });
  }

  for (const width of [1440, 320]) {
    test(`a pending supplier retains the dashboard and approval restrictions at ${width}px`, async ({
      page,
      context,
      baseURL,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page, context, baseURL, fixtures, 'pendingSupplier');
      await expectMessageControls(page);
      await expect(page.locator('.sdh-profile')).toContainText('Awaiting review');
      await expect(page.locator('#toggle-package-form')).toBeDisabled();
    });
  }

  test('publisher actions fit a small phone and denial does not offer an access request', async ({
    page,
    context,
    baseURL,
    request,
  }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    const publisher = await fixture(request, { supplierPublisher: true });
    await open(page, context, baseURL, publisher);
    await expandCalendar(page);
    await expect(page.locator('#sup-cal-add-event-btn')).toBeVisible();
    for (const action of await page
      .locator('#availability-calendar .sdh-card__actions > :visible')
      .all()) {
      await expectInside(action, page.locator('#availability-calendar'));
    }
    await page.locator('#sup-cal-add-event-btn').click();
    await expect(page.locator('#sup-cal-pub-event-modal')).toBeVisible();
    await page.keyboard.press('Escape');

    const denied = await fixture(request, { supplierPublisherOverride: false });
    await open(page, context, baseURL, denied);
    await expandCalendar(page);
    await expect(page.locator('#sup-cal-permission-notice')).toContainText(
      'disabled for your account'
    );
    await expect(page.locator('#sup-request-publishing-btn')).toHaveCount(0);
    await expect(page.locator('#sup-cal-add-event-btn')).toBeHidden();
  });

  test('the empty mobile list points to a working private-entry action', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, context, baseURL);
    await expandCalendar(page);
    await expect(page.locator('.cal-no-events')).toContainText('Use Add private entry');
    await expect(page.locator('.cal-no-events')).not.toContainText('Click any day');
    await page.locator('#sup-cal-add-entry-btn').click();
    await page.locator('#sup-cal-entry-title').fill('Audit regression private entry');
    await page.locator('#sup-cal-entry-type').selectOption('meeting');
    const saved = page.waitForResponse(
      r => r.request().method() === 'POST' && r.url().includes('/api/me/calendar-entries')
    );
    await page.locator('#sup-cal-entry-submit').click();
    const response = await saved;
    expect(response.status()).toBe(201);
    const { entry } = await response.json();
    try {
      await page.reload();
      await expandCalendar(page);
      await expect(page.locator('.fc-list-event')).toContainText(entry.title);
    } finally {
      expect(
        (await page.request.delete(`/api/me/calendar-entries/${entry.id}`, { headers: CSRF })).ok()
      ).toBe(true);
    }
    await page.locator('#sup-request-publishing-btn').click();
    await expect(page.locator('#sdh-publisher-dialog[open]')).toBeVisible();
  });

  for (const source of ['profilePhotoUrl', 'profileImage']) {
    test(`a supplier-only ${source} can be removed after confirmation and stays removed`, async ({
      page,
      context,
      baseURL,
      request,
    }) => {
      const data = await fixture(request, { supplierPhotoSource: source });
      await open(page, context, baseURL, data);
      await page.getByRole('button', { name: 'Delete profile photo', exact: true }).click();
      await page.getByRole('button', { name: 'Cancel', exact: true }).last().click();
      await expect(page.locator('.sdh-avatar img')).toHaveCount(1);
      await page.getByRole('button', { name: 'Delete profile photo', exact: true }).click();
      await page.getByRole('button', { name: 'Remove photo', exact: true }).click();
      await expect(page.locator('.sdh-toast')).toHaveText('Profile photo removed');
      await expect(page.locator('.sdh-avatar img')).toHaveCount(0);
      await page.reload();
      await expect(page.locator('.sdh-profile')).toBeVisible();
      await expect(page.locator('.sdh-avatar img')).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Delete profile photo', exact: true })
      ).toHaveCount(0);
    });
  }

  test('a logo fallback is retained without a misleading profile-photo delete action', async ({
    page,
    context,
    baseURL,
    request,
  }) => {
    const data = await fixture(request, { supplierPhotoSource: 'logo' });
    // A public-profile visit caches this logo as publicProfileAvatarUrl. That
    // cached branding must not turn into a removable profile photo afterwards.
    const publicAvatar = await request.get(`/api/public/suppliers/${data.supplier.id}/avatar`);
    expect(publicAvatar.ok()).toBe(true);
    expect((await publicAvatar.json()).avatarUrl).toBe('/favicon-144x144.png');
    await open(page, context, baseURL, data);
    await expect(page.locator('.sdh-avatar img')).toHaveAttribute('src', '/favicon-144x144.png');
    await expect(
      page.getByRole('button', { name: 'Delete profile photo', exact: true })
    ).toHaveCount(0);
    await expect(page.locator('.sdh-avatar__camera')).toBeVisible();
  });

  test('photo-delete errors are visible, leave the image intact, and allow retry', async ({
    page,
    context,
    baseURL,
    request,
  }) => {
    const data = await fixture(request, { supplierPhotoSource: 'profilePhotoUrl' });
    await open(page, context, baseURL, data);
    await page.route('**/api/profile/avatar', route =>
      route.request().method() === 'DELETE'
        ? route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Photo removal temporarily unavailable' }),
          })
        : route.continue()
    );
    const remove = page.getByRole('button', { name: 'Delete profile photo', exact: true });
    await remove.click();
    await page.getByRole('button', { name: 'Remove photo', exact: true }).click();
    await expect(page.locator('.sdh-toast')).toHaveText('Photo removal temporarily unavailable');
    await expect(remove).toBeEnabled();
    await expect(page.locator('.sdh-avatar img')).toHaveCount(1);
    await page.unroute('**/api/profile/avatar');
    await remove.click();
    await page.getByRole('button', { name: 'Remove photo', exact: true }).click();
    await expect(page.locator('.sdh-avatar img')).toHaveCount(0);
  });

  test('the visible message controls still search, filter, and sort real conversations', async ({
    page,
    context,
    baseURL,
    playwright,
  }) => {
    const clients = [];
    try {
      for (const who of ['customer', 'admin']) {
        const client = await playwright.request.newContext({
          baseURL,
          extraHTTPHeaders: E2E_HEADERS,
        });
        clients.push(client);
        await loginAs({ request: client }, fixtures.users[who]);
        const created = await client.post('/api/v4/messenger/conversations', {
          headers: CSRF,
          data: { type: 'direct', participantIds: [fixtures.users.supplier.id] },
        });
        expect(created.status()).toBe(201);
        const id = (await created.json()).conversation._id;
        expect(
          (
            await client.post(`/api/v4/messenger/conversations/${id}/messages`, {
              headers: CSRF,
              data: { content: `Dashboard audit message from ${who}` },
            })
          ).status()
        ).toBe(201);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await open(page, context, baseURL);
      const widget = page.locator('#messenger-dashboard-widget-supplier');
      await expect(widget.locator('.mwv4__item')).toHaveCount(2);
      await expectMessageControls(page);
      await expect(widget.locator('.mwv4__item').first()).toContainText('message from admin');
      await page.locator('#widget-sort-select-supplier').selectOption('oldest');
      await expect(widget.locator('.mwv4__item').first()).toContainText('message from customer');
      await page.locator('#widget-search-input-supplier').fill('message from customer');
      await expect(widget.locator('.mwv4__item')).toHaveCount(1);
      await page.locator('#widget-search-input-supplier').fill('no matching conversation');
      await expect(widget.locator('.mwv4__item')).toHaveCount(0);
      await page.locator('#widget-search-input-supplier').clear();
      await page.locator('#widget-filter-select-supplier').selectOption('unread');
      await expect(widget.locator('.mwv4__item')).toHaveCount(2);
      await page.locator('#widget-filter-select-supplier').selectOption('starred');
      await expect(widget.locator('.mwv4__item')).toHaveCount(0);
      await page.locator('#widget-filter-select-supplier').selectOption('all');
      await expect(widget.locator('.mwv4__item')).toHaveCount(2);
    } finally {
      for (const client of clients) await client.dispose();
    }
  });
});
