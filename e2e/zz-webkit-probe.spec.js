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

  async function measure(page, label, url, blocked = []) {
    const handler = route => route.abort();
    for (const pattern of blocked) {
      await page.route(pattern, handler);
    }
    let result;
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(500);
      result = await frames(page);
    } catch (error) {
      result = `error ${String(error.message).split('\n')[0]}`;
    }
    for (const pattern of blocked) {
      await page.unroute(pattern, handler);
    }
    console.log(`PROBE ${label}: ${result}`);
  }

  test('probe', async ({ page, context, baseURL, browserName }) => {
    test.skip(browserName !== 'webkit', 'diagnostic for WebKit only');
    test.setTimeout(240000);
    await context.addCookies([
      { name: 'eventflow_cookie_consent', value: 'rejected', url: baseURL },
    ]);
    await loginAs(page, fixtures.users.admin);

    const admin = '/admin-packages';
    await measure(page, 'about', '/about');
    await measure(page, 'admin baseline', admin);
    await measure(page, 'admin users page', '/admin-users');
    await measure(page, 'admin, no navbar script', admin, ['**/admin-navbar.js*']);
    await measure(page, 'admin, no page script', admin, ['**/admin-packages-init.js*']);
    await measure(page, 'admin, no shared script', admin, ['**/admin-shared.js*']);
    await measure(page, 'admin, no components script', admin, ['**/components.js*']);
    await measure(page, 'admin, no cookie script', admin, ['**/cookie-consent.js*']);
    await measure(page, 'admin, no guard', admin, ['**/dashboard-guard.js*']);
    await measure(page, 'admin, no navbar css', admin, ['**/admin-navbar.css*']);
    await measure(page, 'admin, no admin css', admin, [
      '**/admin.css*',
      '**/admin-enhanced.css*',
      '**/admin-cards.css*',
      '**/admin-packages-enhanced.css*',
      '**/admin-ui-improvements.css*',
      '**/admin-workspace.css*',
    ]);
    await measure(page, 'admin, no animations css', admin, ['**/animations.css*']);
    await measure(page, 'admin, no styles css', admin, [
      '**/styles.css*',
      '**/eventflow-17.0.0.css*',
      '**/components.css*',
      '**/utilities.css*',
      '**/mobile-optimizations.css*',
      '**/ui-ux-fixes.css*',
    ]);
    await measure(page, 'admin, no scripts at all', admin, ['**/*.js*']);
    await measure(page, 'admin, no stylesheets at all', admin, ['**/*.css*']);

    await loginAs(page, fixtures.users.supplier);
    await measure(page, 'supplier dashboard', '/dashboard/supplier');
    await expect(page).toHaveURL(/dashboard/);
  });
});
