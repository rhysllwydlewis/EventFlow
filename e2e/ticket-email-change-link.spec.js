import { test, expect } from '@playwright/test';

/**
 * Settings sends customers and suppliers to a new support ticket (the dashboards' own form) to ask
 * for a change of sign-in email, which support does by hand. The link is `?ticket=email-change` on
 * the dashboard: it opens the ticket form with a subject and a start of a message filled in.
 */
for (const role of ['customer', 'supplier']) {
  test.describe(`Email change ticket link: ${role}`, () => {
    async function openDashboard(page, context, baseURL, search = '') {
      await context.addCookies([
        { name: 'eventflow_cookie_consent', value: 'rejected', url: baseURL },
        { name: 'test_auth', value: 'owner', url: baseURL },
      ]);
      await page.route(
        url => !url.href.startsWith(baseURL),
        route => route.abort()
      );
      const created = [];
      await page.route('**/api/**', async route => {
        const request = route.request();
        const { pathname } = new URL(request.url());
        const json = (body, status = 200) =>
          route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (pathname.includes('csrf')) {
          return json({ csrfToken: 'test' });
        }
        if (pathname === '/api/v1/auth/me') {
          return json({
            user: { id: 'u1', role, email: 'me@example.test', name: 'Test User', verified: true },
          });
        }
        if (pathname.endsWith('/tickets') && request.method() === 'POST') {
          created.push(request.postDataJSON());
          return json({ ticket: { id: 't1', subject: 's', message: 'm', status: 'open' } }, 201);
        }
        if (pathname.endsWith('/tickets')) {
          return json({ tickets: [] });
        }
        return json({}, 404);
      });
      await page.goto(`/dashboard-${role}.html${search}`, { waitUntil: 'domcontentloaded' });
      return created;
    }

    test('opens the ticket form with the subject and the start of a message filled in', async ({
      page,
      context,
      baseURL,
    }) => {
      await openDashboard(page, context, baseURL, '?ticket=email-change&keep=1#top');
      await expect(page.locator('.ticket-create-modal')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('#ticketSubject')).toHaveValue('Change my account email address');
      await expect(page.locator('#ticketMessage')).toHaveValue(/New email address: $/);
    });

    test('takes the ticket parameter out of the address, so a reload does not reopen it', async ({
      page,
      context,
      baseURL,
    }) => {
      await openDashboard(page, context, baseURL, '?ticket=email-change&keep=1#top');
      await expect(page.locator('.ticket-create-modal')).toBeVisible({ timeout: 15000 });
      const url = new URL(page.url());
      expect(url.search).toBe('?keep=1');
      expect(url.hash).toBe('#top');
    });

    test('submits a ticket as this kind of account', async ({ page, context, baseURL }) => {
      const created = await openDashboard(page, context, baseURL, '?ticket=email-change');
      await expect(page.locator('.ticket-create-modal')).toBeVisible({ timeout: 15000 });
      await page
        .locator('#ticketMessage')
        .fill('Please change it.\n\nNew email address: new@x.test');
      await page.locator('#createTicketForm button[type="submit"]').click();
      await expect.poll(() => created.length).toBe(1);
      expect(created[0]).toMatchObject({
        senderType: role,
        subject: 'Change my account email address',
      });
    });

    test('a normal visit does not open the ticket form', async ({ page, context, baseURL }) => {
      await openDashboard(page, context, baseURL);
      await expect(
        page.locator('#tickets-' + (role === 'customer' ? 'cust' : 'sup'))
      ).toBeVisible();
      await expect(page.locator('.ticket-create-modal')).toHaveCount(0);
    });
  });
}
