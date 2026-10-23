import { test, expect } from '@playwright/test';

/**
 * The /support page creates a ticket with the same API as the dashboards' forms, which needs the
 * account type to be sent along. Before, it was left out and every submit was refused.
 */
async function openSupport(page, context, baseURL, role) {
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
      return json({ user: { id: 'u1', role, email: 'me@example.test', name: 'Test User' } });
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
  await page.goto('/support.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#new-ticket-btn').click();
  await page.fill('#ticket-subject', 'Invoice question');
  await page.fill('#ticket-message', 'I cannot download my invoice.');
  await page.selectOption('#ticket-category', 'billing');
  return created;
}

for (const role of ['customer', 'supplier']) {
  test(`a ${role} can create a ticket from /support`, async ({ page, context, baseURL }) => {
    const created = await openSupport(page, context, baseURL, role);
    await page.locator('#create-ticket-submit').click();
    await expect.poll(() => created.length).toBe(1);
    expect(created[0]).toEqual({
      senderType: role,
      subject: 'Invoice question',
      message: 'I cannot download my invoice.',
      category: 'billing',
    });
    await expect(page.locator('#create-ticket-modal')).not.toHaveClass(/active/);
  });
}

test('an account that cannot raise tickets is told so, and nothing is sent', async ({
  page,
  context,
  baseURL,
}) => {
  const created = await openSupport(page, context, baseURL, 'admin');
  await page.locator('#create-ticket-submit').click();
  await expect(page.locator('#_ticket_submit_status')).toContainText(
    'available to customer and supplier accounts'
  );
  expect(created).toEqual([]);
});

test('the form has no priority choice, because priority is set from the account plan', async ({
  page,
  context,
  baseURL,
}) => {
  await openSupport(page, context, baseURL, 'customer');
  await expect(page.locator('#ticket-priority')).toHaveCount(0);
});
