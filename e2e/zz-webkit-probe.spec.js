import { test, expect } from '@playwright/test';
import {
  cleanupBackendFixtures,
  createRunId,
  loginAs,
  seedBackendFixtures,
} from './helpers/backend-fixtures.js';

// TEMPORARY diagnostic: which page, script or stylesheet stops requestAnimationFrame in WebKit?
test.describe('webkit probe @backend', () => {
  const runId = createRunId('wk-probe');
  let fixtures;
  test.beforeAll(async ({ request }) => {
    fixtures = await seedBackendFixtures(request, runId);
  });
  test.afterAll(async ({ request }) => {
    await cleanupBackendFixtures(request, runId);
  });

  // Frames in one second, or "none" when the first frame has not come after 2 seconds.
  const frames = page =>
    page.evaluate(
      () =>
        new Promise(resolve => {
          let n = 0;
          const started = performance.now();
          const tick = () => {
            n++;
            if (performance.now() - started < 1000) {
              requestAnimationFrame(tick);
            } else {
              resolve(n);
            }
          };
          requestAnimationFrame(tick);
          setTimeout(() => resolve(n ? n : 'none'), 2200);
        })
    );

  async function measure(browser, baseURL, fixtures, label, url, shape) {
    const context = await browser.newContext({ baseURL });
    await context.addCookies([
      { name: 'eventflow_cookie_consent', value: 'rejected', url: baseURL },
    ]);
    const page = await context.newPage();
    let result;
    try {
      await loginAs(page, fixtures.users.admin);
      if (shape) {
        await page.route(`**${url}`, async route => {
          const response = await route.fetch();
          const body = await response.text();
          await route.fulfill(shape(response, body));
        });
      }
      await page.goto(url, { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(500);
      result = await frames(page);
    } catch (error) {
      result = `error ${String(error.message).split('\n')[0]}`;
    }
    await context.close();
    console.log(`PROBE ${label}: ${result}`);
  }

  test('probe', async ({ browser, baseURL, browserName }) => {
    test.skip(browserName !== 'webkit', 'diagnostic for WebKit only');
    test.setTimeout(240000);
    const admin = '/admin-packages';
    const contentType = response => ({ 'content-type': response.headers()['content-type'] });
    const stripScripts = body => body.replace(/<script[\s\S]*?<\/script>/gi, '');
    const stripAll = body =>
      stripScripts(body).replace(/<link[^>]*rel=['"]stylesheet['"][^>]*>/gi, '');
    const cases = [
      ['about', '/about'],
      ['faq', '/faq'],
      ['admin baseline', admin],
      ['admin users', '/admin-users'],
      [
        'admin, headers reduced to content-type',
        admin,
        (response, body) => ({ status: 200, headers: contentType(response), body }),
      ],
      [
        'admin, tiny body, all headers',
        admin,
        (response, body) => ({
          response,
          body: '<!DOCTYPE html><html><body><p>hi</p></body></html>',
        }),
      ],
      [
        'admin, tiny body, content-type only',
        admin,
        (response, body) => ({
          status: 200,
          headers: contentType(response),
          body: '<!DOCTYPE html><html><body><p>hi</p></body></html>',
        }),
      ],
      [
        'admin, no inline or external scripts',
        admin,
        (response, body) => ({ response, body: stripScripts(body) }),
      ],
      [
        'admin, no scripts and no stylesheets',
        admin,
        (response, body) => ({ response, body: stripAll(body) }),
      ],
    ];
    for (const [label, url, shape] of cases) {
      await measure(browser, baseURL, fixtures, label, url, shape);
    }
  });
});
