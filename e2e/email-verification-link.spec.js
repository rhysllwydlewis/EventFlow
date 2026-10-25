import { test, expect } from '@playwright/test';
import {
  cleanupBackendFixtures,
  createRunId,
  E2E_HEADERS,
  seedBackendFixtures,
} from './helpers/backend-fixtures.js';

/**
 * The verification email, end to end: a supplier whose address is not verified asks for the email,
 * the email that is actually produced (kept by the app because no mail provider is configured
 * here) contains a link, and opening that link in a browser verifies the account. Nothing is mocked
 * between the button and the link.
 */

/**
 * The newest email sent to `email` since `since`, as one text, or '' when none has been sent yet.
 * The app keeps the full email in memory while no mail provider is configured (the outbox files hold
 * metadata only), and the test-only /__e2e/mail route hands it back.
 */
async function newestMailTo(request, email, since) {
  const response = await request.get(`/__e2e/mail?to=${encodeURIComponent(email)}&since=${since}`, {
    headers: E2E_HEADERS,
  });
  if (response.status() === 404) {
    return '';
  }
  expect(response.ok(), await response.text()).toBe(true);
  const message = await response.json();
  return `To: ${message.to}\nSubject: ${message.subject}\n\n${message.html || message.text}`;
}

test.describe('Verification email link @backend', () => {
  const runId = createRunId('verify-link');
  let fixtures;

  test.beforeAll(async ({ request }) => {
    fixtures = await seedBackendFixtures(request, runId);
  });

  test.afterAll(async ({ request }) => {
    await cleanupBackendFixtures(request, runId);
  });

  test('the link in the email verifies the account', async ({ page, request, baseURL }) => {
    const user = fixtures.users.unverifiedEmail;
    const since = Date.now() - 1000;
    const asked = await request.post('/api/auth/resend-verification', {
      headers: { ...E2E_HEADERS, 'x-csrf-token': 'backend-e2e-csrf-token' },
      data: { email: user.email },
    });
    expect(asked.ok()).toBe(true);

    let mail = '';
    await expect
      .poll(
        async () => {
          mail = await newestMailTo(request, user.email, since);
          return mail.length;
        },
        { message: 'the verification email was produced' }
      )
      .toBeGreaterThan(0);
    expect(mail).toMatch(/^Subject: Confirm your EventFlow account/im);

    const link = mail.match(/https?:\/\/[^\s"'<>]*verify[^\s"'<>]*token=[^\s"'<>]+/i);
    expect(link, 'the email has a verification link').toBeTruthy();
    // The link is built from the site's address; open the same path on the server under test.
    const url = new URL(link[0].replace(/&amp;/g, '&'));
    const verified = page.waitForResponse(
      r => r.request().method() === 'GET' && /\/api\/(v1\/)?auth\/verify\?token=/.test(r.url())
    );
    await page.goto(`${baseURL}${url.pathname}${url.search}`);
    expect((await verified).ok()).toBe(true);

    // The account can now sign in, and is reported as verified.
    const login = await page.request.post('/api/auth/login', {
      headers: E2E_HEADERS,
      data: { email: user.email, password: user.password, remember: false },
    });
    expect(login.ok(), await login.text()).toBe(true);
    const me = await (await page.request.get('/api/auth/me')).json();
    expect((me.user || me).verified).toBe(true);
  });

  test('a link with a wrong token verifies nothing and says so', async ({ page, baseURL }) => {
    const response = await page.goto(`${baseURL}/api/auth/verify?token=not-a-real-token`);
    expect(response.status()).toBeLessThan(500);
    await expect(page.locator('body')).not.toContainText(/verified successfully/i);
  });
});
