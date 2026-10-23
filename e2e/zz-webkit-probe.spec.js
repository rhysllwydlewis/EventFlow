import { test, expect } from '@playwright/test';
import {
  cleanupBackendFixtures,
  createRunId,
  loginAs,
  seedBackendFixtures,
} from './helpers/backend-fixtures.js';

// TEMPORARY diagnostic (removed before merge): which script on the admin packages page stops
// requestAnimationFrame in WebKit?
test.describe('webkit probe @backend', () => {
  const runId = createRunId('wk-probe');
  let fixtures;
  test.beforeAll(async ({ request }) => {
    fixtures = await seedBackendFixtures(request, runId);
  });
  test.afterAll(async ({ request }) => {
    await cleanupBackendFixtures(request, runId);
  });

  // Frames in one second, or "none" when no frame has come after 2 seconds.
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

  /** Every <script ...></script> element in the markup, found without a regular expression. */
  function scriptTags(html) {
    const tags = [];
    let from = 0;
    for (;;) {
      const start = html.indexOf('<script', from);
      if (start === -1) {
        return tags;
      }
      const end = html.indexOf('</script>', start) + '</script>'.length;
      tags.push(html.slice(start, end));
      from = end;
    }
  }

  const nameOf = tag => {
    const at = tag.indexOf('src="') + 5;
    return tag.slice(at, tag.indexOf('"', at)).split('?')[0].split('/').pop();
  };

  async function measure(browser, baseURL, label, keep) {
    const context = await browser.newContext({ baseURL });
    await context.addCookies([
      { name: 'eventflow_cookie_consent', value: 'rejected', url: baseURL },
    ]);
    const page = await context.newPage();
    let result;
    try {
      await loginAs(page, fixtures.users.admin);
      await page.route('**/admin-packages', async route => {
        const response = await route.fetch();
        let body = await response.text();
        for (const tag of scriptTags(body)) {
          if (!keep(nameOf(tag))) {
            body = body.replace(tag, '');
          }
        }
        await route.fulfill({ response, body });
      });
      await page.goto('/admin-packages', { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(500);
      result = await frames(page);
    } catch (error) {
      result = `error ${String(error.message).split('\n')[0]}`;
    }
    await context.close();
    console.log(`PROBE ${label}: ${result}`);
  }

  test('probe', async ({ browser, baseURL, browserName, request }) => {
    test.skip(browserName !== 'webkit', 'diagnostic for WebKit only');
    test.setTimeout(300000);
    const names = [
      'dashboard-guard.js',
      'admin-shared.js',
      'components.js',
      'admin-navbar.js',
      'image-fallback.js',
      'admin-packages-init.js',
      'cookie-consent.js',
    ];
    await measure(browser, baseURL, 'all scripts kept', () => true);
    await measure(browser, baseURL, 'no scripts', () => false);
    for (const name of names) {
      await measure(browser, baseURL, `without ${name}`, other => other !== name);
    }
    for (const name of names) {
      await measure(browser, baseURL, `only ${name}`, other => other === name);
    }
    expect(request).toBeTruthy();
  });
});
