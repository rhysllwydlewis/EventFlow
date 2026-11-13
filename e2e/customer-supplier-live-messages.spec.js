import { test, expect } from '@playwright/test';
import {
  cleanupBackendFixtures,
  createRunId,
  E2E_HEADERS,
  loginAs,
  seedBackendFixtures,
} from './helpers/backend-fixtures.js';

/**
 * The messenger widget on the customer dashboard and on the supplier dashboard, with a real customer
 * and a real supplier at the same time: a message sent by one reaches the other's open dashboard
 * without a reload (unread badge and conversation preview), and reading it clears the badge.
 */

const CSRF = { 'x-csrf-token': 'backend-e2e-csrf-token' };

test.describe('Customer and supplier messages arrive live @backend', () => {
  const runId = createRunId('live-messages');
  let fixtures;

  test.beforeAll(async ({ request }) => {
    fixtures = await seedBackendFixtures(request, runId);
  });

  test.afterAll(async ({ request }) => {
    await cleanupBackendFixtures(request, runId);
  });

  async function signedIn(browser, baseURL, user, path, widget) {
    const context = await browser.newContext({ baseURL, extraHTTPHeaders: E2E_HEADERS });
    await context.addCookies([
      { name: 'eventflow_cookie_consent', value: 'rejected', url: baseURL },
    ]);
    const page = await context.newPage();
    // The widget only receives a push once its socket has said who it is and the server has put it
    // on the user's channel (`auth:success`). A message sent before that is missed, and the widget's
    // fallback poll is a minute away, so wait for the acknowledgement before anything is sent.
    let socketReady = false;
    page.on('websocket', socket => {
      socket.on('framereceived', ({ payload }) => {
        if (String(payload).includes('"auth:success"')) {
          socketReady = true;
        }
      });
    });
    await loginAs(page, user);
    await page.goto(path);
    await expect(page.locator(widget)).toBeAttached({ timeout: 20000 });
    await expect
      .poll(() => socketReady, {
        message: `the ${path} socket never confirmed it was signed in`,
        timeout: 20000,
      })
      .toBe(true);
    return { context, page, widget };
  }

  test('a reply reaches the customer dashboard, and the customer’s message reaches the supplier’s', async ({
    browser,
    baseURL,
  }) => {
    const customer = await signedIn(
      browser,
      baseURL,
      fixtures.users.customer,
      '/dashboard/customer',
      '#messenger-dashboard-widget'
    );
    const supplier = await signedIn(
      browser,
      baseURL,
      fixtures.users.supplier,
      '/dashboard/supplier',
      '#messenger-dashboard-widget-supplier'
    );
    try {
      const created = await customer.page.request.post('/api/v4/messenger/conversations', {
        headers: CSRF,
        data: { type: 'direct', participantIds: [fixtures.users.supplier.id] },
      });
      expect(created.status()).toBe(201);
      const conversationId = (await created.json()).conversation._id;
      const send = (who, content) =>
        who.page.request.post(`/api/v4/messenger/conversations/${conversationId}/messages`, {
          headers: CSRF,
          data: { content },
        });

      // Customer -> supplier: the supplier's open dashboard shows it, unread.
      expect((await send(customer, 'Do you have 14 June free?')).status()).toBe(201);
      await expect(supplier.page.locator(supplier.widget)).toContainText(
        'Do you have 14 June free?',
        { timeout: 15000 }
      );

      // Supplier -> customer: the customer's open dashboard shows it, with an unread badge.
      expect((await send(supplier, 'Yes, 14 June is free.')).status()).toBe(201);
      await expect(customer.page.locator(customer.widget)).toContainText('Yes, 14 June is free.', {
        timeout: 15000,
      });
      await expect(customer.page.locator('#unreadMessageBadge')).toHaveText('1', {
        timeout: 15000,
      });

      // Reading it clears the badge, here and after a reload.
      const read = await customer.page.request.post(
        `/api/v4/messenger/conversations/${conversationId}/read`,
        { headers: CSRF, data: {} }
      );
      expect(read.ok()).toBe(true);
      await customer.page.reload();
      await expect(customer.page.locator(customer.widget)).toContainText('Yes, 14 June is free.');
      await expect(customer.page.locator('#unreadMessageBadge')).not.toHaveText('1');
    } finally {
      await customer.context.close();
      await supplier.context.close();
    }
  });
});
