import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  cleanupBackendFixtures,
  createRunId,
  E2E_HEADERS,
  seedBackendFixtures,
} from './helpers/backend-fixtures.js';

/**
 * The verification email, end to end: a supplier whose address is not verified asks for the email,
 * the email that is actually produced (written to the outbox because no mail provider is configured
 * here) contains a link, and opening that link in a browser verifies the account. Nothing is mocked
 * between the button and the link.
 */

const OUTBOX = path.resolve(process.cwd(), 'outbox');

/** The newest outbox message addressed to `email`, as text, or '' when none has been written yet. */
function newestMailTo(email, since) {
  if (!fs.existsSync(OUTBOX)) {
    return '';
  }
  const files = fs
    .readdirSync(OUTBOX)
    .filter(name => name.endsWith('.eml'))
    .map(name => ({ name, time: fs.statSync(path.join(OUTBOX, name)).mtimeMs }))
    .filter(file => file.time >= since)
    .sort((a, b) => b.time - a.time);
  for (const file of files) {
    const text = fs.readFileSync(path.join(OUTBOX, file.name), 'utf8');
    if (text.includes(`To: ${email}`)) {
      return text;
    }
  }
  return '';
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
        () => {
          mail = newestMailTo(user.email, since);
          return mail.length;
        },
        { message: 'the verification email was written to the outbox' }
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
